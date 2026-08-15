/**
 * @file 客户端与本地服务之间的共享协议入口。
 *
 * 本包是数据结构、事件格式与传输约定的唯一来源。
 */
export type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  CreateSessionResult,
  SessionSummary,
  ThinkingLevel,
} from './chat.ts';
export type { ModelConfig, ModelInfo, ProviderInfo, TestConnectionResult } from './model.ts';
export {
  API_PATHS,
  DEFAULT_SERVICE_PORT,
  DEV_WEB_PORT,
  SERVICE_HOST,
  SESSION_API_PATHS,
  sessionApiPaths,
} from './transport.ts';
