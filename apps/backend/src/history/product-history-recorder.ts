import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  ProductAgentRun,
  ProductAssistantSegmentItem,
  ProductCompactionItem,
  ProductRetryItem,
  ProductToolDraft,
} from '@lvdagun/protocol';

import type {
  AgentSessionAdapter,
  AgentSessionAdapterEvent,
  ExecutionMessage,
} from '../hub/agent-hub-adapter';
import {
  mapPiAssistantSegment,
  mapPiAssistantStatus,
  mapPiToolResult,
  readPiUserText,
} from './pi-history-event-mapper';
import { projectTodoDetails } from '../extensions/todo/todo-projection';
import { ProductHistory } from './product-history';

/** 产品历史写入失败时通知 Hub 进入恢复状态。 */
export type ProductHistoryFailureHandler = (error: unknown) => void;

/** 把一个 Pi Runtime 的执行事件录制到独立产品历史。 */
export class ProductHistoryRecorder {
  private unsubscribe: (() => void) | null = null;
  private failed = false;
  private readonly productToolCallIds = new Map<string, string>();

  /**
   * @param history - 产品历史聚合
   * @param sessionId - 产品会话标识
   * @param session - Pi 会话适配器
   * @param onFailure - 持久化失败处理器
   */
  constructor(
    private readonly history: ProductHistory,
    private readonly sessionId: string,
    private readonly session: AgentSessionAdapter,
    private readonly onFailure: ProductHistoryFailureHandler
  ) {}

