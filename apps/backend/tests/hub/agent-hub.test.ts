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
  PendingMessage,
  SessionMessage,
  SessionSnapshotEvent,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { FileConfigStore } from '../../src/config/config-store';
import {
  AgentBusyError,
  type AgentHubAdapter,
  type AgentSessionAdapter,
} from '../../src/hub/agent-hub-adapter';
import { createAgentHub, NotConfiguredError } from '../../src/hub/agent-hub';

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
class FakeSession implements AgentSessionAdapter {
  readonly createdAt = Date.now();
  readonly messages: ChatMessage[] = [];
  readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  readonly pendingMessages: PendingMessage[] = [];
  readonly prompt = vi.fn(async (text: string): Promise<void> => {
    void text;
    this.state = { ...this.state, isRunning: true };
    this.emit({ type: 'agent_start' });
  });
  readonly abort = vi.fn(async (): Promise<string[]> => {
    const texts = this.takePendingMessages();
    this.state = { ...this.state, isRunning: false };
    this.emit({ type: 'agent_settled' });
    return texts;
  });
  readonly dispose = vi.fn(async (): Promise<void> => {});
  state: AgentSessionState = {
    sessionName: null,
    isRunning: false,
    activeCompaction: null,
    pendingMessages: [],
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'medium', 'high'],
    model: availableModels[0]!,
    availableModels,
    modelWarning: null,
  };

  /** @param id - 会话标识 */
  constructor(readonly id: string) {}

  /** @param text - 待处理文本 @returns 新消息 */
  enqueuePendingMessage(text: string): void {
    const message = { id: `pending-${this.pendingMessages.length + 1}`, text };
    this.pendingMessages.push(message);
    this.syncPendingMessages();
  }

  /** @param messageId - 消息标识 @returns 无返回值 */
  async steerPendingMessage(messageId: string): Promise<void> {
    this.removePendingMessage(messageId);
  }

  /** @param messageId - 消息标识 @returns 无返回值 */
  removePendingMessage(messageId: string): void {
    const index = this.pendingMessages.findIndex((message) => message.id === messageId);
    if (index >= 0) this.pendingMessages.splice(index, 1);
    this.syncPendingMessages();
  }

  /** @returns 全部待处理文本 */
  takePendingMessages(): string[] {
    const texts = this.pendingMessages.map((message) => message.text);
    this.pendingMessages.splice(0);
    this.syncPendingMessages();
    return texts;
  }

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
  getMessages(): SessionMessage[] {
    return this.messages.map((message, index) => ({ entryId: `entry-${index + 1}`, message }));
  }

  /** @param entryId - 用户消息标识 @param text - 修改文本 @returns 新分支历史 */
  async editAndResend(entryId: string, text: string): Promise<SessionMessage[]> {
    const userIndex = this.messages.findLastIndex((message) => message.role === 'user');
    if (entryId !== `entry-${userIndex + 1}`) throw new Error('消息已经变化');
    this.messages.splice(userIndex);
    await this.prompt(text);
    return this.getMessages();
  }

  /** @returns 状态副本 */
  getState(): AgentSessionState {
    return { ...this.state, availableThinkingLevels: [...this.state.availableThinkingLevels] };
  }

  /** @returns 权威恢复快照 */
  getSnapshot(): SessionSnapshotEvent {
    return {
      type: 'session_snapshot',
      messages: this.getMessages(),
      activeAssistant: null,
      state: this.getState(),
    };
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

  /** @returns 无返回值 */
  private syncPendingMessages(): void {
    this.state = { ...this.state, pendingMessages: [...this.pendingMessages] };
    this.emit({ type: 'pending_messages_changed', pendingMessages: [...this.pendingMessages] });
  }
}

