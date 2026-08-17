import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/config/config-store';
import { AgentBusyError } from '../../../src/hub/hub';
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

  it('Pi 接受提示后返回 202，忙碌时返回 409', async () => {
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

      sessions[0]!.prompt.mockRejectedValueOnce(new AgentBusyError());
      const busy = await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '并发消息' }),
      });
      expect(busy.status).toBe(409);
      await expect(busy.json()).resolves.toEqual({ error: 'Agent 正在运行' });
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
      expect(abort.status).toBe(204);
      expect(sessions[0]!.abortCalls).toBe(1);

      const next = await fetch(`${baseUrl}/api/sessions`, { method: 'POST' });
      expect(next.status).toBe(201);
      await expect(next.json()).resolves.toEqual({ sessionId: 'session-2' });
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
