import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, HubEvent, ModelConfig } from '@lvdagun/protocol';

import { FileConfigStore } from '../../src/config/config-store';
import type { Hub, HubSession } from '../../src/hub/hub';
import { createSessionManager, NotConfiguredError } from '../../src/sessions/session-manager';

/** 可控会话:subscribe 捕获监听器,emit 供测试驱动事件 */
class FakeSession implements HubSession {
  readonly messages: ChatMessage[] = [];
  disposeCalls = 0;
  private readonly listeners = new Set<(event: HubEvent) => void>();

  prompt = vi.fn(async () => {});

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

  emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** 可控 Hub:记录每次 createSession 的配置与返回的假会话 */
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
  it('未配置时 getSession 抛 NotConfiguredError', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    const manager = createSessionManager(hub, store, vi.fn());
    await expect(manager.getSession()).rejects.toBeInstanceOf(NotConfiguredError);
    expect(hub.createSession).not.toHaveBeenCalled();
  });

  it('配置后首次 getSession 创建会话并转发会话事件到广播', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const broadcast = vi.fn<(event: HubEvent) => void>();
    const manager = createSessionManager(hub, store, broadcast);

    const session = await manager.getSession();
    expect(session).toBe(sessions[0]);

    // 会话内部事件 → 广播
    sessions[0]!.emit({ type: 'user_message', message: { id: 'u1', role: 'user', text: '你好' } });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'user_message',
      message: { id: 'u1', role: 'user', text: '你好' },
    });
  });

  it('相同配置复用会话:createSession 只调一次', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const manager = createSessionManager(hub, store, vi.fn());

    const first = await manager.getSession();
    const second = await manager.getSession();
    expect(second).toBe(first);
    expect(hub.createSession).toHaveBeenCalledTimes(1);
  });

  it('配置变更后旧会话释放,按新配置重建', async () => {
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

  it('clear:释放会话并向广播发 session_cleared', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const broadcast = vi.fn<(event: HubEvent) => void>();
    const manager = createSessionManager(hub, store, broadcast);

    await manager.getSession();
    manager.clear();

    expect(sessions[0]!.disposeCalls).toBe(1);
    expect(broadcast).toHaveBeenCalledWith({ type: 'session_cleared' });
    expect(manager.getMessages()).toEqual([]);
  });

  it('无会话时 clear 不广播、不释放', async () => {
    const { hub } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    const broadcast = vi.fn<(event: HubEvent) => void>();
    const manager = createSessionManager(hub, store, broadcast);

    manager.clear();
    expect(broadcast).not.toHaveBeenCalled();
    expect(hub.createSession).not.toHaveBeenCalled();
  });

  it('invalidate:释放会话但不广播', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const broadcast = vi.fn<(event: HubEvent) => void>();
    const manager = createSessionManager(hub, store, broadcast);

    await manager.getSession();
    manager.invalidate();

    expect(sessions[0]!.disposeCalls).toBe(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('getMessages:无会话为空,有会话返回历史', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(configA);
    const manager = createSessionManager(hub, store, vi.fn());

    expect(manager.getMessages()).toEqual([]);

    await manager.getSession();
    sessions[0]!.messages.push({ id: 'u1', role: 'user', text: '你好' });
    expect(manager.getMessages()).toEqual([{ id: 'u1', role: 'user', text: '你好' }]);
  });
});
