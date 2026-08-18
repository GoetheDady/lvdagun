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

  it('归档与删除使用按会话寻址的生命周期接口', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await api.archiveSession('session-a');
    await api.deleteSession('session-a');

    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/sessions/session-a/archive',
      { method: 'POST' },
    ]);
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      '/api/sessions/session-a',
      { method: 'DELETE' },
    ]);
  });

  it('使用按会话寻址接口更新标题', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await api.setSessionTitle('session-a', '标题');

    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/sessions/session-a/title',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '标题' }),
      },
    ]);
  });

  it('使用按会话和稳定消息 ID 寻址的待处理消息接口', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(mockFetchResponse(200, { texts: ['第一条'] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await api.steerPendingMessage('session-a', 'pending/a');
    await api.removePendingMessage('session-a', 'pending/a');
    await expect(api.takePendingMessages('session-a')).resolves.toEqual({ texts: ['第一条'] });
    await api.discardPendingMessages('session-a');

    expect(vi.mocked(fetch).mock.calls).toEqual([
      ['/api/sessions/session-a/pending-messages/pending%2Fa/steer', { method: 'POST' }],
      ['/api/sessions/session-a/pending-messages/pending%2Fa', { method: 'DELETE' }],
      ['/api/sessions/session-a/pending-messages/take', { method: 'POST' }],
      ['/api/sessions/session-a/pending-messages', { method: 'DELETE' }],
    ]);
  });
});
