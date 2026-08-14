/**
 * @file 客户端侧 API 封装:本地服务唯一的 HTTP 客户端。
 *
 * 页面组件只依赖本模块,不直接发 fetch;
 * token 从 URL 一次性读取存入 localStorage,之后所有请求自动携带。
 */
import type { ChatMessage, HubEvent, ModelConfig, ModelInfo, ProviderInfo, TestConnectionResult } from '@lvdagun/backend';

const TOKEN_KEY = 'lvdagun-token';

/**
 * 从地址栏读取一次性 token(?token=xxx),存入 localStorage 并抹掉 URL。
 *
 * 必须在使用任何 api 函数之前调用(入口 main.tsx)。
 * 抹掉 URL 的原因:避免浏览器历史/分享/截屏泄露 token。
 */
export function initTokenFromUrl(): void {
  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url);
  }
}

/**
 * 读取当前 token。
 *
 * @returns token;尚未从 URL 初始化且本地无缓存时为 null
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 统一请求入口:携带 token 头,非 2xx 抛服务端错误信息。
 *
 * @param path - 接口路径
 * @param init - fetch 配置
 * @returns 解析后的响应体
 * @throws 缺 token、网络失败或服务端错误
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error('缺少访问 token');
  }
  const response = await fetch(path, {
    ...init,
    headers: { ...init?.headers, 'x-lvdagun-token': token },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败(${response.status})`);
  }
  // 202/204:无响应体(如 prompt、clear)
  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** 本地服务接口集合 */
export const api = {
  getConfig: (): Promise<ModelConfig | null> => request('/api/config'),

  saveConfig: (config: ModelConfig): Promise<void> =>
    request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }),

  testConnection: (provider: string, apiKey: string): Promise<TestConnectionResult> =>
    request('/api/test-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    }),

  listProviders: (): Promise<ProviderInfo[]> => request('/api/providers'),

  listModels: (provider: string): Promise<ModelInfo[]> =>
    request(`/api/models?provider=${encodeURIComponent(provider)}`),

  getMessages: (): Promise<ChatMessage[]> => request('/api/messages'),

  prompt: (text: string): Promise<void> =>
    request('/api/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  clearSession: (): Promise<void> => request('/api/session/clear', { method: 'POST' }),
};

/**
 * 订阅 Hub 事件流(SSE)。
 *
 * 用 fetch 流式读取而非 EventSource:可携带自定义 token 头。
 *
 * @param onEvent - 事件回调
 * @param onError - 连接错误回调(可选)
 * @returns 退订函数
 */
export function subscribeEvents(
  onEvent: (event: HubEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const token = getToken();
  const controller = new AbortController();
  if (!token) {
    onError?.(new Error('缺少访问 token'));
    return () => controller.abort();
  }

  void (async () => {
    try {
      const response = await fetch('/api/events', {
        headers: { 'x-lvdagun-token': token },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        onError?.(new Error(`事件流连接失败(${response.status})`));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator: number;
        while ((separator = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine) {
            onEvent(JSON.parse(dataLine.slice(6)) as HubEvent);
          }
        }
      }
    } catch (error) {
      // 主动退订会 abort,不算错误
      if (!controller.signal.aborted) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();

  return () => controller.abort();
}
