import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RpcConnection } from '@/services/rpc-client';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocol: string
  ) {
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function failSocket(socket: MockWebSocket): void {
  socket.onerror?.();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function openConnection(connection: RpcConnection): Promise<MockWebSocket> {
  const openingRequest = connection.request<unknown>('catalog/listProviders');
  const socket = MockWebSocket.instances[0]!;
  socket.open();
  const initialize = JSON.parse(socket.sent[0]!) as { id: number };
  socket.receive({
    jsonrpc: '2.0',
    id: initialize.id,
    result: { protocolVersion: 1 },

  });
  await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
  const request = JSON.parse(socket.sent[1]!) as { id: number };
  socket.receive({ jsonrpc: '2.0', id: request.id, result: [] });
  await openingRequest;
  return socket;
}

describe('RpcConnection', () => {
  it('协议初始化完成后才标记为已连接', async () => {
    const connection = new RpcConnection();
    const statuses: string[] = [];
    connection.subscribeStatus(() => statuses.push(connection.getStatus()));
    const request = connection.request<unknown>('catalog/listProviders');
    const socket = MockWebSocket.instances[0]!;

    expect(connection.getStatus()).toBe('connecting');
    socket.open();
    expect(connection.getStatus()).toBe('connecting');
    const initialize = JSON.parse(socket.sent[0]!) as { id: number };
    socket.receive({
      jsonrpc: '2.0',
      id: initialize.id,
      result: { protocolVersion: 1 },

    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    const listProviders = JSON.parse(socket.sent[1]!) as { id: number };
    socket.receive({ jsonrpc: '2.0', id: listProviders.id, result: [] });
    await request;

    expect(connection.getStatus()).toBe('connected');
    expect(statuses).toEqual(['connected']);
  });

  it('失败后自动重连五次，耗尽后保持红色并等待手动重连', async () => {
    vi.useFakeTimers();
    const connection = new RpcConnection();
    const request = connection.request<unknown>('catalog/listProviders').catch(() => undefined);

    failSocket(MockWebSocket.instances[0]!);
    await flushMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(1);

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      const socketCountBeforeRetry = MockWebSocket.instances.length;
      vi.advanceTimersByTime(delay);
      await flushMicrotasks();
      expect(MockWebSocket.instances).toHaveLength(socketCountBeforeRetry + 1);
      failSocket(MockWebSocket.instances.at(-1)!);
      await flushMicrotasks();
    }

    await request;
    expect(MockWebSocket.instances).toHaveLength(6);
    expect(connection.getStatus()).toBe('failed');
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(6);

    connection.reconnect();
    await flushMicrotasks();
    expect(connection.getStatus()).toBe('connecting');
    expect(MockWebSocket.instances).toHaveLength(7);
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    const initialize = JSON.parse(socket.sent[0]!) as { id: number };
    socket.receive({
      jsonrpc: '2.0',
      id: initialize.id,
      result: { protocolVersion: 1 },

    });
    await flushMicrotasks();
    expect(connection.getStatus()).toBe('connected');
  });

  it('通过 id 匹配并发请求的乱序响应', async () => {
    const connection = new RpcConnection();
    const socket = await openConnection(connection);
    const first = connection.request<unknown[]>('catalog/listModels', { provider: 'a' });
    const second = connection.request<unknown[]>('catalog/listModels', { provider: 'b' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(4));
    const firstRequest = JSON.parse(socket.sent[2]!) as { id: number };
    const secondRequest = JSON.parse(socket.sent[3]!) as { id: number };

    const firstResult = [{ id: 'first', name: 'First' }];
    const secondResult = [{ id: 'second', name: 'Second' }];
    socket.receive({ jsonrpc: '2.0', id: secondRequest.id, result: secondResult });
    socket.receive({ jsonrpc: '2.0', id: firstRequest.id, result: firstResult });

    await expect(first).resolves.toEqual(firstResult);
    await expect(second).resolves.toEqual(secondResult);
  });

  it('每个列表订阅者都拉取权威快照，双挂载不丢初始列表', async () => {
    const connection = new RpcConnection();
    const socket = await openConnection(connection);

    // 模拟 StrictMode 双挂载：第一个订阅尚未结束时第二个已加入
    const onListA = vi.fn();
    const onListB = vi.fn();
    const pendingA = connection.subscribeSessionList({ onList: onListA });
    const pendingB = connection.subscribeSessionList({ onList: onListB });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(4));
    const requestA = JSON.parse(socket.sent[2]!) as { id: number };
    const requestB = JSON.parse(socket.sent[3]!) as { id: number };
    socket.receive({ jsonrpc: '2.0', id: requestA.id, result: [] });
    socket.receive({ jsonrpc: '2.0', id: requestB.id, result: [] });

    await pendingA;
    await pendingB;
    expect(onListA).toHaveBeenCalledTimes(1);
    expect(onListB).toHaveBeenCalledTimes(1);
  });

  it('拒绝不符合共享协议的服务端通知', async () => {
    const connection = new RpcConnection();
    const socket = await openConnection(connection);
    const onEvent = vi.fn();
    const onError = vi.fn();
    const subscribing = connection.subscribeSession('session-1', { onEvent, onError });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    const request = JSON.parse(socket.sent[2]!) as { id: number };
    socket.receive({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        type: 'session_snapshot',
        history: {
          schemaVersion: 1,
          sessionId: 'session-1',
          branchId: 'branch-1',
          revision: 0,
          runs: [],
          draft: null,
          blobs: {},
          executionPlan: null,
        },
        state: {
          sessionName: null,
          executionAvailable: true,
          isRunning: false,
          activeCompaction: null,
          pendingMessages: [],
          thinkingLevel: 'off',
          availableThinkingLevels: ['off'],
          model: {
            provider: 'anthropic',
            providerName: 'Anthropic',
            id: 'claude-a',
            name: 'Claude A',
          },
          availableModels: [],
          modelWarning: null,
        },
      },
    });
    const unsubscribe = await subscribing;

    socket.receive({
      jsonrpc: '2.0',
      method: 'session/event',
      params: { sessionId: 'session-1', event: {} },
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
