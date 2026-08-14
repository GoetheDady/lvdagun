import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/config/config-store';
import { AgentBusyError } from '../../../src/hub/hub';
import { makeFakeHub, startServer, TOKEN, validConfig } from '../test-server';

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
      const response = await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
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
      const accepted = await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      expect(accepted.status).toBe(202);

      sessions[0]!.prompt.mockRejectedValueOnce(new AgentBusyError());
      const busy = await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '并发消息' }),
      });
      expect(busy.status).toBe(409);
      await expect(busy.json()).resolves.toEqual({ error: 'Agent 正在运行' });
    } finally {
      await close();
    }
  });

  it('返回状态并委托中止、新会话和思考等级控制', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const stateResponse = await fetch(`${baseUrl}/api/session`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      await expect(stateResponse.json()).resolves.toEqual({
        isRunning: false,
        thinkingLevel: 'medium',
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
      });

      const thinking = await fetch(`${baseUrl}/api/session/thinking-level`, {
        method: 'PUT',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'high' }),
      });
      expect(thinking.status).toBe(200);
      await expect(thinking.json()).resolves.toMatchObject({ thinkingLevel: 'high' });

      const invalidThinking = await fetch(`${baseUrl}/api/session/thinking-level`, {
        method: 'PUT',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'max' }),
      });
      expect(invalidThinking.status).toBe(400);

      const abort = await fetch(`${baseUrl}/api/session/abort`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN },
      });
      expect(abort.status).toBe(204);
      expect(sessions[0]!.abortCalls).toBe(1);

      const next = await fetch(`${baseUrl}/api/session/new`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN },
      });
      expect(next.status).toBe(204);
      expect(sessions[0]!.newSessionCalls).toBe(1);
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
      const response = await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });
});
