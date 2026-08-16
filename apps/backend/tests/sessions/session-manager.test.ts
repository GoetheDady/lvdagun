import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionState,
  AgentStreamEvent,
  AvailableModel,
  ChatMessage,
  ModelConfig,
  ModelReference,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { FileConfigStore } from '../../src/config/config-store';
import { AgentBusyError, type Hub, type HubSession } from '../../src/hub/hub';
import { createSessionManager, NotConfiguredError } from '../../src/sessions/session-manager';

const availableModels: AvailableModel[] = [
  {
    provider: 'anthropic',
    providerName: 'Anthropic',
    id: 'claude-a',
    name: 'Claude A',
  },
  { provider: 'openai', providerName: 'OpenAI', id: 'gpt-a', name: 'GPT A' },
];

/** 按 id 模拟一个可控的持久化 Hub 会话。 */
class FakeSession implements HubSession {
  readonly createdAt = Date.now();
  readonly messages: ChatMessage[] = [];
  readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  readonly prompt = vi.fn(async (): Promise<void> => {
    this.state = { ...this.state, isRunning: true };
    this.emit({ type: 'agent_start' });
  });
  readonly abort = vi.fn(async (): Promise<void> => {
    this.state = { ...this.state, isRunning: false };
    this.emit({ type: 'agent_settled' });
  });
  readonly dispose = vi.fn(async (): Promise<void> => {});
  state: AgentSessionState = {
    isRunning: false,
    activeCompaction: null,
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'medium', 'high'],
    model: availableModels[0]!,
    availableModels,
    modelWarning: null,
  };

  /** @param id - 会话标识 */
  constructor(readonly id: string) {}

  /** @param listener - 事件监听器 @returns 退订函数 */
  subscribe(listener: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @returns 消息副本 */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** @returns 状态副本 */
  getState(): AgentSessionState {
    return { ...this.state, availableThinkingLevels: [...this.state.availableThinkingLevels] };
  }

  /** @param level - 新思考等级 @returns 更新后的状态 */
  async setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState> {
    this.state = { ...this.state, thinkingLevel: level };
    return this.getState();
  }

  /** @param reference - 模型引用 @returns 更新后的状态 */
  async setModel(reference: ModelReference): Promise<AgentSessionState> {
    const model = availableModels.find(
      (candidate) => candidate.provider === reference.provider && candidate.id === reference.id
    );
    if (!model) throw new Error('模型不可用');
    this.state = { ...this.state, model };
    const state = this.getState();
    this.emit({ type: 'session_model_changed', state });
    return state;
  }

  /** @param event - 测试事件 */
  emit(event: AgentStreamEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** @returns 可控 Hub 与按 id 保存的测试会话 */
function makeFakeHub(): { hub: Hub; sessions: Map<string, FakeSession> } {
  const sessions = new Map<string, FakeSession>();
  const stored = [
    { id: 'saved-a', createdAt: 1, updatedAt: 3, messageCount: 2 },
    { id: 'saved-b', createdAt: 2, updatedAt: 2, messageCount: 1 },
  ];
  let nextId = 1;
  const hub: Hub = {
    listProviders: vi.fn(async () => []),
    listModels: vi.fn(async () => []),
    testConnection: vi.fn(async () => ({ ok: true }) as const),
    listSessions: vi.fn(async () => [...stored]),
    createSession: vi.fn(async () => {
      const session = new FakeSession(`new-${nextId++}`);
      sessions.set(session.id, session);
      return session;
    }),
    openSession: vi.fn(async (_config, sessionId) => {
      const session = sessions.get(sessionId) ?? new FakeSession(sessionId);
      sessions.set(sessionId, session);
      return session;
    }),
  };
  return { hub, sessions };
}

const config: ModelConfig = { provider: 'anthropic', apiKey: 'sk-a', modelId: 'claude-a' };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-session-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createSessionManager', () => {
  it('未配置时拒绝创建或打开会话', async () => {
    const { hub } = makeFakeHub();
    const manager = createSessionManager(hub, new FileConfigStore(join(dir, 'config.json')));
    await expect(manager.createSession()).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(manager.getSession('saved-a')).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('列出全部持久化会话并按 id 复用唯一 Runtime', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);

    await expect(manager.listSessions()).resolves.toEqual([
      {
        id: 'saved-a',
        title: '新对话',
        createdAt: 1,
        updatedAt: 3,
        messageCount: 2,
        isRunning: false,
      },
      {
        id: 'saved-b',
        title: '新对话',
        createdAt: 2,
        updatedAt: 2,
        messageCount: 1,
        isRunning: false,
      },
    ]);
    const first = await manager.getSession('saved-a');
    const second = await manager.getSession('saved-a');
    expect(second).toBe(first);
    expect(hub.openSession).toHaveBeenCalledTimes(1);
  });

  it('创建会话后立即加入列表并转发该会话事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);
    const sessionId = await manager.createSession();
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    const unsubscribe = await manager.subscribe(sessionId, listener);

    expect(listener).toHaveBeenNthCalledWith(1, {
      type: 'session_state',
      state: sessions.get(sessionId)!.state,
    });
    sessions.get(sessionId)!.emit({ type: 'agent_start' });
    expect(listener).toHaveBeenCalledWith({ type: 'agent_start' });
    expect((await manager.listSessions())[0]).toMatchObject({ id: sessionId, isRunning: false });
    unsubscribe();
  });

  it('一个会话运行时拒绝另一会话启动，稳定后释放全局约束', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);

    await manager.prompt('saved-a', '任务 A');
    await expect(manager.prompt('saved-b', '任务 B')).rejects.toBeInstanceOf(AgentBusyError);
    sessions.get('saved-a')!.emit({ type: 'agent_settled' });
    sessions.get('saved-a')!.state = { ...sessions.get('saved-a')!.state, isRunning: false };
    await expect(manager.prompt('saved-b', '任务 B')).resolves.toBeUndefined();
  });

  it('配置失效时释放所有已加载会话', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);
    await manager.getSession('saved-a');
    await manager.getSession('saved-b');

    await manager.invalidate();
    expect(sessions.get('saved-a')!.dispose).toHaveBeenCalledTimes(1);
    expect(sessions.get('saved-b')!.dispose).toHaveBeenCalledTimes(1);
  });
});
