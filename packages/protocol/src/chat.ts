import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { AvailableModel } from './model.ts';

/** 产品会话历史 schema 版本。 */
export const PRODUCT_HISTORY_SCHEMA_VERSION = 1;

/** 产品拥有的 Agent 运行状态。 */
export type AgentRunStatus =
  'accepted' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted' | 'declined';

/** 产品助手片段状态。 */
export type AssistantSegmentStatus =
  'streaming' | 'completed' | 'failed' | 'aborted' | 'superseded';

export interface ProductTextBlock {
  type: 'text';
  text: string;
}

export interface ProductThinkingBlock {
  type: 'thinking';
  text: string;
  redacted?: boolean;
}

export interface ProductImageBlock {
  type: 'image';
  blobId: string;
  mimeType: string;
}

export interface ProductToolCallBlock {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export type ProductAssistantBlock = ProductTextBlock | ProductThinkingBlock | ProductToolCallBlock;

/** 用户提交并被 Hub 接受的消息。 */
export interface ProductUserMessageItem {
  type: 'user_message';
  itemId: string;
  runId: string;
  createdAt: number;
  text: string;
}

/** 单次模型调用产生的助手片段。 */
export interface ProductAssistantSegmentItem {
  type: 'assistant_segment';
  itemId: string;
  runId: string;
  createdAt: number;
  status: AssistantSegmentStatus;
  content: ProductAssistantBlock[];
  errorMessage?: string;
}

/** 一次工具运行的最终产品事实。 */
export interface ProductToolResultItem {
  type: 'tool_result';
  itemId: string;
  runId: string;
  createdAt: number;
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: Array<ProductTextBlock | ProductImageBlock>;
  isError: boolean;
}

/** 自动重试在失败位置留下的稳定记录。 */
export interface ProductRetryItem {
  type: 'retry';
  itemId: string;
  runId: string;
  createdAt: number;
  kind: 'model' | 'summarization';
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
  status: 'waiting' | 'retrying' | 'success' | 'error';
}

/** 上下文压缩在时间线中的稳定记录。 */
export interface ProductCompactionItem {
  type: 'compaction';
  itemId: string;
  runId: string;
  createdAt: number;
  reason: 'manual' | 'threshold' | 'overflow';
  status: 'running' | 'success' | 'aborted' | 'error';
  message?: string;
}

export type ProductTimelineItem =
  | ProductUserMessageItem
  | ProductAssistantSegmentItem
  | ProductToolResultItem
  | ProductRetryItem
  | ProductCompactionItem;

/** 一次完整助手回复及其内部时间线。 */
export interface ProductAgentRun {
  runId: string;
  status: AgentRunStatus;
  acceptedAt: number;
  startedAt: number | null;
  settledAt: number | null;
  items: ProductTimelineItem[];
}

/** 仍在内存中的实时工具状态。 */
export interface ProductToolDraft {
  toolCallId: string;
  runId: string;
  toolName: string;
  args: unknown;
  partialResult?: unknown;
  status: 'running' | 'success' | 'error';
  isError: boolean;
}

/** 进程存活期间可恢复的活动草稿。 */
export interface ProductHistoryDraft {
  runId: string;
  activeSegment: ProductAssistantSegmentItem | null;
  tools: ProductToolDraft[];
  retryDeadlineAt: number | null;
}

/** 当前产品分支的完整权威历史。 */
export interface ProductSessionHistory {
  schemaVersion: typeof PRODUCT_HISTORY_SCHEMA_VERSION;
  sessionId: string;
  branchId: string;
  revision: number;
  runs: ProductAgentRun[];
  draft: ProductHistoryDraft | null;
  blobs: Record<string, { mimeType: string; data: string }>;
}

export interface SessionHistoryChangedEvent {
  type: 'session_history_changed';
  previousRevision: number;
  history: ProductSessionHistory;
}

export interface SessionDraftChangedEvent {
  type: 'session_draft_changed';
  revision: number;
  draft: ProductHistoryDraft | null;
}

export interface SessionModelChangedEvent {
  type: 'session_model_changed';
  state: AgentSessionState;
}

export interface SessionSnapshotEvent {
  type: 'session_snapshot';
  history: ProductSessionHistory;
  state: AgentSessionState;
}

export interface SessionUnavailableEvent {
  type: 'session_unavailable';
  reason: 'archived' | 'missing';
}

export interface SessionArchivedEvent {
  type: 'session_archived';
  sessionId: string;
}

export interface SessionDeletedEvent {
  type: 'session_deleted';
  sessionId: string;
}

export interface PendingMessage {
  id: string;
  text: string;
}

export interface PendingMessagesChangedEvent {
  type: 'pending_messages_changed';
  pendingMessages: PendingMessage[];
}

export interface SessionInfoChangedEvent {
  type: 'session_info_changed';
  name: string | undefined;
}

export interface ThinkingLevelChangedEvent {
  type: 'thinking_level_changed';
  level: ThinkingLevel;
}

/** 客户端可以消费的产品会话事件。 */
export type AgentStreamEvent =
  | SessionHistoryChangedEvent
  | SessionDraftChangedEvent
  | SessionModelChangedEvent
  | SessionSnapshotEvent
  | SessionUnavailableEvent
  | SessionArchivedEvent
  | SessionDeletedEvent
  | PendingMessagesChangedEvent
  | SessionInfoChangedEvent
  | ThinkingLevelChangedEvent;

export type CompactionReason = ProductCompactionItem['reason'];

export interface ActiveCompaction {
  reason: CompactionReason;
}

export interface AgentSessionState {
  sessionName: string | null;
  /** Pi 执行历史是否仍可用于继续、编辑和分叉 */
  executionAvailable: boolean;
  isRunning: boolean;
  activeCompaction: ActiveCompaction | null;
  pendingMessages: PendingMessage[];
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  model: AvailableModel;
  availableModels: AvailableModel[];
  modelWarning: string | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isRunning: boolean;
}

export interface CreateSessionResult {
  sessionId: string;
}

export interface ForkSessionResult {
  sessionId: string;
}

export interface EditResendResult {
  history: ProductSessionHistory;
}

export interface AbortSessionResult {
  restoredTexts: string[];
}

export interface TakePendingMessagesResult {
  texts: string[];
}

export type { ThinkingLevel };
