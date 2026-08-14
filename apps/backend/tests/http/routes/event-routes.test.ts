import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage, HubEvent } from '@lvdagun/protocol';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, openEvents, startServer, TOKEN, validConfig } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-event-routes-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('事件流接口', () => {
  it('推送完整对话流并允许恢复消息历史', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    const events = await openEvents(baseUrl, TOKEN);
    try {
      const response = await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      expect(response.status).toBe(202);
      await expect(events.nextEvent()).resolves.toMatchObject({
        type: 'user_message',
        message: { role: 'user', text: '你好' },
      });

      sessions[0]!.simulateAssistant('你好呀');
      await expect(events.nextEvent()).resolves.toMatchObject({ type: 'assistant_message_start' });
      await expect(events.nextEvent()).resolves.toMatchObject({
        type: 'assistant_text_delta',
        delta: '你',
      });

      let endEvent: HubEvent;
      for (;;) {
        endEvent = await events.nextEvent();
        if (endEvent.type === 'assistant_message_end') break;
      }
      expect(endEvent).toMatchObject({
        type: 'assistant_message_end',
        message: { role: 'assistant', text: '你好呀' },
      });

      const messages = await fetch(`${baseUrl}/api/messages`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      const history = (await messages.json()) as ChatMessage[];
      expect(history.map((message) => [message.role, message.text])).toEqual([
        ['user', '你好'],
        ['assistant', '你好呀'],
      ]);
    } finally {
      events.close();
      await close();
    }
  });

  it('清空会话时推送 session_cleared 并清空历史', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    const events = await openEvents(baseUrl, TOKEN);
    try {
      await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      await events.nextEvent();

      const response = await fetch(`${baseUrl}/api/session/clear`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN },
      });
      expect(response.status).toBe(204);
      await expect(events.nextEvent()).resolves.toEqual({ type: 'session_cleared' });
      expect(sessions[0]!.disposeCalls).toBe(1);

      const messages = await fetch(`${baseUrl}/api/messages`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      await expect(messages.json()).resolves.toEqual([]);
    } finally {
      events.close();
      await close();
    }
  });
});
