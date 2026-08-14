import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HubEvent } from '@lvdagun/protocol';

/**
 * Pi SDK 模块级 mock:测试绝不触网、绝不创建真实运行时。
 *
 * vi.hoisted 保证 mock 工厂能引用测试用例操纵的状态(provider 目录、
 * 流式结果、会话事件序列),用例之间重置。
 */
const pi = vi.hoisted(() => ({
  state: {
    providers: [] as Array<{
      id: string;
      name: string;
      hasApiKeyAuth: boolean;
      models: Array<{ id: string; name: string }>;
    }>,
    streamResult: null as null | { stopReason: string; errorMessage?: string } | Error,
    createCount: 0,
    setRuntimeApiKeyCalls: [] as Array<{ provider: string; apiKey: string }>,
    sessionEvents: [] as Array<{
      type: string;
      message?: { role: string };
      assistantMessageEvent?: unknown;
    }>,
    abortCalls: 0,
    disposeCalls: 0,
  },
}));

vi.mock('@earendil-works/pi-ai', () => ({
  InMemoryCredentialStore: class {},
}));

vi.mock('@earendil-works/pi-coding-agent', () => {
  const runtime = {
    getProviders: () =>
      pi.state.providers.map((p) => ({
        id: p.id,
        name: p.name,
        auth: { apiKey: p.hasApiKeyAuth ? {} : undefined },
        getModels: () => p.models.map((m) => ({ id: m.id, name: m.name })),
      })),
    setRuntimeApiKey: async (provider: string, apiKey: string) => {
      pi.state.setRuntimeApiKeyCalls.push({ provider, apiKey });
    },
    getModel: (providerId: string, modelId: string) =>
      pi.state.providers.some((p) => p.id === providerId && p.models.some((m) => m.id === modelId))
        ? { id: modelId, providerId }
        : undefined,
    streamSimple: () => ({
      result: async () => {
        if (pi.state.streamResult instanceof Error) throw pi.state.streamResult;
        return pi.state.streamResult;
      },
    }),
  };
  return {
    ModelRuntime: {
      create: async () => {
        pi.state.createCount += 1;
        return runtime;
      },
    },
    createAgentSession: async () => {
      let listener: ((event: unknown) => void) | null = null;
      const session = {
        subscribe: (l: (event: unknown) => void) => {
          listener = l;
          return () => {
            listener = null;
          };
        },
        prompt: async () => {
          for (const event of pi.state.sessionEvents) {
            listener?.(event);
          }
        },
        abort: async () => {
          pi.state.abortCalls += 1;
        },
        dispose: () => {
          pi.state.disposeCalls += 1;
        },
      };
      return { session };
    },
    DefaultResourceLoader: class {
      async reload(): Promise<void> {}
    },
    SessionManager: { inMemory: () => ({}) },
    SettingsManager: { inMemory: () => ({}) },
  };
});

import { createHub } from '../../src/hub/create-hub';

beforeEach(() => {
  pi.state.providers = [];
  pi.state.streamResult = null;
  pi.state.createCount = 0;
  pi.state.setRuntimeApiKeyCalls = [];
  pi.state.sessionEvents = [];
  pi.state.abortCalls = 0;
  pi.state.disposeCalls = 0;
});

describe('listProviders', () => {
  it('只返回带 API Key 认证方式的 Provider,并过滤基础设施条目', async () => {
    pi.state.providers = [
      { id: 'anthropic', name: 'Anthropic', hasApiKeyAuth: true, models: [] },
      { id: 'github-copilot', name: 'GitHub Copilot', hasApiKeyAuth: false, models: [] },
      { id: 'amazon-bedrock', name: 'Amazon Bedrock', hasApiKeyAuth: true, models: [] },
      { id: 'openai', name: 'OpenAI', hasApiKeyAuth: true, models: [] },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.listProviders()).resolves.toEqual([
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai', name: 'OpenAI' },
    ]);
  });
});

describe('listModels', () => {
  it('返回指定 Provider 的模型列表', async () => {
    pi.state.providers = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        hasApiKeyAuth: true,
        models: [
          { id: 'claude-a', name: 'Claude A' },
          { id: 'claude-b', name: 'Claude B' },
        ],
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.listModels('anthropic')).resolves.toEqual([
      { id: 'claude-a', name: 'Claude A' },
      { id: 'claude-b', name: 'Claude B' },
    ]);
  });

  it('未知 Provider 返回空列表', async () => {
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.listModels('nope')).resolves.toEqual([]);
  });
});

describe('testConnection', () => {
  beforeEach(() => {
    pi.state.providers = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        hasApiKeyAuth: true,
        models: [{ id: 'claude-a', name: 'Claude A' }],
      },
    ];
  });

  it('成功:先写入运行时 Key,流正常结束时返回 ok', async () => {
    pi.state.streamResult = { stopReason: 'done' };
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.testConnection('anthropic', 'sk-test')).resolves.toEqual({ ok: true });
    expect(pi.state.setRuntimeApiKeyCalls).toEqual([{ provider: 'anthropic', apiKey: 'sk-test' }]);
  });

  it('API 报错(stopReason=error)返回失败与错误信息', async () => {
    pi.state.streamResult = { stopReason: 'error', errorMessage: '401 凭证无效' };
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.testConnection('anthropic', 'sk-bad')).resolves.toEqual({
      ok: false,
      message: '401 凭证无效',
    });
  });

  it('超时返回失败', async () => {
    pi.state.streamResult = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const result = await hub.testConnection('anthropic', 'sk-slow');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('超时');
    }
  });

  it('未知 Provider 返回失败', async () => {
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const result = await hub.testConnection('nope', 'sk-x');
    expect(result.ok).toBe(false);
  });
});

describe('createSession', () => {
  beforeEach(() => {
    pi.state.providers = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        hasApiKeyAuth: true,
        models: [{ id: 'claude-a', name: 'Claude A' }],
      },
    ];
  });

  it('模型不存在时抛错', async () => {
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(
      hub.createSession({ provider: 'anthropic', apiKey: '', modelId: 'nope' })
    ).rejects.toThrow();
  });

  it('prompt 把 Pi 事件流翻译为协议事件,历史只含完整消息', async () => {
    pi.state.sessionEvents = [
      { type: 'message_start', message: { role: 'assistant' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '好' } },
      { type: 'message_end', message: { role: 'assistant' } },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });

    const events: HubEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.prompt('你好');

    // 用户消息:由 Hub 生成 id 并作为完整消息进历史
    expect(events[0]).toMatchObject({
      type: 'user_message',
      message: { role: 'user', text: '你好' },
    });
    // 流式增量逐条转发,delta 顺序保持
    expect(events.map((e) => e.type)).toEqual([
      'user_message',
      'assistant_message_start',
      'assistant_text_delta',
      'assistant_text_delta',
      'assistant_message_end',
    ]);
    // 完整回复文本由增量拼成,与事件里的消息一致
    const endEvent = events[4];
    expect(endEvent).toMatchObject({ type: 'assistant_message_end', message: { text: '你好' } });

    // 历史:两条完整消息,顺序正确
    const history = session.getMessages();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', text: '你好' });
    expect(history[1]).toMatchObject({ role: 'assistant', text: '你好' });
  });

  it('dispose 释放底层会话', async () => {
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });
    session.dispose();
    expect(pi.state.disposeCalls).toBe(1);
  });
});