/** @returns 可控 Hub 与按 id 保存的测试会话 */
function makeFakeHub(): { hub: AgentHubAdapter; sessions: Map<string, FakeSession> } {
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
  const hub: AgentHubAdapter = {
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
    forkSession: vi.fn(async (_config, sourceSessionId, entryId, title) => {
      const source = sessions.get(sourceSessionId) ?? new FakeSession(sourceSessionId);
      const session = new FakeSession(`new-${nextId++}`);
      const entryIndex = Number(entryId.replace('entry-', '')) - 1;
      session.messages.push(...source.messages.slice(0, entryIndex + 1));
      session.setSessionName(title);
      sessions.set(session.id, session);
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

describe('createAgentHub', () => {
  it('未配置时拒绝创建或打开会话', async () => {
    const { hub } = makeFakeHub();
    const agentHub = createAgentHub(hub, new FileConfigStore(join(dir, 'config.json')));
    await expect(agentHub.createSession()).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(agentHub.getState('saved-a')).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('列出全部持久化会话并按 id 复用唯一 Runtime', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);

    await expect(agentHub.listSessions()).resolves.toEqual([
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
    await agentHub.getState('saved-a');
    await agentHub.getState('saved-a');
    expect(hub.openSession).toHaveBeenCalledTimes(1);
  });

  it('创建会话后立即加入列表并转发该会话事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);
    const sessionId = await agentHub.createSession();
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    const subscription = await agentHub.subscribe(sessionId, listener);

    expect(subscription.snapshot).toEqual({
      type: 'session_snapshot',
      messages: [],
      activeAssistant: null,
      state: sessions.get(sessionId)!.state,
    });
    sessions.get(sessionId)!.emit({ type: 'agent_start' });
    expect(listener).toHaveBeenCalledWith({ type: 'agent_start' });
    expect((await agentHub.listSessions())[0]).toMatchObject({ id: sessionId, isRunning: false });
    subscription.unsubscribe();
  });

  it('重命名会话并转发 Pi 标题变化事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    await agentHub.subscribe('saved-a', listener);

    await agentHub.setSessionName('saved-a', '手动设置的标题');

    expect(sessions.get('saved-a')!.getState().sessionName).toBe('手动设置的标题');
    expect(listener).toHaveBeenLastCalledWith({
      type: 'session_info_changed',
      name: '手动设置的标题',
    });
  });

  it('同一会话后续消息排队，不同会话可以并行运行', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);

    await agentHub.prompt('saved-a', '任务 A');
    await agentHub.prompt('saved-a', '排队消息');
    expect(sessions.get('saved-a')!.pendingMessages).toEqual([
      { id: 'pending-1', text: '排队消息' },
    ]);
    expect(sessions.get('saved-a')!.prompt).toHaveBeenCalledTimes(1);
    await expect(agentHub.prompt('saved-b', '任务 B')).resolves.toBeUndefined();
    expect(sessions.get('saved-b')!.prompt).toHaveBeenCalledWith('任务 B');
  });

  it('同一会话会等待前一条提示完成前置校验后再决定排队', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);
    await agentHub.getState('saved-a');
    const session = sessions.get('saved-a')!;
    let acceptFirst!: () => void;
    session.prompt.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acceptFirst = () => {
            session.state = { ...session.state, isRunning: true };
            resolve();
          };
        })
    );

    const first = agentHub.prompt('saved-a', '第一条');
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledTimes(1));
    const second = agentHub.prompt('saved-a', '第二条');
    expect(session.pendingMessages).toEqual([]);

    acceptFirst();
    await first;
    await second;
    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(session.pendingMessages).toEqual([{ id: 'pending-1', text: '第二条' }]);
  });

  it('从助手回复创建独立派生会话并继承带后缀的源标题', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);

    const forkedId = await agentHub.forkSession('saved-a', 'entry-assistant');

    expect(hub.forkSession).toHaveBeenCalledWith(
      config,
      'saved-a',
      'entry-assistant',
      '持久化标题（分叉）'
    );
    expect(forkedId).toMatch(/^new-/);
    await agentHub.getState(forkedId);
    expect(hub.openSession).not.toHaveBeenCalledWith(config, forkedId);
  });

  it('配置失效时释放所有已加载会话', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);
    await agentHub.getState('saved-a');
    await agentHub.getState('saved-b');

    await agentHub.updateConfig({ ...config, modelId: 'claude-b' });
    expect(sessions.get('saved-a')!.dispose).toHaveBeenCalledTimes(1);
    expect(sessions.get('saved-b')!.dispose).toHaveBeenCalledTimes(1);
  });

  it('归档空闲会话时释放 Runtime 并广播生命周期事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(config);
    const agentHub = createAgentHub(hub, store);
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    await agentHub.subscribe('saved-a', listener);

    await agentHub.archiveSession('saved-a');

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
    const agentHub = createAgentHub(hub, store);
    const listener = vi.fn<(event: AgentStreamEvent) => void>();
    await agentHub.subscribe('saved-a', listener);

    await agentHub.deleteSession('saved-a');

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
    const agentHub = createAgentHub(hub, store);
    await agentHub.prompt('saved-a', '任务 A');

    await expect(agentHub.archiveSession('saved-a')).rejects.toBeInstanceOf(AgentBusyError);
    await expect(agentHub.deleteSession('saved-a')).rejects.toBeInstanceOf(AgentBusyError);
    expect(hub.archiveSession).not.toHaveBeenCalled();
    expect(hub.deleteSession).not.toHaveBeenCalled();
  });
});
