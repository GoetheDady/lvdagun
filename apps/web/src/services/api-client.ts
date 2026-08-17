/** @file 客户端普通 HTTP 请求的唯一入口 */
import {
  API_PATHS,
  sessionApiPaths,
  type AgentSessionState,
  type ChatMessage,
  type CreateSessionResult,
  type ModelConfig,
  type ModelInfo,
  type ModelReference,
  type ProviderInfo,
  type SessionSummary,
  type TestConnectionResult,
  type ThinkingLevel,
} from '@lvdagun/protocol';

/** 本地服务返回的带 HTTP 状态码的请求错误。 */
class ApiError extends Error {
  /**
   * 创建接口错误。
   *
   * @param status - HTTP 状态码
   * @param message - 服务端错误说明
   */
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 发起 HTTP 请求，并把非成功响应转换为错误。
 *
 * @param path - 接口路径
 * @param init - Fetch 请求配置
 * @returns 解析后的响应体
 * @throws 网络失败或本地服务返回错误
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `请求失败(${response.status})`);
  }
  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** 本地服务 HTTP 接口集合 */
export const api = {
  getConfig: (): Promise<ModelConfig | null> => request(API_PATHS.config),

  saveConfig: (config: ModelConfig): Promise<void> =>
    request(API_PATHS.config, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }),

  testConnection: (provider: string, apiKey: string): Promise<TestConnectionResult> =>
    request(API_PATHS.testConnection, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    }),

  listProviders: (): Promise<ProviderInfo[]> => request(API_PATHS.providers),

  listModels: (provider: string): Promise<ModelInfo[]> =>
    request(`${API_PATHS.models}?provider=${encodeURIComponent(provider)}`),

  listSessions: (): Promise<SessionSummary[]> => request(API_PATHS.sessions),

  createSession: (): Promise<CreateSessionResult> =>
    request(API_PATHS.sessions, { method: 'POST' }),

  archiveSession: (sessionId: string): Promise<void> =>
    request(sessionApiPaths(sessionId).archive, { method: 'POST' }),

  deleteSession: (sessionId: string): Promise<void> =>
    request(sessionApiPaths(sessionId).state, { method: 'DELETE' }),

  setSessionTitle: (sessionId: string, title: string): Promise<void> =>
    request(sessionApiPaths(sessionId).title, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    }),

  getMessages: (sessionId: string): Promise<ChatMessage[]> =>
    request(sessionApiPaths(sessionId).messages),

  getSessionState: (sessionId: string): Promise<AgentSessionState> =>
    request(sessionApiPaths(sessionId).state),

  prompt: (sessionId: string, text: string): Promise<void> =>
    request(sessionApiPaths(sessionId).prompt, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  abortSession: (sessionId: string): Promise<void> =>
    request(sessionApiPaths(sessionId).abort, { method: 'POST' }),

  setThinkingLevel: (sessionId: string, level: ThinkingLevel): Promise<AgentSessionState> =>
    request(sessionApiPaths(sessionId).thinkingLevel, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level }),
    }),

  setSessionModel: (sessionId: string, model: ModelReference): Promise<AgentSessionState> =>
    request(sessionApiPaths(sessionId).model, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(model),
    }),
};
