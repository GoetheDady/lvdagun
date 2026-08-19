/**
 * @file 客户端与本地服务之间的共享协议入口。
 *
 * 本包是数据结构、事件格式与传输约定的唯一来源。
 */
export type {
  ActiveCompaction,
  AbortSessionResult,
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  CompactionReason,
  CreateSessionResult,
  EditResendResult,
  ForkSessionResult,
  PendingMessage,
  PendingMessagesChangedEvent,
  SessionArchivedEvent,
  SessionDeletedEvent,
  SessionHistoryChangedEvent,
  SessionMessage,
  SessionModelChangedEvent,
  SessionSnapshotEvent,
  SessionUnavailableEvent,
  SessionSummary,
  TakePendingMessagesResult,
  ThinkingLevel,
} from './chat.ts';
export type {
  AvailableModel,
  ModelConfig,
  ModelInfo,
  ModelReference,
  ProviderInfo,
  TestConnectionResult,
} from './model.ts';
export {
  API_PATHS,
  DEFAULT_SERVICE_PORT,
  DEV_WEB_PORT,
  SERVICE_HOST,
  SESSION_API_PATHS,
  sessionApiPaths,
} from './transport.ts';
