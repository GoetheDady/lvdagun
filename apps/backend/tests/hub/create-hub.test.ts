import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStreamEvent, ChatMessage } from '@lvdagun/protocol';

/** Pi SDK 的模块级测试状态。 */
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
    sessionEvents: [] as unknown[],
    messages: [] as unknown[],
    entries: [] as unknown[],
    isIdle: true,
    thinkingLevel: 'medium',
    abortCalls: 0,
    disposeCalls: 0,
    flushCalls: 0,
    activeTools: [] as string[],
    resourceLoaderOptions: null as null | Record<string, unknown>,
    openSessionPaths: [] as string[],
    persistedFiles: [] as Array<{ path: string; content: string }>,
    sessionInfos: [] as Array<{
      id: string;
      path: string;
      created: Date;
      modified: Date;
      messageCount: number;
    }>,
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: async (path: string, content: string) => {
    pi.state.persistedFiles.push({ path, content });
  },
}));

vi.mock('@earendil-works/pi-ai', () => ({
  InMemoryCredentialStore: class {},
}));

vi.mock('@earendil-works/pi-coding-agent', () => {
  const modelRuntime = {
    getProviders: () =>
      pi.state.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        auth: { apiKey: provider.hasApiKeyAuth ? {} : undefined },
        getModels: () => provider.models.map((model) => ({ id: model.id, name: model.name })),
      })),
    setRuntimeApiKey: async (provider: string, apiKey: string) => {
      pi.state.setRuntimeApiKeyCalls.push({ provider, apiKey });
    },
    getModel: (providerId: string, modelId: string) =>
      pi.state.providers.some(
        (provider) =>
          provider.id === providerId && provider.models.some((model) => model.id === modelId)
      )
        ? { id: modelId, provider: providerId }
        : undefined,
    streamSimple: () => ({
      result: async () => {
        if (pi.state.streamResult instanceof Error) {
          throw pi.state.streamResult;
        }
        return pi.state.streamResult;
      },
    }),
  };

  /**
   * 创建可被 PiHubSession 使用的 AgentSession 替身。
   *
   * @returns AgentSession 结构
   */
  const createSession = () => {
    let listener: ((event: unknown) => void) | null = null;
    return {
      sessionId: 'test-session',
      get isIdle() {
        return pi.state.isIdle;
      },
      get messages() {
        return pi.state.messages;
      },
      sessionManager: {
        getBranch: () => pi.state.entries,
      },
      get thinkingLevel() {
        return pi.state.thinkingLevel;
      },
      getAvailableThinkingLevels: () => ['off', 'low', 'medium', 'high'],
      subscribe: (nextListener: (event: unknown) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      prompt: async (_text: string, options: { preflightResult?: (ok: boolean) => void }) => {
        options.preflightResult?.(true);
        for (const event of pi.state.sessionEvents) {
          listener?.(event);
        }
      },
      abort: async () => {
        pi.state.abortCalls += 1;
      },
      setThinkingLevel: (level: string) => {
        pi.state.thinkingLevel = level;
      },
    };
  };

  const settingsManager = {
    flush: async () => {
      pi.state.flushCalls += 1;
    },
  };

  const sessionManager = {
    getCwd: () => '/Users/test',
    getSessionFile: () => '/tmp/lvdagun-test/sessions/test-session.jsonl',
    getHeader: () => ({
      type: 'session',
      version: 3,
      id: 'test-session',
      timestamp: '2026-08-15T00:00:00.000Z',
      cwd: '/Users/test',
    }),
  };

  return {
    ModelRuntime: {
      create: async () => {
        pi.state.createCount += 1;
        return modelRuntime;
      },
    },
    SettingsManager: { create: () => settingsManager },
    SessionManager: {
      create: () => sessionManager,
      open: (path: string) => {
        pi.state.openSessionPaths.push(path);
        return sessionManager;
      },
      listAll: async () => pi.state.sessionInfos,
    },
    createAgentSessionServices: async (options: {
      resourceLoaderOptions: Record<string, unknown>;
    }) => {
      pi.state.resourceLoaderOptions = options.resourceLoaderOptions;
      return { settingsManager, diagnostics: [] };
    },
    createAgentSessionFromServices: async (options: { tools: string[] }) => {
      pi.state.activeTools = options.tools;
      return { session: createSession() };
    },
    createAgentSessionRuntime: async (
      factory: (options: Record<string, unknown>) => Promise<Record<string, unknown>>,
      options: Record<string, unknown>
    ) => {
      const created = await factory(options);
      const session = created.session as ReturnType<typeof createSession>;
      return {
        get session() {
          return session;
        },
        services: created.services,
        setRebindSession: () => {},
        dispose: async () => {
          pi.state.disposeCalls += 1;
        },
      };
    },
    sessionEntryToContextMessages: (entry: {
      type: string;
      message?: unknown;
      summary?: string;
      tokensBefore?: number;
      timestamp?: string;
    }) => {
      if (entry.type === 'message') {
        return [entry.message];
      }
      if (entry.type === 'compaction') {
        return [
          {
            role: 'compactionSummary',
            summary: entry.summary,
            tokensBefore: entry.tokensBefore,
            timestamp: Date.parse(entry.timestamp ?? ''),
          },
        ];
      }
      return [];
    },
  };
});

import { createHub } from '../../src/hub/create-hub';

