import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { expect, vi } from 'vitest';

import type { ChatMessage, HubEvent, ModelConfig, TestConnectionResult } from '@lvdagun/protocol';

import type { FileConfigStore } from '../../src/config/config-store';
import type { Hub, HubSession } from '../../src/hub/hub';
import { createServer } from '../../src/http/server';

export const TOKEN = 'test-token';

export const validConfig: ModelConfig = {
  provider: 'anthropic',
  apiKey: 'sk-test',
  modelId: 'claude-a',
};

/** 测试用可控 Hub 会话 */
export class FakeSession implements HubSession {
  readonly promptTexts: string[] = [];
  readonly messages: ChatMessage[] = [];
  disposeCalls = 0;
  private idCounter = 0;
  private readonly listeners = new Set<(event: HubEvent) => void>();

  /**
   * 记录用户消息并发送 user_message 事件。
   *
   * @param text - 用户消息文本
   * @returns 已解决的 Promise
   */
  prompt = vi.fn(async (text: string): Promise<void> => {
    this.promptTexts.push(text);
    const message: ChatMessage = { id: `u-${++this.idCounter}`, role: 'user', text };
    this.messages.push(message);
    this.emit({ type: 'user_message', message });
  });

  /**
   * 订阅测试会话事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe = (listener: (event: HubEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * 读取测试会话消息。
   *
   * @returns 消息副本
   */
  getMessages = (): ChatMessage[] => [...this.messages];

  /** 记录会话释放次数 */
  dispose = vi.fn((): void => {
    this.disposeCalls += 1;
  });

  /**
   * 模拟完整的 AI 流式回复。
   *
   * @param text - AI 回复文本
   * @returns 无返回值
   */
  simulateAssistant(text: string): void {
    const messageId = `a-${++this.idCounter}`;
    this.emit({ type: 'assistant_message_start', messageId });
    for (const char of text) {
      this.emit({ type: 'assistant_text_delta', messageId, delta: char });
    }
    const message: ChatMessage = { id: messageId, role: 'assistant', text };
    this.messages.push(message);
    this.emit({ type: 'assistant_message_end', message });
  }

  /** 向测试订阅者发送事件 */
  private emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * 创建可控的测试 Agent Hub。
 *
 * @returns Agent Hub、创建的会话和会话配置记录
 */
export function makeFakeHub(): {
  hub: Hub;
  sessions: FakeSession[];
  createOptions: ModelConfig[];
} {
  const sessions: FakeSession[] = [];
  const createOptions: ModelConfig[] = [];
  const hub: Hub = {
    listProviders: vi.fn(async () => [{ id: 'anthropic', name: 'Anthropic' }]),
    listModels: vi.fn(async (providerId) =>
      providerId === 'anthropic' ? [{ id: 'claude-a', name: 'Claude A' }] : []
    ),
    testConnection: vi.fn(
      async (_provider: string, apiKey: string): Promise<TestConnectionResult> =>
        apiKey === 'good' ? { ok: true } : { ok: false, message: '401 凭证无效' }
    ),
    createSession: vi.fn(async (options) => {
      createOptions.push(options);
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }),
  };
  return { hub, sessions, createOptions };
}

/**
 * 在随机端口启动测试服务。
 *
 * @param hub - 测试 Agent Hub
 * @param configStore - 测试配置存储
 * @param token - 本机访问 token
 * @returns 服务地址与关闭函数
 */
export async function startServer(
  hub: Hub,
  configStore: FileConfigStore,
  token = TOKEN
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = createServer({ hub, configStore, token });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * 打开 SSE 测试连接。
 *
 * @param baseUrl - 测试服务地址
 * @param token - 本机访问 token
 * @returns 逐帧读取事件和关闭连接的方法
 */
export async function openEvents(
  baseUrl: string,
  token: string
): Promise<{ nextEvent: (timeoutMs?: number) => Promise<HubEvent>; close: () => void }> {
  const response = await fetch(`${baseUrl}/api/events`, {
    headers: { 'x-lvdagun-token': token },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async nextEvent(timeoutMs = 2000): Promise<HubEvent> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const separator = buffer.indexOf('\n\n');
        if (separator >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          expect(dataLine).toBeDefined();
          return JSON.parse(dataLine!.slice(6)) as HubEvent;
        }
        if (Date.now() > deadline) {
          throw new Error('等待 SSE 事件超时');
        }
        const result = await Promise.race<
          { done: boolean; value?: Uint8Array } | { done?: undefined }
        >([
          reader.read(),
          new Promise<{ done?: undefined }>((resolve) => setTimeout(() => resolve({}), 50)),
        ]);
        if (result.done === true) {
          throw new Error('SSE 流已关闭');
        }
        if ('value' in result && result.value) {
          buffer += decoder.decode(result.value, { stream: true });
        }
      }
    },
    close(): void {
      void reader.cancel();
    },
  };
}
