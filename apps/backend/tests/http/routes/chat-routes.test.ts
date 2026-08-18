import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, startServer, validConfig } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-chat-routes-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('对话接口', () => {
  it('未配置时发送消息返回 409', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const response = await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      expect(response.status).toBe(409);
    } finally {
      await close();
    }
  });

  it('Pi 接受首条提示，运行期间的后续提示默认进入待处理区', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const accepted = await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      expect(accepted.status).toBe(202);

      const queued = await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '并发消息' }),
      });
      expect(queued.status).toBe(202);
      expect(sessions[0]!.prompt).toHaveBeenCalledTimes(1);
      const state = await fetch(`${baseUrl}/api/sessions/session-1`);
      await expect(state.json()).resolves.toMatchObject({
        pendingMessages: [{ id: 'pending-1', text: '并发消息' }],
      });
    } finally {
      await close();
    }
  });

  it('返回状态并委托中止、创建会话和思考等级控制', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const stateResponse = await fetch(`${baseUrl}/api/sessions/session-1`);
      await expect(stateResponse.json()).resolves.toEqual({
        sessionName: null,
        isRunning: false,
        activeCompaction: null,
        pendingMessages: [],
        thinkingLevel: 'medium',
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
        model: {
          provider: 'anthropic',
          providerName: 'Anthropic',
          id: 'claude-a',
          name: 'Claude A',
        },
        availableModels: [
          {
            provider: 'anthropic',
            providerName: 'Anthropic',
            id: 'claude-a',
            name: 'Claude A',
          },
          { provider: 'openai', providerName: 'OpenAI', id: 'gpt-a', name: 'GPT A' },
        ],
        modelWarning: null,
      });

      const thinking = await fetch(`${baseUrl}/api/sessions/session-1/thinking-level`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'high' }),
      });
      expect(thinking.status).toBe(200);
      await expect(thinking.json()).resolves.toMatchObject({ thinkingLevel: 'high' });

      const invalidThinking = await fetch(`${baseUrl}/api/sessions/session-1/thinking-level`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'max' }),
      });
      expect(invalidThinking.status).toBe(400);

      const abort = await fetch(`${baseUrl}/api/sessions/session-1/abort`, { method: 'POST' });
      expect(abort.status).toBe(200);
      await expect(abort.json()).resolves.toEqual({ restoredTexts: [] });
      expect(sessions[0]!.abortCalls).toBe(1);

      const next = await fetch(`${baseUrl}/api/sessions`, { method: 'POST' });
      expect(next.status).toBe(201);
      await expect(next.json()).resolves.toEqual({ sessionId: 'session-2' });
    } finally {
      await close();
    }
  });

  it('支持逐条调整方向、删除以及整队取回和丢弃', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '开始任务' }),
      });
      const session = sessions[0]!;
      session.enqueuePendingMessage('第一条');
      const first = session.pendingMessages.at(-1)!;
      session.enqueuePendingMessage('第二条');
      const second = session.pendingMessages.at(-1)!;

      const steer = await fetch(
        `${baseUrl}/api/sessions/session-1/pending-messages/${first.id}/steer`,
        { method: 'POST' }
      );
      expect(steer.status).toBe(204);

      const remove = await fetch(
        `${baseUrl}/api/sessions/session-1/pending-messages/${second.id}`,
        { method: 'DELETE' }
      );
      expect(remove.status).toBe(204);

      session.enqueuePendingMessage('取回一');
      session.enqueuePendingMessage('取回二');
      const take = await fetch(`${baseUrl}/api/sessions/session-1/pending-messages/take`, {
        method: 'POST',
      });
      expect(take.status).toBe(200);
      await expect(take.json()).resolves.toEqual({ texts: ['取回一', '取回二'] });

      session.enqueuePendingMessage('丢弃');
      const discard = await fetch(`${baseUrl}/api/sessions/session-1/pending-messages`, {
        method: 'DELETE',
      });
      expect(discard.status).toBe(204);
      expect(session.pendingMessages).toEqual([]);
    } finally {
      await close();
    }
  });

  it('按会话切换跨 Provider 模型并返回权威状态', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const response = await fetch(`${baseUrl}/api/sessions/session-1/model`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', id: 'gpt-a' }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        model: { provider: 'openai', id: 'gpt-a', name: 'GPT A' },
      });
      expect(sessions[0]!.setModel).toHaveBeenCalledWith({ provider: 'openai', id: 'gpt-a' });
    } finally {
      await close();
    }
  });

  it('空提示返回 400', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const response = await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('校验并持久化手动会话标题', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const invalid = await fetch(`${baseUrl}/api/sessions/session-1/title`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '   ' }),
      });
      expect(invalid.status).toBe(400);

      const renamed = await fetch(`${baseUrl}/api/sessions/session-1/title`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '  手动标题  ' }),
      });
      expect(renamed.status).toBe(204);
      expect(sessions[0]!.setSessionName).toHaveBeenCalledWith('手动标题');
    } finally {
      await close();
    }
  });

  it('归档会话后返回 204，后续普通访问返回 410', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/sessions/session-1`);
      const archived = await fetch(`${baseUrl}/api/sessions/session-1/archive`, {
        method: 'POST',
      });
      expect(archived.status).toBe(204);

      const unavailable = await fetch(`${baseUrl}/api/sessions/session-1`);
      expect(unavailable.status).toBe(410);
      await expect(unavailable.json()).resolves.toEqual({ error: '会话已归档:session-1' });
    } finally {
      await close();
    }
  });

  it('永久删除会话后返回 204，后续普通访问返回 404', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/sessions/session-1`);
      const deleted = await fetch(`${baseUrl}/api/sessions/session-1`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);

      const unavailable = await fetch(`${baseUrl}/api/sessions/session-1`);
      expect(unavailable.status).toBe(404);
      await expect(unavailable.json()).resolves.toEqual({ error: '会话不存在:session-1' });
    } finally {
      await close();
    }
  });

  it('运行中的会话拒绝归档和删除', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '执行任务' }),
      });

      const archived = await fetch(`${baseUrl}/api/sessions/session-1/archive`, {
        method: 'POST',
      });
      const deleted = await fetch(`${baseUrl}/api/sessions/session-1`, { method: 'DELETE' });
      expect(archived.status).toBe(409);
      expect(deleted.status).toBe(409);
    } finally {
      await close();
    }
  });
});