beforeEach(() => {
  pi.state.providers = [];
  pi.state.streamResult = null;
  pi.state.createCount = 0;
  pi.state.setRuntimeApiKeyCalls = [];
  pi.state.sessionEvents = [];
  pi.state.messages = [];
  pi.state.entries = [];
  pi.state.isIdle = true;
  pi.state.thinkingLevel = 'medium';
  pi.state.abortCalls = 0;
  pi.state.disposeCalls = 0;
  pi.state.flushCalls = 0;
  pi.state.activeTools = [];
  pi.state.resourceLoaderOptions = null;
  pi.state.openSessionPaths = [];
  pi.state.persistedFiles = [];
  pi.state.sessionInfos = [];
});

describe('createHub 目录能力', () => {
  it('只返回支持 API Key 的业务 Provider，并过滤基础设施条目', async () => {
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

  it('返回指定 Provider 的模型并复用 ModelRuntime', async () => {
    pi.state.providers = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        hasApiKeyAuth: true,
        models: [{ id: 'claude-a', name: 'Claude A' }],
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.listModels('anthropic')).resolves.toEqual([
      { id: 'claude-a', name: 'Claude A' },
    ]);
    await hub.listProviders();
    expect(pi.state.createCount).toBe(1);
  });
});

describe('createHub 连接测试', () => {
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

  it('写入运行时凭证并返回连接结果', async () => {
    pi.state.streamResult = { stopReason: 'stop' };
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.testConnection('anthropic', 'sk-test')).resolves.toEqual({ ok: true });
    expect(pi.state.setRuntimeApiKeyCalls).toEqual([{ provider: 'anthropic', apiKey: 'sk-test' }]);
  });

  it('把 Pi stopReason=error 转换为连接失败', async () => {
    pi.state.streamResult = { stopReason: 'error', errorMessage: '401 凭证无效' };
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.testConnection('anthropic', 'sk-bad')).resolves.toEqual({
      ok: false,
      message: '401 凭证无效',
    });
  });
});

describe('createHub 会话能力', () => {
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

  it('启用 Pi 默认工具并关闭范围外资源', async () => {
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await hub.createSession({ provider: 'anthropic', apiKey: '', modelId: 'claude-a' });
    expect(pi.state.activeTools).toEqual(['read', 'bash', 'edit', 'write']);
    expect(pi.state.resourceLoaderOptions).toMatchObject({
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    expect(pi.state.persistedFiles).toEqual([
      {
        path: '/tmp/lvdagun-test/sessions/test-session.jsonl',
        content:
          '{"type":"session","version":3,"id":"test-session","timestamp":"2026-08-15T00:00:00.000Z","cwd":"/Users/test"}\n',
      },
    ]);
  });

  it('列出持久化会话并按不透明 id 打开对应 Pi 文件', async () => {
    pi.state.sessionInfos = [
      {
        id: 'older',
        path: '/tmp/lvdagun-test/sessions/older.jsonl',
        created: new Date(10),
        modified: new Date(20),
        messageCount: 2,
      },
      {
        id: 'newer',
        path: '/tmp/lvdagun-test/sessions/newer.jsonl',
        created: new Date(30),
        modified: new Date(40),
        messageCount: 4,
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });

    await expect(hub.listSessions()).resolves.toEqual([
      { id: 'newer', createdAt: 30, updatedAt: 40, messageCount: 4 },
      { id: 'older', createdAt: 10, updatedAt: 20, messageCount: 2 },
    ]);
    await hub.openSession({ provider: 'anthropic', apiKey: '', modelId: 'claude-a' }, 'older');
    expect(pi.state.openSessionPaths).toEqual(['/tmp/lvdagun-test/sessions/older.jsonl']);
    await expect(
      hub.openSession({ provider: 'anthropic', apiKey: '', modelId: 'claude-a' }, 'missing')
    ).rejects.toThrow('会话不存在:missing');
  });

  it('原样镜像 Pi JSON 事件，并去掉 message_update 累计快照', async () => {
    const startMessage: ChatMessage = {
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-a',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'pending',
      timestamp: 1,
    };
    pi.state.sessionEvents = [
      { type: 'message_start', message: startMessage },
      {
        type: 'message_update',
        message: { ...startMessage, content: [{ type: 'text', text: '你' }] },
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: '你',
          partial: { ...startMessage, content: [{ type: 'text', text: '你' }] },
        },
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.prompt('你好');

    expect(events).toEqual([
      { type: 'message_start', message: startMessage },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你' },
      },
    ]);
  });

  it('委托中止和思考等级，并异步释放 Runtime', async () => {
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });

    await session.abort();
    await expect(session.setThinkingLevel('high')).resolves.toMatchObject({
      thinkingLevel: 'high',
    });
    await session.dispose();

    expect(pi.state.abortCalls).toBe(1);
    expect(pi.state.flushCalls).toBeGreaterThanOrEqual(2);
    expect(pi.state.disposeCalls).toBe(1);
  });

  it('从 Pi 追加式分支恢复压缩前消息和压缩分割线', async () => {
    const oldMessage: ChatMessage = { role: 'user', content: '旧消息', timestamp: 1 };
    pi.state.messages = [
      {
        role: 'compactionSummary',
        summary: '摘要',
        tokensBefore: 100,
        timestamp: 2,
      },
    ];
    pi.state.entries = [
      { type: 'message', message: oldMessage },
      {
        type: 'compaction',
        summary: '摘要',
        tokensBefore: 100,
        timestamp: '1970-01-01T00:00:00.002Z',
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });

    expect(session.getMessages()).toEqual([
      oldMessage,
      {
        role: 'compactionSummary',
        summary: '摘要',
        tokensBefore: 100,
        timestamp: 2,
      },
    ]);
  });
});
