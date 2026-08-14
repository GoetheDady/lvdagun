import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileConfigStore } from './config';
import type { Hub, HubSession } from './hub';
import type { ChatMessage, HubEvent, ModelConfig, TestConnectionResult } from './protocol';
import { createServer } from './server';

const TOKEN = 'test-token';

/** 测试用可控会话:prompt 按真实契约发出 user_message,assistant 流由测试手动驱动 */
class FakeSession implements HubSession {
  readonly promptTexts: string[] = [];
  readonly messages: ChatMessage[] = [];
  disposeCalls = 0;
  private idCounter = 0;
  private readonly listeners = new Set<(event: HubEvent) => void>();

  prompt = vi.fn(async (text: string) => {
    this.promptTexts.push(text);
    const message: ChatMessage = { id: `u-${++this.idCounter}`, role: 'user', text };
    this.messages.push(message);
    this.emit({ type: 'user_message', message });
  });

  subscribe = (listener: (event: HubEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getMessages = (): ChatMessage[] => [...this.messages];

  dispose = vi.fn(() => {
    this.disposeCalls += 1;
  });

  /** 模拟 AI 流式回复:start → 逐字 delta → end */
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

  private emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** 可控 Hub:目录能力返回固定数据,createSession 记录每次调用并返回 FakeSession */
function makeFakeHub(): { hub: Hub; sessions: FakeSession[]; createOptions: Array<Hub['createSession'] extends (o: infer O) => unknown ? O : never> } {
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

/** 在随机端口启动服务,返回 baseUrl 与关闭函数 */
async function startServer(hub: Hub, configStore: FileConfigStore, token = TOKEN): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = createServer({ hub, configStore, token });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 打开 SSE 流,返回逐帧读事件的方法 */
async function openEvents(baseUrl: string, token: string): Promise<{ nextEvent: (timeoutMs?: number) => Promise<HubEvent>; close: () => void }> {
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
      while (true) {
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
        const result = await Promise.race<{ done: boolean; value?: Uint8Array } | { done?: undefined }>([
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
    close() {
      void reader.cancel();
    },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-server-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const validConfig: ModelConfig = { provider: 'anthropic', apiKey: 'sk-test', modelId: 'claude-a' };

describe('认证', () => {
  it('无 token 的请求被拒绝(401)', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    const { baseUrl, close } = await startServer(hub, store);
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      expect(response.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('token 错误同样 401', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(join(dir, 'config.json')));
    try {
      const response = await fetch(`${baseUrl}/api/config`, {
        headers: { 'x-lvdagun-token': 'wrong' },
      });
      expect(response.status).toBe(401);
    } finally {
      await close();
    }
  });
});

describe('配置接口', () => {
  it('GET 未配置时返回 null', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(join(dir, 'config.json')));
    try {
      const response = await fetch(`${baseUrl}/api/config`, { headers: { 'x-lvdagun-token': TOKEN } });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toBeNull();
    } finally {
      await close();
    }
  });

  it('PUT 后 GET 返回相同配置,并持久化到磁盘', async () => {
    const { hub } = makeFakeHub();
    const file = join(dir, 'config.json');
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(file));
    try {
      const put = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(validConfig),
      });
      expect(put.status).toBe(204);

      const get = await fetch(`${baseUrl}/api/config`, { headers: { 'x-lvdagun-token': TOKEN } });
      await expect(get.json()).resolves.toEqual(validConfig);

      const onDisk = JSON.parse(await readFile(file, 'utf8')) as ModelConfig;
      expect(onDisk).toEqual(validConfig);
    } finally {
      await close();
    }
  });

  it('PUT 非法配置返回 400', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(join(dir, 'config.json')));
    try {
      const response = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: '', apiKey: 'x', modelId: 'm' }),
      });
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });
});

describe('向导目录接口', () => {
  it('providers / models / test-connection 透传到 Hub', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(join(dir, 'config.json')));
    try {
      const providers = await fetch(`${baseUrl}/api/providers`, { headers: { 'x-lvdagun-token': TOKEN } });
      await expect(providers.json()).resolves.toEqual([{ id: 'anthropic', name: 'Anthropic' }]);

      const models = await fetch(`${baseUrl}/api/models?provider=anthropic`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      await expect(models.json()).resolves.toEqual([{ id: 'claude-a', name: 'Claude A' }]);

      const test = await fetch(`${baseUrl}/api/test-connection`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'good' }),
      });
      await expect(test.json()).resolves.toEqual({ ok: true });
    } finally {
      await close();
    }
  });
});

describe('对话', () => {
  it('未配置时发送消息返回 409', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(join(dir, 'config.json')));
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

  it('完整对话流:prompt 后 SSE 收到用户消息与 AI 流式回复,历史可恢复', async () => {
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
      await expect(events.nextEvent()).resolves.toMatchObject({ type: 'assistant_text_delta', delta: '你' });
      // 读掉剩余增量,直到完整消息结束事件
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
      expect(history.map((m) => [m.role, m.text])).toEqual([
        ['user', '你好'],
        ['assistant', '你好呀'],
      ]);
    } finally {
      events.close();
      await close();
    }
  });

  it('清空会话:SSE 收到 session_cleared,历史清空', async () => {
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

  it('配置变更后旧会话释放,下次 prompt 按新配置重建', async () => {
    const { hub, sessions, createOptions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      expect(sessions).toHaveLength(1);

      const newConfig: ModelConfig = { provider: 'openai', apiKey: 'sk-new', modelId: 'gpt-x' };
      const put = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      expect(put.status).toBe(204);
      expect(sessions[0]!.disposeCalls).toBe(1);

      await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '还在吗' }),
      });
      expect(sessions).toHaveLength(2);
      expect(createOptions[1]).toEqual(newConfig);
    } finally {
      await close();
    }
  });
});
