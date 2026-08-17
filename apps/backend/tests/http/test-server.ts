import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { expect, vi } from 'vitest';

import type {
  AgentSessionState,
  AgentStreamEvent,
  AvailableModel,
  ChatMessage,
  ModelConfig,
  ModelReference,
  TestConnectionResult,
  ThinkingLevel,
} from '@lvdagun/protocol';

import type { FileConfigStore } from '../../src/config/config-store';
import {
  SessionArchivedError,
  SessionNotFoundError,
  type Hub,
  type HubSession,
} from '../../src/hub/hub';
import { createServer } from '../../src/http/server';

export const validConfig: ModelConfig = {
  provider: 'anthropic',
  apiKey: 'sk-test',
  modelId: 'claude-a',
};

const availableModels: AvailableModel[] = [
  {
    provider: 'anthropic',
    providerName: 'Anthropic',
    id: 'claude-a',
    name: 'Claude A',
  },
  { provider: 'openai', providerName: 'OpenAI', id: 'gpt-a', name: 'GPT A' },
];

/**
 * 构造测试使用的 Pi 助手消息。
 *
 * @param text - 助手文本
 * @param timestamp - 消息时间戳
 * @param stopReason - Pi 结束原因
 * @returns 完整助手消息
 */
function assistantMessage(
  text: string,
  timestamp: number,
  stopReason: 'pending' | 'stop' | 'aborted' = 'stop'
): Extract<ChatMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-a',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
    stopReason,
    timestamp,
  };
}

/** 测试用可控 Hub 会话。 */
export class FakeSession implements HubSession {
  readonly createdAt = Date.now();
  readonly promptTexts: string[] = [];
  readonly messages: ChatMessage[] = [];
  disposeCalls = 0;
  abortCalls = 0;
  isRunning = false;
  thinkingLevel: ThinkingLevel = 'medium';
  model: AvailableModel = availableModels[0]!;
  sessionName: string | null = null;
  readonly availableThinkingLevels: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
  private timestamp = 1;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();

  /** @param id - 会话标识 */
  constructor(readonly id: string) {}

  /**
   * 接受用户提示并发出 Pi 原生消息生命周期事件。
   *
   * @param text - 用户消息文本
   * @returns 提示被接受后解决的 Promise
   */
  prompt = vi.fn(async (text: string): Promise<void> => {
    this.promptTexts.push(text);
    this.isRunning = true;
    const message: ChatMessage = { role: 'user', content: text, timestamp: this.timestamp++ };
    this.messages.push(message);
    this.emit({ type: 'agent_start' });
    this.emit({ type: 'message_start', message });
    this.emit({ type: 'message_end', message });
  });

  /**
   * 订阅测试会话的 Pi JSON 事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe = (listener: (event: AgentStreamEvent) => void): (() => void) => {
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

  /**
   * 读取测试会话状态。
   *
   * @returns 当前运行状态和思考等级
   */
  getState = (): AgentSessionState => ({
    sessionName: this.sessionName,
    isRunning: this.isRunning,
    activeCompaction: null,
    thinkingLevel: this.thinkingLevel,
    availableThinkingLevels: [...this.availableThinkingLevels],
    model: this.model,
    availableModels: [...availableModels],
    modelWarning: null,
  });

  /** @param title - 新标题 */
  setSessionName = vi.fn((title: string): void => {
    this.sessionName = title;
    this.emit({ type: 'session_info_changed', name: title });
  });

  /**
   * 中止当前运行。
   *
   * @returns 操作完成后的 Promise
   */
  abort = vi.fn(async (): Promise<void> => {
    this.abortCalls += 1;
    this.isRunning = false;
    this.emit({ type: 'agent_settled' });
  });

  /**
   * 设置测试会话思考等级。
   *
   * @param level - 新思考等级
   * @returns 更新后的会话状态
   */
  setThinkingLevel = vi.fn(async (level: ThinkingLevel): Promise<AgentSessionState> => {
    this.thinkingLevel = level;
    this.emit({ type: 'thinking_level_changed', level });
    return this.getState();
  });

  /**
   * 设置测试会话模型并广播权威状态。
   *
   * @param reference - 跨 Provider 模型引用
   * @returns 更新后的会话状态
   */
  setModel = vi.fn(async (reference: ModelReference): Promise<AgentSessionState> => {
    const model = availableModels.find(
      (candidate) => candidate.provider === reference.provider && candidate.id === reference.id
    );
    if (!model) throw new Error('模型不可用');
    this.model = model;
    const state = this.getState();
    this.emit({ type: 'session_model_changed', state });
    return state;
  });

