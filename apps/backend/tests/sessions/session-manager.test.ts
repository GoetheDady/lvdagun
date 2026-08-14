import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  ModelConfig,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { FileConfigStore } from '../../src/config/config-store';
import type { Hub, HubSession } from '../../src/hub/hub';
import { createSessionManager, NotConfiguredError } from '../../src/sessions/session-manager';

/** 可控的 HubSession 测试替身。 */
class FakeSession implements HubSession {
  readonly messages: ChatMessage[] = [];
  disposeCalls = 0;
  state: AgentSessionState = {
    isRunning: false,
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'medium', 'high'],
  };
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();

  /**
   * 记录提示调用。
   *
   * @returns 已解决的 Promise
   */
  prompt = vi.fn(async (): Promise<void> => {});

  /**
   * 订阅测试事件。
   *
   * @param listener - Pi JSON 事件监听器
   * @returns 退订函数
   */
  subscribe = (listener: (event: AgentStreamEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * 读取历史副本。
   *
   * @returns 结构化消息数组
   */
  getMessages = (): ChatMessage[] => [...this.messages];

  /**
   * 读取状态副本。
   *
   * @returns 当前会话状态
   */
  getState = (): AgentSessionState => ({
    ...this.state,
    availableThinkingLevels: [...this.state.availableThinkingLevels],
  });

  /**
   * 模拟 Pi 新会话并清空历史。
   *
   * @returns 操作完成后的 Promise
   */
  newSession = vi.fn(async (): Promise<void> => {
    this.messages.splice(0);
  });

  /**
   * 模拟中止运行。
   *
   * @returns 操作完成后的 Promise
   */
  abort = vi.fn(async (): Promise<void> => {
    this.state = { ...this.state, isRunning: false };
  });

  /**
   * 模拟设置思考等级。
   *
   * @param level - 新思考等级
   * @returns 更新后的状态
   */
  setThinkingLevel = vi.fn(async (level: ThinkingLevel): Promise<AgentSessionState> => {
    this.state = { ...this.state, thinkingLevel: level };
    return this.getState();
  });

  /**
   * 记录会话释放。
   *
   * @returns 操作完成后的 Promise
   */
  dispose = vi.fn(async (): Promise<void> => {
    this.disposeCalls += 1;
  });

  /**
   * 向订阅者广播事件。
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
 * 创建记录会话配置的测试 Hub。
 *
 * @returns Hub、创建出的会话及配置记录
 */
function makeFakeHub(): { hub: Hub; sessions: FakeSession[]; createConfigs: ModelConfig[] } {
  const sessions: FakeSession[] = [];
  const createConfigs: ModelConfig[] = [];
  const hub: Hub = {
    listProviders: vi.fn(async () => []),
    listModels: vi.fn(async () => []),
    testConnection: vi.fn(async () => ({ ok: true }) as const),
    createSession: vi.fn(async (config: ModelConfig) => {
      createConfigs.push(config);
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }),
  };
  return { hub, sessions, createConfigs };
}

const configA: ModelConfig = { provider: 'anthropic', apiKey: 'sk-a', modelId: 'claude-a' };
const configB: ModelConfig = { provider: 'openai', apiKey: 'sk-b', modelId: 'gpt-b' };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-session-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createSessionManager', () => {
  it('未配置时拒绝创建会话', async () => {
    const { hub } = makeFakeHub();
    const manager = createSessionManager(
      hub,
      new FileConfigStore(join(dir, 'config.json')),
      vi.fn()
    );
    await expect(manager.getSession()).rejects.toBeInstanceOf(NotConfiguredError);
    expect(hub.createSession).not.toHaveBeenCalled();
  });

  it('创建并复用同配置会话，同时原样转发 Pi JSON 事件', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const broadcast = vi.fn<(event: AgentStreamEvent) => void>();
    const manager = createSessionManager(hub, store, broadcast);

    const first = await manager.getSession();
    const second = await manager.getSession();
    expect(second).toBe(first);
    expect(hub.createSession).toHaveBeenCalledTimes(1);

    const event: AgentStreamEvent = { type: 'agent_start' };
    sessions[0]!.emit(event);
    expect(broadcast).toHaveBeenCalledWith(event);
  });

  it('配置变更后等待旧会话释放并按新配置重建', async () => {
    const { hub, sessions, createConfigs } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const manager = createSessionManager(hub, store, vi.fn());

    await manager.getSession();
    await store.save(configB);
    const rebuilt = await manager.getSession();

    expect(sessions[0]!.disposeCalls).toBe(1);
    expect(rebuilt).toBe(sessions[1]);
    expect(createConfigs[1]).toEqual(configB);
  });

  it('委托 Pi 新会话、中止和思考等级能力', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const manager = createSessionManager(hub, store, vi.fn());

    await manager.getSession();
    await manager.newSession();
    await manager.abort();
    await expect(manager.setThinkingLevel('high')).resolves.toMatchObject({
      thinkingLevel: 'high',
    });

    expect(sessions[0]!.newSession).toHaveBeenCalledTimes(1);
    expect(sessions[0]!.abort).toHaveBeenCalledTimes(1);
    expect(sessions[0]!.setThinkingLevel).toHaveBeenCalledWith('high');
  });

  it('读取消息与状态，并在 invalidate 时释放会话但不广播', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const broadcast = vi.fn<(event: AgentStreamEvent) => void>();
    const manager = createSessionManager(hub, store, broadcast);

    expect(manager.getMessages()).toEqual([]);
    await manager.getSession();
    const message: ChatMessage = { role: 'user', content: '你好', timestamp: 1 };
    sessions[0]!.messages.push(message);
    expect(manager.getMessages()).toEqual([message]);
    await expect(manager.getState()).resolves.toMatchObject({ thinkingLevel: 'medium' });

    await manager.invalidate();
    expect(sessions[0]!.disposeCalls).toBe(1);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
