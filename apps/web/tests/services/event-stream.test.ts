import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@lvdagun/protocol';

import { subscribeEvents } from '@/services/event-stream';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 构造保持打开的 SSE 响应。
 *
 * @param frames - 依次写入的原始 SSE 数据块
 * @returns 流式 Fetch Response
 */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('subscribeEvents', () => {
  it('逐帧解析 SSE 事件并按序回调', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sseResponse([
        'data: {"type":"agent_start"}\n\n',
        'data: {"type":"message_start","message":{"role":"user","content":"你好","timestamp":1}}\n\ndata: {"type":"message_up',
        'date","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"嗨"}}\n\n',
      ])
    );
    localStorage.setItem('lvdagun-token', 'tok');

    const events: AgentStreamEvent[] = [];
    subscribeEvents((event) => events.push(event));

    await vi.waitFor(() => {
      expect(events.length).toBe(3);
    });
    expect(events[0]).toEqual({ type: 'agent_start' });
    expect(events[2]).toEqual({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '嗨' },
    });

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
