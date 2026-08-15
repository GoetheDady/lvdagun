import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/services/api-client';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 构造 JSON Fetch 响应。
 *
 * @param status - HTTP 状态码
 * @param body - JSON 响应体
 * @returns Fetch Response
 */
function mockFetchResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api 请求', () => {
  it('getConfig 请求接口并解析 JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, { provider: 'anthropic', apiKey: 'k', modelId: 'm' })
    );
    await expect(api.getConfig()).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'k',
      modelId: 'm',
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/config');
    expect(init).toBeUndefined();
  });

  it('服务端错误时抛带错误信息的异常', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(409, { error: '尚未配置模型' }));
    await expect(api.getConfig()).rejects.toThrow('尚未配置模型');
  });

  it('prompt 以 POST JSON 发送文本', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    await api.prompt('session-a', '你好');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/sessions/session-a/prompt');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe(JSON.stringify({ text: '你好' }));
  });

  it('创建会话并解析返回的 session id', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(201, { sessionId: 'session-a' }));
    await expect(api.createSession()).resolves.toEqual({ sessionId: 'session-a' });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/sessions');
  });
});