  /** 开始消费 Pi 事件。 */
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.subscribe(this.handleEvent);
  }

  /** 停止消费 Pi 事件。 */
  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** @param event - 后端单会话事件 */
  private readonly handleEvent = (event: AgentSessionAdapterEvent): void => {
    if (this.failed || isProductStateEvent(event)) return;
    try {
      this.recordEvent(event);
    } catch (error) {
      this.failed = true;
      this.onFailure(error);
    }
  };

  /** @param event - Pi 原生执行事件 */
  private recordEvent(
    event: Exclude<AgentSessionAdapterEvent, { type: ProductStateEventType }>
  ): void {
    switch (event.type) {
      case 'agent_start':
        this.updateRun((run) => {
          run.status = 'running';
          run.startedAt ??= Date.now();
        });
        return;
      case 'message_start':
        if (event.message.role === 'assistant') this.startAssistant(event.message);
        return;
      case 'message_update':
        if (event.message.role === 'assistant') this.updateAssistantDraft(event.message);
        return;
      case 'message_end':
        this.finishMessage(event.message);
        return;
      case 'tool_execution_start':
        this.updateToolDraft({
          toolCallId: this.resolveProductToolCallId(event.toolCallId),
          runId: this.history.getActiveRun(this.sessionId).runId,
          toolName: event.toolName,
          args: event.args,
          status: 'running',
          isError: false,
        });
        return;
      case 'tool_execution_update':
        this.updateToolDraft({
          toolCallId: this.resolveProductToolCallId(event.toolCallId),
          runId: this.history.getActiveRun(this.sessionId).runId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
          status: 'running',
          isError: false,
        });
        return;
      case 'tool_execution_end':
        this.updateToolDraft({
          toolCallId: this.resolveProductToolCallId(event.toolCallId),
          runId: this.history.getActiveRun(this.sessionId).runId,
          toolName: event.toolName,
          args: this.findToolArgs(this.resolveProductToolCallId(event.toolCallId)),
          partialResult: event.result,
          status: event.isError ? 'error' : 'success',
          isError: event.isError,
        });
        return;
      case 'auto_retry_start':
        this.startRetry('model', event);
        return;
      case 'auto_retry_end':
        this.finishRetry('model', event.success, event.attempt, event.finalError);
        return;
      case 'summarization_retry_scheduled':
        this.startRetry('summarization', event);
        return;
      case 'summarization_retry_attempt_start':
        this.updateLatestRetry('summarization', (retry) => {
          retry.status = 'retrying';
        });
        return;
      case 'summarization_retry_finished':
        this.finishRetry('summarization', true, undefined, undefined);
        return;
      case 'compaction_start':
        this.updateRun((run) => {
          const existing = [...run.items]
            .reverse()
            .find((item): item is ProductCompactionItem => item.type === 'compaction');
          if (existing?.status === 'running') return;
          run.items.push({
            type: 'compaction',
            itemId: randomUUID(),
            runId: run.runId,
            createdAt: Date.now(),
            reason: event.reason,
            status: 'running',
          });
        });
        return;
      case 'compaction_end':
        this.updateRun((run) => {
          const item = [...run.items]
            .reverse()
            .find(
              (candidate): candidate is ProductCompactionItem => candidate.type === 'compaction'
            );
          if (!item) return;
          item.status = event.aborted ? 'aborted' : event.errorMessage ? 'error' : 'success';
          item.message = event.errorMessage;
        });
        return;
      case 'agent_settled':
        this.settleRun();
        return;
      case 'entry_appended':
        this.reconcileEntry(
          event.entry.id,
          event.entry.type === 'message' ? event.entry.message : null
        );
        return;
      case 'turn_start':
        this.history.hideCompletedExecutionPlan(this.sessionId);
        return;
      case 'agent_end':
      case 'turn_end':
      case 'queue_update':
      case 'bash_execution_update':
        return;
    }
  }

  /** @param message - Pi 新助手消息 */
  private startAssistant(message: Extract<AgentMessage, { role: 'assistant' }>): void {
    const run = this.history.getActiveRun(this.sessionId);
    this.history.setDraft(this.sessionId, {
      runId: run.runId,
      activeSegment: mapPiAssistantSegment(
        message,
        { itemId: randomUUID(), runId: run.runId },
        'streaming',
        this.resolveProductToolCallId
      ),
      tools: this.history.getDraft(this.sessionId)?.tools ?? [],
      retryDeadlineAt: null,
    });
  }

  /** @param message - Pi 累计助手快照 */
  private updateAssistantDraft(message: Extract<AgentMessage, { role: 'assistant' }>): void {
    const draft = this.history.getDraft(this.sessionId);
    if (!draft?.activeSegment) return;
    this.history.setDraft(this.sessionId, {
      ...draft,
      activeSegment: mapPiAssistantSegment(
        message,
        { itemId: draft.activeSegment.itemId, runId: draft.runId },
        'streaming',
        this.resolveProductToolCallId
      ),
    });
  }

  /** @param message - Pi 完成消息 */
  private finishMessage(message: AgentMessage): void {
    if (message.role === 'user') {
      const run = this.history.getActiveRun(this.sessionId);
      const text = readPiUserText(message);
      const userItems = run.items.filter((item) => item.type === 'user_message');
      if (userItems.length === 1 && run.items.length === 1 && userItems[0]?.text === text) return;
      this.updateRun((activeRun) =>
        activeRun.items.push({
          type: 'user_message',
          itemId: randomUUID(),
          runId: activeRun.runId,
          createdAt: message.timestamp,
          text,
        })
      );
      return;
    }
    if (message.role === 'assistant') {
      const draft = this.history.getDraft(this.sessionId);
      const runId = this.history.getActiveRun(this.sessionId).runId;
      const itemId = draft?.activeSegment?.itemId ?? randomUUID();
      const segment = mapPiAssistantSegment(
        message,
        { itemId, runId },
        mapPiAssistantStatus(message),
        this.resolveProductToolCallId
      );
      // 先收敛活动段再结算：history 快照不会同时携带活动段与结算段，避免客户端短暂双渲染
      this.history.setDraft(this.sessionId, draft ? { ...draft, activeSegment: null } : null);
      this.updateRun((run) => run.items.push(segment));
      return;
    }
    if (message.role === 'toolResult') {
      const run = this.history.getActiveRun(this.sessionId);
      const itemId = randomUUID();
      const productToolCallId = this.resolveProductToolCallId(message.toolCallId);
      const executionPlan =
        message.toolName === 'todo' && !message.isError
          ? projectTodoDetails(message.details)
          : undefined;
      const result = mapPiToolResult(
        message,
        { itemId, runId: run.runId },
        this.findToolArgs(productToolCallId),
        productToolCallId,
        (mimeType, data) => this.history.putBlob(this.sessionId, mimeType, data),
        executionPlan
      );
      this.updateRun((activeRun) => activeRun.items.push(result));
      this.history.savePiToolCallReference(this.sessionId, itemId, message.toolCallId);
      return;
    }
  }

  /** @param kind - 重试种类 @param event - 调度事件 */
  private startRetry(
    kind: ProductRetryItem['kind'],
    event: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  ): void {
    // 先收敛草稿再写重试条目，history 快照不会同时携带旧的流式段与重试卡
    const draft = this.history.getDraft(this.sessionId);
    const run = this.history.getActiveRun(this.sessionId);
    this.history.setDraft(this.sessionId, {
      runId: run.runId,
      activeSegment: null,
      tools: draft?.tools ?? [],
      retryDeadlineAt: Date.now() + event.delayMs,
    });
    this.updateRun((run) => {
      if (kind === 'model') {
        const segment = [...run.items]
          .reverse()
          .find(
            (item): item is ProductAssistantSegmentItem =>
              item.type === 'assistant_segment' && item.status === 'failed'
          );
        if (segment) segment.status = 'superseded';
      }
      const retry = [...run.items]
        .reverse()
        .find(
          (item): item is ProductRetryItem =>
            item.type === 'retry' &&
            item.kind === kind &&
            item.status !== 'success' &&
            item.status !== 'error'
        );
      if (retry) {
        retry.attempt = event.attempt;
        retry.maxAttempts = event.maxAttempts;
        retry.errorMessage = event.errorMessage;
        retry.status = 'waiting';
      } else {
        run.items.push({
          type: 'retry',
          itemId: randomUUID(),
          runId: run.runId,
          createdAt: Date.now(),
          kind,
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          errorMessage: event.errorMessage,
          status: 'waiting',
        });
      }
    });
  }

  /** @param kind - 重试种类 @param success - 是否成功 @param attempt - 最终次数 @param error - 最终错误 */
  private finishRetry(
    kind: ProductRetryItem['kind'],
    success: boolean,
    attempt: number | undefined,
    error: string | undefined
  ): void {
    this.updateLatestRetry(kind, (retry) => {
      retry.status = success ? 'success' : 'error';
      if (attempt !== undefined) retry.attempt = attempt;
      if (error) retry.errorMessage = error;
    });
  }

  /** @param kind - 重试种类 @param update - 更新逻辑 */
  private updateLatestRetry(
    kind: ProductRetryItem['kind'],
    update: (retry: ProductRetryItem) => void
  ): void {
    this.updateRun((run) => {
      const retry = [...run.items]
        .reverse()
        .find((item): item is ProductRetryItem => item.type === 'retry' && item.kind === kind);
      if (retry) update(retry);
    });
  }

  /** @param tool - 最新工具草稿 */
  private updateToolDraft(tool: ProductToolDraft): void {
    const draft = this.history.getDraft(this.sessionId);
    const tools = [...(draft?.tools ?? [])];
    const index = tools.findIndex((candidate) => candidate.toolCallId === tool.toolCallId);
    if (index >= 0) tools[index] = tool;
    else tools.push(tool);
    this.history.setDraft(this.sessionId, {
      runId: tool.runId,
      activeSegment: draft?.activeSegment ?? null,
      tools,
      retryDeadlineAt: draft?.retryDeadlineAt ?? null,
    });
  }

  /** @param toolCallId - Pi 工具调用标识 @returns 参数 */
  private findToolArgs(toolCallId: string): unknown {
    const run = this.history.getActiveRun(this.sessionId);
    for (const item of [...run.items].reverse()) {
      if (item.type !== 'assistant_segment') continue;
      const call = item.content.find(
        (block) => block.type === 'tool_call' && block.toolCallId === toolCallId
      );
      if (call?.type === 'tool_call') return call.args;
    }
    return {};
  }

  /** @param piToolCallId - Pi 工具调用标识 @returns 产品工具调用标识 */
  private readonly resolveProductToolCallId = (piToolCallId: string): string => {
    const existing = this.productToolCallIds.get(piToolCallId);
    if (existing) return existing;
    const productToolCallId = randomUUID();
    this.productToolCallIds.set(piToolCallId, productToolCallId);
    return productToolCallId;
  };

  /** 结算完整 Agent 运行并严格对齐 Pi entry 来源。 */
  private settleRun(): void {
    this.updateRun((run) => {
      const lastSegment = [...run.items]
        .reverse()
        .find(
          (item): item is ProductAssistantSegmentItem =>
            item.type === 'assistant_segment' && item.status !== 'superseded'
        );
      run.status = statusFromSegment(lastSegment);
      run.settledAt = Date.now();
    });
    this.history.setDraft(this.sessionId, null);
    this.reconcileHistory(this.session.getExecutionHistory());
  }

  /** @param update - 对活动运行的修改 */
  private updateRun(update: (run: ProductAgentRun) => void): void {
    this.history.mutate(this.sessionId, (session) => {
      const branch = session.branches.find((candidate) => candidate.id === session.currentBranchId);
      const run = branch?.runs.at(-1);
      if (!run || (run.status !== 'accepted' && run.status !== 'running')) {
        throw new Error('产品历史中没有可修改的活动运行');
      }
      update(run);
    });
  }

  /** @param entryId - Pi entry @param message - Pi 消息 */
  private reconcileEntry(entryId: string, message: AgentMessage | null): void {
    if (!message) return;
    const history = this.history.getSnapshot(this.sessionId);
    const item = history.runs
      .flatMap((run) => run.items)
      .findLast((candidate) =>
        itemMatchesMessage(candidate, message, this.resolveProductToolCallId)
      );
    if (item) this.history.savePiEntryReference(this.sessionId, item.itemId, entryId);
  }

  /** @param execution - Pi 当前分支历史 */
  private reconcileHistory(execution: ExecutionMessage[]): void {
    const items = this.history
      .getSnapshot(this.sessionId)
      .runs.flatMap((run) => run.items)
      .filter((item) => item.type !== 'retry' && item.type !== 'compaction');
    let itemIndex = 0;
    for (const entry of execution) {
      if (!entry.entryId) continue;
      while (
        itemIndex < items.length &&
        !itemMatchesMessage(items[itemIndex]!, entry.message, this.resolveProductToolCallId)
      ) {
        itemIndex += 1;
      }
      const item = items[itemIndex];
      if (!item) continue;
      this.history.savePiEntryReference(this.sessionId, item.itemId, entry.entryId);
      itemIndex += 1;
    }
  }
}

