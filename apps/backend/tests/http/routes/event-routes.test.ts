import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentStreamEvent, ChatMessage } from '@lvdagun/protocol';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, openEvents, startServer, TOKEN, validConfig } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-event-routes-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * 从结构化 Pi 消息中读取第一段文本。
 *
 * @param message - Pi 消息
 * @returns 第一段文本，没有文本时返回空字符串
 */
function firstText(message: ChatMessage): string {
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : message.content.find((content) => content.type === 'text')?.text ?? '';
  }
  if (message.role === 'assistant' || message.role === 'toolResult') {
    return message.content.find((content) => content.type === 'text')?.text ?? '';
  }
  return '';
}

describe('事件流接口', () => {
  it('原样推送 Pi JSON 事件并返回完整结构化历史', async () => {
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
      await expect(events.nextEvent()).resolves.toEqual({ type: 'agent_start' });
      await expect(events.nextEvent()).resolves.toMatchObject({
        type: 'message_start',
        message: { role: 'user', content: '你好' },
      });
      await expect(events.nextEvent()).resolves.toMatchObject({
        type: 'message_end',
        message: { role: 'user', content: '你好' },
      });

      sessions[0]!.simulateAssistant('你好呀');
      await expect(events.nextEvent()).resolves.toMatchObject({
        type: 'message_start',
        message: { role: 'assistant' },
      });
      await expect(events.nextEvent()).resolves.toEqual({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
      });
      await expect(events.nextEvent()).resolves.toEqual({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你' },
      });

      let endEvent: AgentStreamEvent;
      for (;;) {
        endEvent = await events.nextEvent();
        if (endEvent.type === 'message_end') {
          break;
        }
      }
      expect(endEvent).toMatchObject({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: '你好呀' }] },
      });

      const messages = await fetch(`${baseUrl}/api/messages`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      const history = (await messages.json()) as ChatMessage[];
      expect(history.map((message) => [message.role, firstText(message)])).toEqual([
        ['user', '你好'],
        ['assistant', '你好呀'],
      ]);
    } finally {
      events.close();
      await close();
    }
  });

  it('新会话使用 Pi 原生能力且不产生 Hub 自定义事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      sessions[0]!.isRunning = false;

      const response = await fetch(`${baseUrl}/api/session/new`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN },
      });
      expect(response.status).toBe(204);
      expect(sessions[0]!.newSessionCalls).toBe(1);

      const messages = await fetch(`${baseUrl}/api/messages`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      await expect(messages.json()).resolves.toEqual([]);
    } finally {
      await close();
    }
  });
});
