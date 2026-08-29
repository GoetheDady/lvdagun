import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileConfigStore } from '../../src/config/config-store';
import { MemoryHistoryRepository } from '../history/memory-history-repository';
import { makeFakeHub, startServer, validConfig } from './test-server';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-rpc-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** @param baseUrl - HTTP 地址 @returns RPC 测试连接 */
function openRpc(baseUrl: string) {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/rpc`, 'lvdagun-jsonrpc');
  const messages: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  return {
    socket,
    next: () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const message = messages.shift();
        if (message) resolve(message);
        else waiters.push(resolve);
      }),
  };
}

/** @param socket - WebSocket @param message - JSON-RPC 消息 */
async function send(socket: WebSocket, message: unknown): Promise<void> {
  if (socket.readyState === WebSocket.CONNECTING) {
    await new Promise<void>((resolve) => socket.once('open', resolve));
  }
  socket.send(JSON.stringify(message));
}

/** @param rpc - RPC 测试连接 */
async function initialize(rpc: ReturnType<typeof openRpc>): Promise<void> {
  await send(rpc.socket, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: 2, clientInfo: { name: 'test', version: '1' }, capabilities: {} },
  });
  await expect(rpc.next()).resolves.toMatchObject({ id: 1, result: { protocolVersion: 2 } });
}

describe('JSON-RPC WebSocket', () => {
  it('初始化后返回产品历史快照', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    const rpc = openRpc(baseUrl);
    try {
      await initialize(rpc);
      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/subscribe',
        params: { sessionId: 'session-1' },
      });
      await expect(rpc.next()).resolves.toMatchObject({
        id: 2,
        result: {
          type: 'session_snapshot',
          history: {
            schemaVersion: 1,
            sessionId: 'session-1',
            runs: [],
            executionPlan: null,
          },
        },
      });
    } finally {
      rpc.socket.close();
      await close();
    }
  });

  it('拒绝未初始化请求和不兼容协议', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    const rpc = openRpc(baseUrl);
    try {
      await send(rpc.socket, { jsonrpc: '2.0', id: 1, method: 'session/list' });
      await expect(rpc.next()).resolves.toMatchObject({ id: 1, error: { code: -32600 } });
      const incompatible = openRpc(baseUrl);
      await send(incompatible.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: 99,
          clientInfo: { name: 'test', version: '1' },
          capabilities: {},
        },
      });
      await expect(incompatible.next()).resolves.toMatchObject({ id: 2, error: { code: -32602 } });
      incompatible.socket.close();
    } finally {
      rpc.socket.close();
      await close();
    }
  });

  it('校验产品分叉参数使用 runId', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    const rpc = openRpc(baseUrl);
    try {
      await initialize(rpc);
      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/fork',
        params: { sessionId: 'session-1', entryId: 'entry-a' },
      });
      await expect(rpc.next()).resolves.toMatchObject({ id: 2, error: { code: -32602 } });
    } finally {
      rpc.socket.close();
      await close();
    }
  });

  it('使用产品 runId 分叉并使用 itemId 编辑重发', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close, history } = await startServer(hub, store);
    const runId = history.acceptPrompt('session-1', '原问题');
    history.mutate('session-1', (session) => {
      const run = session.branches[0]!.runs[0]!;
      run.status = 'completed';
      run.items.push({
        type: 'assistant_segment',
        itemId: 'assistant-a',
        runId,
        createdAt: 2,
        status: 'completed',
        content: [{ type: 'text', text: '原回答' }],
      });
    });
    const userItem = history.getSnapshot('session-1').runs[0]!.items[0]!;
    history.savePiEntryReference('session-1', userItem.itemId, 'pi-user-a');
    history.savePiEntryReference('session-1', 'assistant-a', 'pi-assistant-a');
    const rpc = openRpc(baseUrl);
    try {
      await initialize(rpc);
      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/fork',
        params: { sessionId: 'session-1', runId },
      });
      await expect(rpc.next()).resolves.toMatchObject({
        id: 2,
        result: { sessionId: expect.any(String) },
      });
      expect(hub.forkSession).toHaveBeenCalledWith(
        validConfig,
        'pi-session-1',
        'pi-assistant-a',
        expect.any(String)
      );

      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 3,
        method: 'session/editResend',
        params: { sessionId: 'session-1', itemId: userItem.itemId, text: '新问题' },
      });
      await expect(rpc.next()).resolves.toMatchObject({
        id: 3,
        result: { history: { sessionId: 'session-1' } },
      });
      expect(sessions[0]!.lastEditedEntryId).toBe('pi-user-a');
    } finally {
      rpc.socket.close();
      await close();
    }
  });

  it('Pi JSONL 丢失时仍返回可读产品快照', async () => {
    const { hub, sessions } = makeFakeHub();
    sessions.splice(0);
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    const rpc = openRpc(baseUrl);
    try {
      await initialize(rpc);
      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/subscribe',
        params: { sessionId: 'session-1' },
      });
      await expect(rpc.next()).resolves.toMatchObject({
        id: 2,
        result: {
          history: { sessionId: 'session-1' },
          state: { executionAvailable: false },
        },
      });
    } finally {
      rpc.socket.close();
      await close();
    }
  });

  it('自动标题先写入产品历史再广播', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close, history } = await startServer(hub, store);
    const rpc = openRpc(baseUrl);
    try {
      await initialize(rpc);
      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/subscribe',
        params: { sessionId: 'session-1' },
      });
      await rpc.next();
      sessions[0]!.emit({ type: 'session_info_changed', name: '自动标题' });

      await expect(rpc.next()).resolves.toMatchObject({
        method: 'session/event',
        params: { event: { type: 'session_history_changed' } },
      });
      expect(history.listSessions()[0]!.title).toBe('自动标题');
      await expect(rpc.next()).resolves.toMatchObject({
        method: 'session/event',
        params: { event: { type: 'session_info_changed', name: '自动标题' } },
      });
    } finally {
      rpc.socket.close();
      await close();
    }
  });

  it('产品历史写入失败时中止 Pi 并锁定会话', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const repository = new MemoryHistoryRepository();
    const { baseUrl, close, agentHub } = await startServer(hub, store, repository);
    const rpc = openRpc(baseUrl);
    const error = new Error('磁盘写入失败');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await initialize(rpc);
      await send(rpc.socket, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/subscribe',
        params: { sessionId: 'session-1' },
      });
      await rpc.next();
      sessions[0]!.running = true;
      repository.saveFailure = error;
      sessions[0]!.emit({ type: 'session_info_changed', name: '无法保存的标题' });

      expect(sessions[0]!.running).toBe(false);
      await expect(agentHub.getState('session-1')).rejects.toMatchObject({
        name: 'AgentBusyError',
      });
      expect(consoleError).toHaveBeenCalledWith('产品会话历史写入失败:', error);
    } finally {
      repository.saveFailure = null;
      consoleError.mockRestore();
      rpc.socket.close();
      await close();
    }
  });
});