  /**
   * 记录会话释放次数。
   *
   * @returns 操作完成后的 Promise
   */
  dispose = vi.fn(async (): Promise<void> => {
    this.disposeCalls += 1;
  });

  /**
   * 模拟完整的 Pi 助手文本流。
   *
   * @param text - 助手回复文本
   * @param stopReason - 最终结束原因
   * @returns 无返回值
   */
  simulateAssistant(text: string, stopReason: 'stop' | 'aborted' = 'stop'): void {
    const timestamp = this.timestamp++;
    const startMessage = assistantMessage('', timestamp, 'pending');
    this.emit({ type: 'message_start', message: startMessage });
    this.emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
    });
    for (const char of text) {
      this.emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: char },
      });
    }
    this.emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: text },
    });
    const message = assistantMessage(text, timestamp, stopReason);
    this.messages.push(message);
    this.emit({ type: 'message_end', message });
    this.isRunning = false;
    this.emit({ type: 'agent_end', messages: [message], willRetry: false });
    this.emit({ type: 'agent_settled' });
  }

  /**
   * 向测试订阅者发送 Pi JSON 事件。
   *
   * @param event - Pi JSON 会话事件
   * @returns 无返回值
   */
  emit(event: AgentStreamEvent): void {
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
  const archivedSessionIds = new Set<string>();
  const deletedSessionIds = new Set<string>();
  let nextSessionId = 1;

  /** @param sessionId - 会话标识 @returns 已有或新建的测试会话 */
  const getOrCreateSession = (sessionId: string): FakeSession => {
    const existing = sessions.find((session) => session.id === sessionId);
    if (existing) return existing;
    const session = new FakeSession(sessionId);
    sessions.push(session);
    return session;
  };

  const hub: Hub = {
    listProviders: vi.fn(async () => [{ id: 'anthropic', name: 'Anthropic' }]),
    listModels: vi.fn(async (providerId) =>
      providerId === 'anthropic' ? [{ id: 'claude-a', name: 'Claude A' }] : []
    ),
    testConnection: vi.fn(
      async (_provider: string, apiKey: string): Promise<TestConnectionResult> =>
        apiKey === 'good' ? { ok: true } : { ok: false, message: '401 凭证无效' }
    ),
    listSessions: vi.fn(async () =>
      sessions.map((session) => ({
        id: session.id,
        name: session.sessionName ?? undefined,
        firstMessage:
          session.messages.find((message) => message.role === 'user')?.content.toString() ?? '',
        createdAt: session.createdAt,
        updatedAt: session.messages.at(-1)?.timestamp ?? session.createdAt,
        messageCount: session.messages.length,
      }))
    ),
    createSession: vi.fn(async (options) => {
      createOptions.push(options);
      while (sessions.some((session) => session.id === `session-${nextSessionId}`)) {
        nextSessionId += 1;
      }
      return getOrCreateSession(`session-${nextSessionId++}`);
    }),
    openSession: vi.fn(async (_options, sessionId) => {
      if (archivedSessionIds.has(sessionId)) throw new SessionArchivedError(sessionId);
      if (deletedSessionIds.has(sessionId)) throw new SessionNotFoundError(sessionId);
      const session = new FakeSession(sessionId);
      sessions.push(session);
      return session;
    }),
    archiveSession: vi.fn(async (sessionId) => {
      archivedSessionIds.add(sessionId);
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index >= 0) sessions.splice(index, 1);
    }),
    deleteSession: vi.fn(async (sessionId) => {
      deletedSessionIds.add(sessionId);
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index >= 0) sessions.splice(index, 1);
    }),
  };
  return { hub, sessions, createOptions };
}

/**
 * 在随机端口启动测试服务。
 *
 * @param hub - 测试 Agent Hub
 * @param configStore - 测试配置存储
 * @returns 服务地址与关闭函数
 */
export async function startServer(
  hub: Hub,
  configStore: FileConfigStore
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = createServer({ hub, configStore });
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
 * @returns 逐帧读取事件和关闭连接的方法
 */
export async function openEvents(
  baseUrl: string,
  sessionId = 'session-1'
): Promise<{ nextEvent: (timeoutMs?: number) => Promise<AgentStreamEvent>; close: () => void }> {
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/events`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async nextEvent(timeoutMs = 2000): Promise<AgentStreamEvent> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const separator = buffer.indexOf('\n\n');
        if (separator >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          expect(dataLine).toBeDefined();
          return JSON.parse(dataLine!.slice(6)) as AgentStreamEvent;
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
