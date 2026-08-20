import { describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent } from '@lvdagun/protocol';

const subscribeSession = vi.fn();
vi.mock('@/services/rpc-client', () => ({ getRpcConnection: () => ({ subscribeSession }) }));

import { subscribeEvents } from '@/services/session-events';

describe('RPC 会话事件订阅', () => {
  it('按会话订阅回调事件并提供退订函数', async () => {
    let listener: ((event: AgentStreamEvent) => void) | undefined;
    const close = vi.fn();
    subscribeSession.mockImplementation(
      async (_id: string, subscription: { onEvent: typeof listener }) => {
        listener = subscription.onEvent;
        return close;
      }
    );
    const events: AgentStreamEvent[] = [];
    const unsubscribe = subscribeEvents('session-a', (event) => events.push(event));
    await vi.waitFor(() => expect(listener).toBeDefined());
    listener!({ type: 'session_info_changed', name: '新标题' });
    expect(events).toEqual([{ type: 'session_info_changed', name: '新标题' }]);
    unsubscribe();
    expect(close).toHaveBeenCalledOnce();
  });

  it('把断线和订阅错误交给调用方', async () => {
    const onDisconnect = vi.fn();
    const onError = vi.fn();
    subscribeSession.mockImplementation(
      async (
        _id: string,
        subscription: { onDisconnect: () => void; onError: (error: Error) => void }
      ) => {
        subscription.onDisconnect();
        subscription.onError(new Error('坏连接'));
        return vi.fn();
      }
    );
    subscribeEvents('session-a', vi.fn(), onDisconnect, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
