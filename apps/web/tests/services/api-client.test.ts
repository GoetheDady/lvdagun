import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/services/api-client';

beforeEach(() => {
  localStorage.clear();
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
  it('getConfig 携带 token 头并解析 JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, { provider: 'anthropic', apiKey: 'k', modelId: 'm' })
    );
    localStorage.setItem('lvdagun-token', 'tok');
    await expect(api.getConfig()).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'k',
      modelId: 'm',
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/config');
    expect((init!.headers as Record<string, string>)['x-lvdagun-token']).toBe('tok');
  });

  it('无 token 时请求直接失败', async () => {
    await expect(api.getConfig()).rejects.toThrow('缺少访问 token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('服务端错误时抛带错误信息的异常', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(409, { error: '尚未配置模型' }));
    localStorage.setItem('lvdagun-token', 'tok');
    await expect(api.getConfig()).rejects.toThrow('尚未配置模型');
  });

  it('prompt 以 POST JSON 发送文本', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    localStorage.setItem('lvdagun-token', 'tok');
    await api.prompt('你好');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/prompt');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe(JSON.stringify({ text: '你好' }));
  });
});
