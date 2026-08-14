import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HubEvent } from '@lvdagun/backend';

import { api, getToken, initTokenFromUrl, subscribeEvents } from './api';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('initTokenFromUrl', () => {
  it('从 URL 读取 token 存入 localStorage,并从地址栏抹掉', () => {
    window.history.replaceState({}, '', '/?token=abc123');
    initTokenFromUrl();
    expect(getToken()).toBe('abc123');
    expect(window.location.search).not.toContain('token');
  });

  it('URL 无 token 时不动 localStorage', () => {
    window.history.replaceState({}, '', '/');
    initTokenFromUrl();
    expect(getToken()).toBeNull();
  });

  it('URL 无 token 但 localStorage 已有 token 时保留', () => {
    localStorage.setItem('lvdagun-token', 'kept');
    window.history.replaceState({}, '', '/');
    initTokenFromUrl();
    expect(getToken()).toBe('kept');
  });
});

describe('api 请求', () => {
  it('getConfig 携带 token 头并解析 JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { provider: 'anthropic', apiKey: 'k', modelId: 'm' }));
    localStorage.setItem('lvdagun-token', 'tok');
    await expect(api.getConfig()).resolves.toEqual({ provider: 'anthropic', apiKey: 'k', modelId: 'm' });

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

describe('subscribeEvents', () => {
  /** 构造一个流式 Response:若干帧后保持打开(模拟长连接) */
  function sseResponse(frames: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        // 不 close:SSE 长连接由取消方结束
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('逐帧解析 SSE 事件并按序回调', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        'data: {"type":"user_message","message":{"id":"u1","role":"user","text":"你好"}}\n\n',
        // 一次网络包可能含多帧、一帧可能被拆到多个包
        'data: {"type":"assistant_message_start","messageId":"a1"}\n\ndata: {"type":"assistant_t',
        'ext_delta","messageId":"a1","delta":"嗨"}\n\n',
      ])
    );
    localStorage.setItem('lvdagun-token', 'tok');

    const events: HubEvent[] = [];
    subscribeEvents((event) => events.push(event));

    // 等待流消费完已入队的帧
    await vi.waitFor(() => {
      expect(events.length).toBe(3);
    });
    expect(events[0]).toEqual({ type: 'user_message', message: { id: 'u1', role: 'user', text: '你好' } });
    expect(events[2]).toEqual({ type: 'assistant_text_delta', messageId: 'a1', delta: '嗨' });

    // 请求带 token 头
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/events');
    expect((init!.headers as Record<string, string>)['x-lvdagun-token']).toBe('tok');
  });

  it('退订后中止连接', () => {
    vi.mocked(fetch).mockResolvedValue(sseResponse([]));
    localStorage.setItem('lvdagun-token', 'tok');

    const unsubscribe = subscribeEvents(vi.fn());
    unsubscribe();

    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect((init.signal as AbortSignal).aborted).toBe(true);
  });
});
