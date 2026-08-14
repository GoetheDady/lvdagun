/** @file 客户端普通 HTTP 请求的唯一入口 */
import {
  API_PATHS,
  TOKEN_HEADER,
  type AgentSessionState,
  type ChatMessage,
  type ModelConfig,
  type ModelInfo,
  type ProviderInfo,
  type TestConnectionResult,
  type ThinkingLevel,
} from '@lvdagun/protocol';

import { getToken } from './access-token';

/**
 * 携带访问 token 发起请求，并把非成功响应转换为错误。
 *
 * @param path - 接口路径
 * @param init - Fetch 请求配置
 * @returns 解析后的响应体
 * @throws 缺少 token、网络失败或本地服务返回错误
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error('缺少访问 token');
  }
  const response = await fetch(path, {
    ...init,
    headers: { ...init?.headers, [TOKEN_HEADER]: token },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败(${response.status})`);
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

  getMessages: (): Promise<ChatMessage[]> => request(API_PATHS.messages),

  getSessionState: (): Promise<AgentSessionState> => request(API_PATHS.sessionState),

  prompt: (text: string): Promise<void> =>
    request(API_PATHS.prompt, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  newSession: (): Promise<void> => request(API_PATHS.newSession, { method: 'POST' }),

  abortSession: (): Promise<void> => request(API_PATHS.abortSession, { method: 'POST' }),

  setThinkingLevel: (level: ThinkingLevel): Promise<AgentSessionState> =>
    request(API_PATHS.thinkingLevel, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level }),
    }),
};
