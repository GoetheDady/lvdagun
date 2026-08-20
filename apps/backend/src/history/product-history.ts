import { randomUUID } from 'node:crypto';

import type {
  AgentStreamEvent,
  ProductAgentRun,
  ProductHistoryDraft,
  ProductSessionHistory,
  ProductTimelineItem,
  SessionHistoryChangedEvent,
  SessionSummary,
} from '@lvdagun/protocol';
import { PRODUCT_HISTORY_SCHEMA_VERSION, resolveSessionTitle } from '@lvdagun/protocol';

import type {
  ProductHistoryRepository,
  ProductSourceReference,
  StoredProductBranch,
  StoredProductSession,
} from './product-history-repository';

/** 产品历史中请求的会话不存在或不可访问。 */
export class ProductHistorySessionNotFoundError extends Error {
  /** @param sessionId - 产品会话标识 */
  constructor(sessionId: string) {
    super(`产品会话不存在:${sessionId}`);
    this.name = 'ProductHistorySessionNotFoundError';
  }
}

/** 驴打滚产品会话历史聚合。 */
export class ProductHistory {
  private readonly drafts = new Map<string, ProductHistoryDraft>();
  private readonly listeners = new Map<string, Set<(event: AgentStreamEvent) => void>>();

  /** @param repository - 产品历史持久化边界 */
  constructor(private readonly repository: ProductHistoryRepository) {}

  /** @returns 是否首次建立 V1 产品历史 */
  initialize(): boolean {
    const firstInstall = this.repository.initialize();
    if (!firstInstall) this.interruptUnfinishedRuns();
    return firstInstall;
  }

  /** @returns 是否仍需清理不兼容的旧 Pi 会话 */
  needsLegacySessionCutover(): boolean {
    return !this.repository.isLegacyCutoverComplete();
  }

  /** 标记不兼容的旧 Pi 会话已经清理完成。 */
  completeLegacySessionCutover(): void {
    this.repository.markLegacyCutoverComplete();
  }

  /**
   * 根据 Pi 活动会话集合收敛崩溃前未完成的跨存储生命周期意图。
   *
   * @param activePiSessionIds - 当前仍存在的活动 Pi 会话
   * @param deletePiSession - 清理未完成创建或派生留下的 Pi 会话
   */
  async recoverLifecycleIntents(
    activePiSessionIds: Set<string>,
    deletePiSession: (piSessionId: string) => Promise<void>
  ): Promise<void> {
    const sessions = this.repository.listSessions();
    const referencedPiSessionIds = new Set(
      sessions.flatMap((session) => (session.piSessionId ? [session.piSessionId] : []))
    );
    for (const session of sessions) {
      const hasPi = session.piSessionId ? activePiSessionIds.has(session.piSessionId) : false;
      switch (session.lifecycleState) {
        case 'creating':
        case 'forking':
          if (hasPi && session.piSessionId) await deletePiSession(session.piSessionId);
          this.repository.deleteSession(session.id);
          break;
        case 'archiving':
          session.lifecycleState = hasPi ? 'active' : 'archived';
          session.status = hasPi ? 'active' : 'archived';
          this.repository.saveSession(session);
          break;
        case 'deleting':
          if (hasPi && session.piSessionId) await deletePiSession(session.piSessionId);
          this.repository.deleteSession(session.id);
          break;
        case 'active':
        case 'archived':
          break;
      }
    }
    for (const piSessionId of activePiSessionIds) {
      if (!referencedPiSessionIds.has(piSessionId)) await deletePiSession(piSessionId);
    }
  }

  /** @param sessionId - 预分配的产品 id @param createdAt - Hub 接受创建的时间 */
  beginCreate(sessionId: string, createdAt = Date.now()): void {
    const branchId = randomUUID();
    this.repository.saveSession({
      id: sessionId,
      piSessionId: null,
      title: null,
      status: 'active',
      lifecycleState: 'creating',
      currentBranchId: branchId,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      branches: [{ id: branchId, parentBranchId: null, forkedAtRunId: null, runs: [] }],
      sourceReferences: [],
    });
  }

