import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@lvdagun/protocol';

import { subscribeEvents } from '@/services/event-stream';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();

  /** @param url - 事件流地址 */
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscribeEvents', () => {
  it('解析原生 EventSource 消息并按序回调', () => {
    const events: AgentStreamEvent[] = [];
    subscribeEvents('session-a', (event) => events.push(event));
    const source = FakeEventSource.instances[0]!;

    source.onmessage?.({ data: '{"type":"agent_start"}' } as MessageEvent<string>);
    source.onmessage?.({
      data: '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"嗨"}}',
    } as MessageEvent<string>);

    expect(source.url).toBe('/api/sessions/session-a/events');
    expect(events).toEqual([
      { type: 'agent_start' },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '嗨' },
      },
    ]);
  });

  it('连接失败交给原生 EventSource 重连，只有退订才关闭', () => {
    const onDisconnect = vi.fn();
    const unsubscribe = subscribeEvents('session-a', vi.fn(), onDisconnect);
    const source = FakeEventSource.instances[0]!;

    source.onerror?.(new Event('error'));
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(source.close).not.toHaveBeenCalled();

    unsubscribe();

    expect(source.close).toHaveBeenCalledOnce();
  });
});
