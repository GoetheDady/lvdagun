import { randomUUID } from 'node:crypto';

import type {
  AgentStreamEvent,
  ProductAgentRun,
  ProductHistoryDraft,
  ProductExecutionPlanVisibilityItem,
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

/** 草稿事件合并窗口：与一帧刷新对齐，避免每个模型 delta 都广播一次全量草稿 */
const DRAFT_EMIT_DELAY_MS = 60;

/** 驴打滚产品会话历史聚合。 */
export class ProductHistory {
  private readonly drafts = new Map<string, ProductHistoryDraft>();
  private readonly listeners = new Map<string, Set<(event: AgentStreamEvent) => void>>();
  private readonly draftTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
      executionPlan: structuredClone(this.resolveExecutionPlan(session)),
    };
  }

  /**
   * 在下一次模型调用开始时隐藏已经全部完成的会话执行计划。
   *
   * @param sessionId - 产品会话
   */
  hideCompletedExecutionPlan(sessionId: string): void {
    const session = this.requireActiveSession(sessionId);
    const plan = this.resolveExecutionPlan(session);
    if (!plan || !plan.steps.every((step) => step.status === 'completed')) return;
    this.commit(sessionId, (current) => {
      const run = this.resolveRuns(current).at(-1);
      if (!run || (run.status !== 'accepted' && run.status !== 'running')) return;
      const item: ProductExecutionPlanVisibilityItem = {
        type: 'execution_plan_visibility',
        itemId: randomUUID(),
        runId: run.runId,
        createdAt: Date.now(),
      };
      run.items.push(item);
    });
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
   * 编辑目标只按文本校验：分叉会话重启后 toolCallId 映射丢失，pi_entry 引用可能缺失，
   * 依赖引用会把可编辑的消息误判成未对齐；真正的目标校验由 Pi 适配器按文本完成。
   *
   * @param sessionId - 产品会话
   * @param itemId - 被编辑用户条目
   * @param text - 新文本
   * @returns 旧分支、新运行标识和被编辑消息的原文
   */
  beginEditResend(
    sessionId: string,
    itemId: string,
    text: string
  ): { previousBranchId: string; runId: string; itemText: string } {
    const session = this.requireActiveSession(sessionId);
    const targetRun = this.resolveRuns(session).find((run) =>
      run.items.some((item) => item.itemId === itemId && item.type === 'user_message')
    );
    if (!targetRun) throw new Error('只能编辑当前分支中的用户消息');
    const item = targetRun.items.find(
      (candidate): candidate is Extract<ProductTimelineItem, { type: 'user_message' }> =>
        candidate.itemId === itemId && candidate.type === 'user_message'
    );
    if (!item) throw new Error('只能编辑当前分支中的用户消息');
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
    return { previousBranchId, runId, itemText: item.text };
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

  /**
   * 写入当前草稿并广播变更事件。
   *
   * 高频流式更新（每个模型 delta 一次）写入侧直接落内存，广播侧做尾随节流合并：
   * 同一合并窗口内只发最后一次最新草稿，避免事件突发把多行文本一次性推到客户端；
   * null（流结束、等待重试等需要立刻收敛的状态）立即发出并取消挂起的广播。
   *
   * @param sessionId - 产品会话
   * @param draft - 新草稿；null 表示清空
   */
  setDraft(sessionId: string, draft: ProductHistoryDraft | null): void {
    // 校验会话仍然存在（无其他用途）
    this.requireSession(sessionId);
    if (draft) this.drafts.set(sessionId, draft);
    else this.drafts.delete(sessionId);
    if (draft === null) {
      // null（流结束、等待重试）需要立刻收敛：取消挂起广播并同步发出
      const pending = this.draftTimers.get(sessionId);
      if (pending) clearTimeout(pending);
      this.draftTimers.delete(sessionId);
      this.emitDraft(sessionId);
      return;
    }
    // 尾随节流而非防抖：窗口内已有挂起广播时只更新内存草稿，不重置计时器；
    // 若重置，连续 delta（间隔小于窗口）会把广播无限推迟，客户端直到停顿才一次性收到全文
    if (this.draftTimers.has(sessionId)) return;
    const timer = setTimeout(() => this.emitDraft(sessionId), DRAFT_EMIT_DELAY_MS);
    timer.unref();
    this.draftTimers.set(sessionId, timer);
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

  /** @returns 关闭仓储并清空挂起的草稿广播 */
  close(): void {
    for (const timer of this.draftTimers.values()) clearTimeout(timer);
    this.draftTimers.clear();
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

  /** @param session - 会话 @returns 当前分支最后一份合法且仍可见的计划投影 */
  private resolveExecutionPlan(
    session: StoredProductSession
  ): ProductSessionHistory['executionPlan'] {
    let plan: ProductSessionHistory['executionPlan'] = null;
    for (const item of this.resolveRuns(session).flatMap((run) => run.items)) {
      if (item.type === 'tool_result' && item.toolName === 'todo' && 'executionPlan' in item) {
        plan = item.executionPlan ?? null;
      } else if (item.type === 'execution_plan_visibility') {
        plan = null;
      }
    }
    return plan;
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

  /**
   * 广播当前草稿快照；会话已删除时静默丢弃，避免挂起定时器在会话销毁后抛错。
   *
   * @param sessionId - 产品会话
   */
  private emitDraft(sessionId: string): void {
    this.draftTimers.delete(sessionId);
    const session = this.repository.loadSession(sessionId);
    if (!session) return;
    this.emit(sessionId, {
      type: 'session_draft_changed',
      revision: session.revision,
      draft: structuredClone(this.drafts.get(sessionId) ?? null),
    });
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