type ProductStateEventType =
  | 'session_model_changed'
  | 'pending_messages_changed'
  | 'session_info_changed'
  | 'thinking_level_changed';

/** @param event - 适配器事件 @returns 是否为非执行产品状态 */
function isProductStateEvent(
  event: AgentSessionAdapterEvent
): event is Extract<AgentSessionAdapterEvent, { type: ProductStateEventType }> {
  return (
    event.type === 'session_model_changed' ||
    event.type === 'pending_messages_changed' ||
    event.type === 'session_info_changed' ||
    event.type === 'thinking_level_changed'
  );
}

/** @param segment - 最终可见片段 @returns Agent 运行终态 */
function statusFromSegment(
  segment: ProductAssistantSegmentItem | undefined
): ProductAgentRun['status'] {
  if (!segment) return 'completed';
  if (segment.status === 'failed') return 'failed';
  if (segment.status === 'aborted') return 'aborted';
  return 'completed';
}

/** @param item - 产品条目 @param message - Pi 消息 @param resolveToolCallId - 工具标识映射 @returns 是否严格对应 */
function itemMatchesMessage(
  item: ReturnType<ProductHistory['getSnapshot']>['runs'][number]['items'][number],
  message: AgentMessage,
  resolveToolCallId: (piToolCallId: string) => string
): boolean {
  if (item.type === 'user_message') {
    return message.role === 'user' && item.text === readPiUserText(message);
  }
  if (item.type === 'assistant_segment') {
    if (message.role !== 'assistant') return false;
    const mapped = mapPiAssistantSegment(
      message,
      { itemId: item.itemId, runId: item.runId },
      item.status,
      resolveToolCallId
    );
    return JSON.stringify(mapped.content) === JSON.stringify(item.content);
  }
  if (item.type === 'tool_result') {
    return (
      message.role === 'toolResult' && item.toolCallId === resolveToolCallId(message.toolCallId)
    );
  }
  return false;
}
