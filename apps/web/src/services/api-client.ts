/** @file 客户端普通 HTTP 请求的唯一入口 */
import {
  type AbortSessionResult,
  type AgentSessionState,
  type CreateSessionResult,
  type EditResendResult,
  type ForkSessionResult,
  type ModelSettings,
  type ModelInfo,
  type ModelReference,
  type ProviderInfo,
  type SessionSummary,
  type ProductSessionHistory,
  type TakePendingMessagesResult,
  type TestConnectionResult,
  type ThinkingLevel,
} from '@lvdagun/protocol';
import { getRpcConnection } from '@/services/rpc-client';

/** 本地服务 JSON-RPC 操作集合 */
export const api = {
  getConfig: (): Promise<ModelSettings> => getRpcConnection().request('config/get'),

  saveConfig: (settings: ModelSettings): Promise<void> =>
    getRpcConnection().request('config/update', settings),

  testConnection: (provider: string, apiKey: string, modelId: string): Promise<TestConnectionResult> =>
    getRpcConnection().request('catalog/testConnection', { provider, apiKey, modelId }),

  listProviders: (): Promise<ProviderInfo[]> => getRpcConnection().request('catalog/listProviders'),

  listModels: (provider: string): Promise<ModelInfo[]> =>
    getRpcConnection().request('catalog/listModels', { provider }),

  listSessions: (): Promise<SessionSummary[]> => getRpcConnection().request('session/list'),

  createSession: (): Promise<CreateSessionResult> => getRpcConnection().request('session/create'),

  archiveSession: (sessionId: string): Promise<void> =>
    getRpcConnection().request('session/archive', { sessionId }),

  deleteSession: (sessionId: string): Promise<void> =>
    getRpcConnection().request('session/delete', { sessionId }),

  setSessionTitle: (sessionId: string, title: string): Promise<void> =>
    getRpcConnection().request('session/rename', { sessionId, title }),

  getMessages: (sessionId: string): Promise<ProductSessionHistory> =>
    getRpcConnection().request('session/messages', { sessionId }),

  forkSession: (sessionId: string, runId: string): Promise<ForkSessionResult> =>
    getRpcConnection().request('session/fork', { sessionId, runId }),

  editAndResend: (sessionId: string, itemId: string, text: string): Promise<EditResendResult> =>
    getRpcConnection().request('session/editResend', { sessionId, itemId, text }),

  getSessionState: (sessionId: string): Promise<AgentSessionState> =>
    getRpcConnection().request('session/state', { sessionId }),

  prompt: (sessionId: string, text: string): Promise<void> =>
    getRpcConnection()
      .request('session/prompt', { sessionId, text })
      .then(() => undefined),

  abortSession: (sessionId: string): Promise<AbortSessionResult> =>
    getRpcConnection().request('session/abort', { sessionId }),

  steerPendingMessage: (sessionId: string, messageId: string): Promise<void> =>
    getRpcConnection().request('session/pending/steer', { sessionId, messageId }),

  removePendingMessage: (sessionId: string, messageId: string): Promise<void> =>
    getRpcConnection().request('session/pending/remove', { sessionId, messageId }),

  takePendingMessages: (sessionId: string): Promise<TakePendingMessagesResult> =>
    getRpcConnection().request('session/pending/take', { sessionId }),

  discardPendingMessages: (sessionId: string): Promise<void> =>
    getRpcConnection().request('session/pending/discard', { sessionId }),

  setThinkingLevel: (sessionId: string, level: ThinkingLevel): Promise<AgentSessionState> =>
    getRpcConnection().request('session/thinkingLevel', { sessionId, level }),

  setSessionModel: (sessionId: string, model: ModelReference): Promise<AgentSessionState> =>
    getRpcConnection().request('session/model', { sessionId, model }),
};
