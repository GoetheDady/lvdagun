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
    sessionName: null,
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

  /** @param title - 新标题 */
  setSessionName(title: string): void {
    this.state = { ...this.state, sessionName: title };
    this.emit({ type: 'session_info_changed', name: title });
  }

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
    {
      id: 'saved-a',
      name: '持久化标题',
      firstMessage: '第一条消息',
      createdAt: 1,
      updatedAt: 3,
      messageCount: 2,
    },
    {
      id: 'saved-b',
      firstMessage: '(no messages)',
      createdAt: 2,
      updatedAt: 2,
      messageCount: 1,
    },
    {
      id: 'saved-c',
      firstMessage: '没有名称时展示首条消息',
      createdAt: 3,
      updatedAt: 1,
      messageCount: 1,
    },
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
      stored.push({
        id: session.id,
        firstMessage: '',
        createdAt: session.createdAt,
        updatedAt: session.createdAt,
        messageCount: 0,
      });
      return session;
    }),
    openSession: vi.fn(async (_config, sessionId) => {
      const session = sessions.get(sessionId) ?? new FakeSession(sessionId);
      sessions.set(sessionId, session);
      return session;
    }),
    archiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
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
    await expect(manager.getState('saved-a')).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('列出全部持久化会话并按 id 复用唯一 Runtime', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);

    await expect(manager.listSessions()).resolves.toEqual([
      {
        id: 'saved-a',
        title: '持久化标题',
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
      {
        id: 'saved-c',
        title: '没有名称时展示首条消息',
        createdAt: 3,
        updatedAt: 1,
        messageCount: 1,
        isRunning: false,
      },
    ]);
    await manager.getState('saved-a');
    await manager.getState('saved-a');
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

  it('重命名会话并转发 Pi 名称变化事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    await manager.subscribe('saved-a', listener);

    await manager.setSessionName('saved-a', '手动设置的标题');

    expect(sessions.get('saved-a')!.getState().sessionName).toBe('手动设置的标题');
    expect(listener).toHaveBeenLastCalledWith({
      type: 'session_info_changed',
      name: '手动设置的标题',
    });
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
    await manager.getState('saved-a');
    await manager.getState('saved-b');

    await manager.invalidate();
    expect(sessions.get('saved-a')!.dispose).toHaveBeenCalledTimes(1);
    expect(sessions.get('saved-b')!.dispose).toHaveBeenCalledTimes(1);
  });

  it('归档空闲会话时释放 Runtime 并广播生命周期事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    await manager.subscribe('saved-a', listener);

    await manager.archiveSession('saved-a');

    expect(hub.archiveSession).toHaveBeenCalledWith('saved-a');
    expect(sessions.get('saved-a')!.dispose).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      type: 'session_archived',
      sessionId: 'saved-a',
    });
  });

  it('删除空闲会话时释放 Runtime 并广播生命周期事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    await manager.subscribe('saved-a', listener);

    await manager.deleteSession('saved-a');

    expect(hub.deleteSession).toHaveBeenCalledWith('saved-a');
    expect(sessions.get('saved-a')!.dispose).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      type: 'session_deleted',
      sessionId: 'saved-a',
    });
  });

  it('拒绝归档或删除运行中的会话', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const manager = createSessionManager(hub, store);
    await manager.prompt('saved-a', '任务 A');

    await expect(manager.archiveSession('saved-a')).rejects.toBeInstanceOf(AgentBusyError);
    await expect(manager.deleteSession('saved-a')).rejects.toBeInstanceOf(AgentBusyError);
    expect(hub.archiveSession).not.toHaveBeenCalled();
    expect(hub.deleteSession).not.toHaveBeenCalled();
  });
});