  /** @param sessionId - 产品会话 @param piSessionId - Pi 执行会话 */
  completeCreate(sessionId: string, piSessionId: string): void {
    const session = this.requireSession(sessionId);
    session.piSessionId = piSessionId;
    if (session.lifecycleState === 'creating') session.lifecycleState = 'active';
    this.repository.saveSession(session);
  }

  /** @param sessionId - 创建失败的产品会话 */
  cancelCreate(sessionId: string): void {
    this.repository.deleteSession(sessionId);
  }

  /** @param sessionId - 产品会话 @returns 内部 Pi 会话 id */
  getPiSessionId(sessionId: string): string {
    const session = this.requireActiveSession(sessionId);
    if (!session.piSessionId) throw new ProductHistorySessionNotFoundError(sessionId);
    return session.piSessionId;
  }

  /** @returns 产品数据库权威会话列表 */
  listSessions(): SessionSummary[] {
    return this.repository
      .listSessions()
      .filter((session) => session.status === 'active' && session.lifecycleState === 'active')
      .map((session) => {
        const runs = this.resolveRuns(session);
        const firstUser = runs
          .flatMap((run) => run.items)
          .find((item) => item.type === 'user_message');
        return {
          id: session.id,
          title: resolveSessionTitle({
            sessionName: session.title,
            firstUserMessage: firstUser?.type === 'user_message' ? firstUser.text : '',
          }),
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: runs.reduce(
            (count, run) =>
              count +
              run.items.filter(
                (item) => item.type === 'user_message' || item.type === 'assistant_segment'
              ).length,
            0
          ),
          isRunning: runs.at(-1)?.status === 'accepted' || runs.at(-1)?.status === 'running',
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  /** @param sessionId - 产品会话 @returns 当前权威历史 */
  getSnapshot(sessionId: string): ProductSessionHistory {
    const session = this.requireActiveSession(sessionId);
    return {
      schemaVersion: PRODUCT_HISTORY_SCHEMA_VERSION,
      sessionId,
      branchId: session.currentBranchId,
      revision: session.revision,
      runs: structuredClone(this.resolveRuns(session)),
      draft: structuredClone(this.drafts.get(sessionId) ?? null),
      blobs: this.repository.loadBlobs(sessionId),
    };
  }

  /** @param sessionId - 产品会话 @param listener - 产品事件监听器 @returns 退订函数 */
  subscribe(sessionId: string, listener: (event: AgentStreamEvent) => void): () => void {
    this.requireActiveSession(sessionId);
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => listeners.delete(listener);
  }

  /** @param sessionId - 产品会话 @param text - 已接受提示 @returns 新运行 id */
  acceptPrompt(sessionId: string, text: string): string {
    const now = Date.now();
    const runId = randomUUID();
    this.commit(sessionId, (session) => {
      this.currentBranch(session).runs.push({
        runId,
        status: 'accepted',
        acceptedAt: now,
        startedAt: null,
        settledAt: null,
        items: [{ type: 'user_message', itemId: randomUUID(), runId, createdAt: now, text }],
      });
    });
    return runId;
  }

  /** @param sessionId - 产品会话 @param runId - 未通过 Pi 前置校验的运行 */
  declineRun(sessionId: string, runId: string): void {
    this.commit(sessionId, (session) => {
      const run = session.branches
        .flatMap((branch) => branch.runs)
        .find((item) => item.runId === runId);
      if (!run) throw new Error(`产品 Agent 运行不存在:${runId}`);
      run.status = 'declined';
      run.settledAt = Date.now();
    });
  }

  /** @param sessionId - 产品会话 @param title - 产品权威标题 */
  setTitle(sessionId: string, title: string | null): void {
    const session = this.requireActiveSession(sessionId);
    if (session.title === title) return;
    session.title = title;
    this.saveAndEmit(session);
  }

  /** @param sessionId - 产品会话 @param lifecycle - 意图状态 */
  setLifecycle(sessionId: string, lifecycle: StoredProductSession['lifecycleState']): void {
    const session = this.requireSession(sessionId);
    session.lifecycleState = lifecycle;
    this.repository.saveSession(session);
  }

  /** @param sessionId - 产品会话 */
  finishArchive(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.lifecycleState = 'archived';
    session.status = 'archived';
    this.repository.saveSession(session);
  }

  /** @param sessionId - 产品会话 */
  finishDelete(sessionId: string): void {
    this.drafts.delete(sessionId);
    this.repository.deleteSession(sessionId);
  }

  /** @param sessionId - 产品会话 @param itemId - 产品用户条目 @returns Pi entry id */
  resolveUserEntry(sessionId: string, itemId: string): string {
    const session = this.requireActiveSession(sessionId);
    const item = this.resolveRuns(session)
      .flatMap((run) => run.items)
      .find((candidate) => candidate.itemId === itemId && candidate.type === 'user_message');
    const reference = session.sourceReferences.find(
      (candidate) => candidate.itemId === item?.itemId && candidate.sourceType === 'pi_entry'
    );
    if (!reference) throw new Error('用户消息尚未与 Pi 执行历史对齐');
    return reference.sourceId;
  }

  /** @param sessionId - 产品会话 @param runId - 产品运行 @returns 最后助手 Pi entry id */
  resolveRunEntry(sessionId: string, runId: string): string {
    const session = this.requireActiveSession(sessionId);
    const run = this.resolveRuns(session).find((candidate) => candidate.runId === runId);
    const assistantItemIds =
      run?.items
        .filter((item) => item.type === 'assistant_segment' && item.status !== 'superseded')
        .map((item) => item.itemId)
        .reverse() ?? [];
    const reference = assistantItemIds
      .map((itemId) =>
        session.sourceReferences.find(
          (candidate) => candidate.itemId === itemId && candidate.sourceType === 'pi_entry'
        )
      )
      .find(Boolean);
    if (!reference) throw new Error('助手回复尚未与 Pi 执行历史对齐');
    return reference.sourceId;
  }

  /**
   * 为编辑重发建立共享前缀的新产品分支并先持久化用户消息。
   *
   * @param sessionId - 产品会话
   * @param itemId - 被编辑用户条目
   * @param text - 新文本
   * @returns Pi entry、旧分支和新运行标识
   */
  beginEditResend(
    sessionId: string,
    itemId: string,
    text: string
  ): { piEntryId: string; previousBranchId: string; runId: string } {
    const session = this.requireActiveSession(sessionId);
    const targetRun = this.resolveRuns(session).find((run) =>
      run.items.some((item) => item.itemId === itemId && item.type === 'user_message')
    );
    if (!targetRun) throw new Error('只能编辑当前分支中的用户消息');
    const piEntryId = this.resolveUserEntry(sessionId, itemId);
    const previousBranchId = session.currentBranchId;
    const branchId = randomUUID();
    const runId = randomUUID();
    const now = Date.now();
    session.branches.push({
      id: branchId,
      parentBranchId: previousBranchId,
      forkedAtRunId: targetRun.runId,
      runs: [
        {
          runId,
          status: 'accepted',
          acceptedAt: now,
          startedAt: null,
          settledAt: null,
          items: [{ type: 'user_message', itemId: randomUUID(), runId, createdAt: now, text }],
        },
      ],
    });
    session.currentBranchId = branchId;
    this.saveAndEmit(session);
    return { piEntryId, previousBranchId, runId };
  }

  /** @param sessionId - 产品会话 @param previousBranchId - 恢复分支 @param runId - 被拒绝运行 */
  declineEditResend(sessionId: string, previousBranchId: string, runId: string): void {
    const session = this.requireSession(sessionId);
    const run = session.branches
      .flatMap((branch) => branch.runs)
      .find((item) => item.runId === runId);
    if (run) {
      run.status = 'declined';
      run.settledAt = Date.now();
    }
    session.currentBranchId = previousBranchId;
    this.saveAndEmit(session);
  }

  /** @param targetSessionId - 目标产品会话 @param sourceSessionId - 源会话 @param throughRunId - 包含到的运行 */
  copyForkHistory(targetSessionId: string, sourceSessionId: string, throughRunId: string): void {
    const target = this.requireSession(targetSessionId);
    const source = this.requireActiveSession(sourceSessionId);
    const sourceRuns = this.resolveRuns(source);
    const end = sourceRuns.findIndex((run) => run.runId === throughRunId);
    if (end < 0) throw new Error('分叉的助手回复不存在');
    const itemIdMap = new Map<string, string>();
    const toolCallIdMap = new Map<string, string>();
    const forkToolCallId = (sourceId: string): string => {
      const existing = toolCallIdMap.get(sourceId);
      if (existing) return existing;
      const id = randomUUID();
      toolCallIdMap.set(sourceId, id);
      return id;
    };
    const copiedRuns = sourceRuns.slice(0, end + 1).map((run): ProductAgentRun => {
      const runId = randomUUID();
      return {
        ...structuredClone(run),
        runId,
        items: run.items.map((item): ProductTimelineItem => {
          const itemId = randomUUID();
          itemIdMap.set(item.itemId, itemId);
          const copied = { ...structuredClone(item), itemId, runId } as ProductTimelineItem;
          if (copied.type === 'assistant_segment') {
            copied.content = copied.content.map((block) =>
              block.type === 'tool_call'
                ? { ...block, toolCallId: forkToolCallId(block.toolCallId) }
                : block
            );
          } else if (copied.type === 'tool_result') {
            copied.toolCallId = forkToolCallId(copied.toolCallId);
          }
          return copied;
        }),
      };
    });
    target.branches[0]!.runs = copiedRuns;
    target.sourceReferences = source.sourceReferences.flatMap((reference) => {
      const itemId = itemIdMap.get(reference.itemId);
      return itemId ? [{ ...reference, itemId }] : [];
    });
    target.title = `${resolveSessionTitle({ sessionName: source.title })}（分叉）`;
    target.lifecycleState = 'active';
    this.saveAndEmit(target);
  }

  /** @param sessionId - 产品会话 @returns 当前活动运行；没有则抛错 */
  getActiveRun(sessionId: string): ProductAgentRun {
    const run = this.resolveRuns(this.requireSession(sessionId)).at(-1);
    if (!run || (run.status !== 'accepted' && run.status !== 'running')) {
      throw new Error('产品历史中没有活动 Agent 运行');
    }
    return run;
  }

  /** @param sessionId - 产品会话 @returns 当前草稿 */
  getDraft(sessionId: string): ProductHistoryDraft | null {
    return this.drafts.get(sessionId) ?? null;
  }

  /** @param sessionId - 产品会话 @param draft - 新草稿 */
  setDraft(sessionId: string, draft: ProductHistoryDraft | null): void {
    const session = this.requireSession(sessionId);
    if (draft) this.drafts.set(sessionId, draft);
    else this.drafts.delete(sessionId);
    this.emit(sessionId, {
      type: 'session_draft_changed',
      revision: session.revision,
      draft: structuredClone(draft),
    });
  }

  /** @param sessionId - 产品会话 @param mutate - 聚合修改 */
  mutate(sessionId: string, mutate: (session: StoredProductSession) => void): void {
    this.commit(sessionId, mutate);
  }

  /** @param sessionId - 产品会话 @param itemId - 产品条目 @param entryId - Pi 条目 */
  savePiEntryReference(sessionId: string, itemId: string, entryId: string): void {
    this.saveSourceReference(sessionId, itemId, 'pi_entry', entryId);
  }

  /** @param sessionId - 产品会话 @param itemId - 工具结果条目 @param toolCallId - Pi 工具调用 */
  savePiToolCallReference(sessionId: string, itemId: string, toolCallId: string): void {
    this.saveSourceReference(sessionId, itemId, 'pi_tool_call', toolCallId);
  }

  /** @param sessionId - 产品会话 @param itemId - 产品条目 @param sourceType - 来源类型 @param sourceId - 来源标识 */
  private saveSourceReference(
    sessionId: string,
    itemId: string,
    sourceType: ProductSourceReference['sourceType'],
    sourceId: string
  ): void {
    const session = this.requireSession(sessionId);
    const existing = session.sourceReferences.find(
      (reference) => reference.itemId === itemId && reference.sourceType === sourceType
    );
    if (existing) existing.sourceId = sourceId;
    else session.sourceReferences.push({ itemId, sourceType, sourceId });
    this.repository.saveSession(session);
  }

  /** @param sessionId - 产品会话 @param mimeType - MIME @param data - 数据 @returns BLOB id */
  putBlob(sessionId: string, mimeType: string, data: Uint8Array): string {
    return this.repository.putBlob(sessionId, mimeType, data);
  }

  /** @returns 关闭仓储 */
  close(): void {
    this.repository.close();
  }

  /** @param sessionId - 产品会话 @returns 持久化会话 */
  private requireSession(sessionId: string): StoredProductSession {
    const session = this.repository.loadSession(sessionId);
    if (!session) throw new ProductHistorySessionNotFoundError(sessionId);
    return session;
  }

  /** @param sessionId - 产品会话 @returns 可访问会话 */
  private requireActiveSession(sessionId: string): StoredProductSession {
    const session = this.requireSession(sessionId);
    if (session.status !== 'active' || session.lifecycleState !== 'active') {
      throw new ProductHistorySessionNotFoundError(sessionId);
    }
    return session;
  }

  /** @param session - 会话 @returns 当前分支 */
  private currentBranch(session: StoredProductSession): StoredProductBranch {
    const branch = session.branches.find((candidate) => candidate.id === session.currentBranchId);
    if (!branch) throw new Error(`产品当前分支不存在:${session.currentBranchId}`);
    return branch;
  }

  /** @param session - 会话 @returns 解析共享前缀后的运行 */
  private resolveRuns(session: StoredProductSession): ProductAgentRun[] {
    const byId = new Map(session.branches.map((branch) => [branch.id, branch]));
    const resolve = (branch: StoredProductBranch): ProductAgentRun[] => {
      if (!branch.parentBranchId) return branch.runs;
      const parent = byId.get(branch.parentBranchId);
      if (!parent) throw new Error(`产品父分支不存在:${branch.parentBranchId}`);
      const parentRuns = resolve(parent);
      const cutoff = branch.forkedAtRunId
        ? parentRuns.findIndex((run) => run.runId === branch.forkedAtRunId)
        : parentRuns.length;
      if (cutoff < 0) throw new Error(`产品分叉运行不存在:${branch.forkedAtRunId}`);
      return [...parentRuns.slice(0, cutoff), ...branch.runs];
    };
    return resolve(this.currentBranch(session));
  }

  /** @param sessionId - 会话 @param mutate - 修改 */
  private commit(sessionId: string, mutate: (session: StoredProductSession) => void): void {
    const session = this.requireActiveSession(sessionId);
    mutate(session);
    this.saveAndEmit(session);
  }

  /** @param session - 修改后的会话 */
  private saveAndEmit(session: StoredProductSession): void {
    const previousRevision = session.revision;
    session.revision += 1;
    session.updatedAt = Date.now();
    this.repository.saveSession(session);
    const event: SessionHistoryChangedEvent = {
      type: 'session_history_changed',
      previousRevision,
      history: this.getSnapshot(session.id),
    };
    this.emit(session.id, event);
  }

  /** @param sessionId - 会话 @param event - 产品事件 */
  private emit(sessionId: string, event: AgentStreamEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }

  /** 把进程退出时未结算的运行标记为中断。 */
  private interruptUnfinishedRuns(): void {
    for (const session of this.repository.listSessions()) {
      let changed = false;
      for (const run of session.branches.flatMap((branch) => branch.runs)) {
        if (run.status === 'accepted' || run.status === 'running') {
          run.status = 'interrupted';
          run.settledAt = Date.now();
          changed = true;
        }
      }
      if (changed) {
        session.revision += 1;
        session.updatedAt = Date.now();
        this.repository.saveSession(session);
      }
    }
  }
}
