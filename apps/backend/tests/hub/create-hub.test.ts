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
    streamResult: null as
      | null
      | ChatMessage
      | Promise<ChatMessage>
      | { stopReason: string; errorMessage?: string }
      | Error,
    streamContexts: [] as unknown[],
    createCount: 0,
    setRuntimeApiKeyCalls: [] as Array<{ provider: string; apiKey: string }>,
    loginCalls: [] as Array<{ provider: string; type: string; apiKey: string }>,
    streamApiKeys: [] as Array<string | undefined>,
    runtimeCreateOptions: null as null | Record<string, unknown>,
    setModelCalls: [] as Array<{ provider: string; id: string }>,
    currentModel: null as null | { provider: string; id: string; name: string },
    storedModel: null as null | { provider: string; modelId: string },
    sessionEvents: [] as unknown[],
    messages: [] as unknown[],
    entries: [] as unknown[],
    sessionName: undefined as string | undefined,
    isIdle: true,
    thinkingLevel: 'medium',
    storedThinkingLevel: 'medium',
    abortCalls: 0,
    abortCompactionCalls: 0,
    disposeCalls: 0,
    flushCalls: 0,
    activeTools: [] as string[],
    resourceLoaderOptions: null as null | Record<string, unknown>,
    openSessionPaths: [] as string[],
    persistedFiles: [] as Array<{ path: string; content: string }>,
    deletedPaths: [] as string[],
    archivedSessionInfos: [] as Array<{
      id: string;
      path: string;
      name?: string;
      firstMessage: string;
      created: Date;
      modified: Date;
      messageCount: number;
    }>,
    sessionInfos: [] as Array<{
      id: string;
      path: string;
      name?: string;
      firstMessage: string;
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
  mkdir: async () => {},
  rename: async (from: string, to: string) => {
    const session = pi.state.sessionInfos.find((candidate) => candidate.path === from);
    if (session) {
      pi.state.sessionInfos = pi.state.sessionInfos.filter((candidate) => candidate !== session);
      pi.state.archivedSessionInfos.push({ ...session, path: to });
    }
  },
  unlink: async (path: string) => {
    pi.state.deletedPaths.push(path);
    pi.state.sessionInfos = pi.state.sessionInfos.filter((session) => session.path !== path);
  },
}));

vi.mock('@earendil-works/pi-coding-agent', () => {
  const modelRuntime = {
    getProvider: (providerId: string) =>
      pi.state.providers.find((provider) => provider.id === providerId),
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
      pi.state.providers
        .find((provider) => provider.id === providerId)
        ?.models.filter((model) => model.id === modelId)
        .map((model) => ({ ...model, provider: providerId, reasoning: true }))[0],
    getAvailable: async () =>
      pi.state.providers.flatMap((provider) =>
        provider.models.map((model) => ({
          ...model,
          provider: provider.id,
          reasoning: true,
        }))
      ),
    getAvailableSnapshot: () =>
      pi.state.providers.flatMap((provider) =>
        provider.models.map((model) => ({
          ...model,
          provider: provider.id,
          reasoning: true,
        }))
      ),
    streamSimple: (_model: unknown, context: unknown, options?: { apiKey?: string }) => {
      pi.state.streamApiKeys.push(options?.apiKey);
      pi.state.streamContexts.push(context);
      return {
        result: async () => {
          if (pi.state.streamResult instanceof Error) {
            throw pi.state.streamResult;
          }
          return pi.state.streamResult;
        },
      };
    },
    login: async (provider: string, type: string, interaction: { prompt(): Promise<string> }) => {
      pi.state.loginCalls.push({ provider, type, apiKey: await interaction.prompt() });
    },
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
      get sessionName() {
        return pi.state.sessionName;
      },
      get isIdle() {
        return pi.state.isIdle;
      },
      get messages() {
        return pi.state.messages;
      },
      sessionManager: {
        getBranch: () => pi.state.entries,
        appendCustomEntry: (customType: string, data: unknown) => {
          pi.state.entries.push({ type: 'custom', customType, data });
          return 'custom-entry';
        },
      },
      get thinkingLevel() {
        return pi.state.thinkingLevel;
      },
      get model() {
        return pi.state.currentModel;
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
      abortCompaction: () => {
        pi.state.abortCompactionCalls += 1;
        listener?.({
          type: 'compaction_end',
          reason: 'threshold',
          result: undefined,
          aborted: true,
          willRetry: false,
        });
      },
      setThinkingLevel: (level: string) => {
        pi.state.thinkingLevel = level;
      },
      setModel: async (model: { provider: string; id: string; name: string }) => {
        pi.state.setModelCalls.push({ provider: model.provider, id: model.id });
        pi.state.currentModel = model;
      },
      setSessionName: (name: string) => {
        pi.state.sessionName = name;
        listener?.({ type: 'session_info_changed', name });
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
    buildSessionContext: () => ({
      messages: [],
      thinkingLevel: pi.state.storedThinkingLevel,
      model: pi.state.storedModel,
    }),
    getBranch: () => pi.state.entries,
  };

  return {
    ModelRuntime: {
      create: async (options: Record<string, unknown>) => {
        pi.state.createCount += 1;
        pi.state.runtimeCreateOptions = options;
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
      listAll: async (sessionDir: string) =>
        sessionDir.endsWith('/archived-sessions')
          ? pi.state.archivedSessionInfos
          : pi.state.sessionInfos,
    },
    createAgentSessionServices: async (options: {
      resourceLoaderOptions: Record<string, unknown>;
    }) => {
      pi.state.resourceLoaderOptions = options.resourceLoaderOptions;
      return { settingsManager, modelRuntime, diagnostics: [] };
    },
    createAgentSessionFromServices: async (options: {
      tools: string[];
      model: { provider: string; id: string; name: string };
      thinkingLevel?: string;
    }) => {
      pi.state.activeTools = options.tools;
      pi.state.currentModel = options.model;
      if (options.thinkingLevel) {
        pi.state.thinkingLevel = options.thinkingLevel;
      }
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
  pi.state.loginCalls = [];
  pi.state.streamApiKeys = [];
  pi.state.streamContexts = [];
  pi.state.runtimeCreateOptions = null;
  pi.state.setModelCalls = [];
  pi.state.currentModel = null;
  pi.state.storedModel = null;
  pi.state.sessionEvents = [];
  pi.state.messages = [];
  pi.state.entries = [];
  pi.state.sessionName = undefined;
  pi.state.isIdle = true;
  pi.state.thinkingLevel = 'medium';
  pi.state.storedThinkingLevel = 'medium';
  pi.state.abortCalls = 0;
  pi.state.abortCompactionCalls = 0;
  pi.state.disposeCalls = 0;
  pi.state.flushCalls = 0;
  pi.state.activeTools = [];
  pi.state.resourceLoaderOptions = null;
  pi.state.openSessionPaths = [];
  pi.state.persistedFiles = [];
  pi.state.deletedPaths = [];
  pi.state.archivedSessionInfos = [];
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
    expect(pi.state.streamApiKeys).toEqual(['sk-test']);
    expect(pi.state.loginCalls).toEqual([
      { provider: 'anthropic', type: 'api_key', apiKey: 'sk-test' },
    ]);
    expect(pi.state.runtimeCreateOptions).toMatchObject({
      authPath: '/tmp/lvdagun-test/auth.json',
    });
    expect(pi.state.runtimeCreateOptions).not.toHaveProperty('credentials');
  });

  it('把 Pi stopReason=error 转换为连接失败', async () => {
    pi.state.streamResult = { stopReason: 'error', errorMessage: '401 凭证无效' };
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    await expect(hub.testConnection('anthropic', 'sk-bad')).resolves.toEqual({
      ok: false,
      message: '401 凭证无效',
    });
    expect(pi.state.loginCalls).toEqual([]);
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

  it('列出可用模型并在空闲时切换会话模型', async () => {
    pi.state.providers.push({
      id: 'openai',
      name: 'OpenAI',
      hasApiKeyAuth: true,
      models: [{ id: 'gpt-a', name: 'GPT A' }],
    });
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    expect(session.getState()).toMatchObject({
      model: { provider: 'anthropic', id: 'claude-a', name: 'Claude A' },
      availableModels: [
        {
          provider: 'anthropic',
          providerName: 'Anthropic',
          id: 'claude-a',
          name: 'Claude A',
        },
        { provider: 'openai', providerName: 'OpenAI', id: 'gpt-a', name: 'GPT A' },
      ],
    });

    await expect(session.setModel({ provider: 'openai', id: 'gpt-a' })).resolves.toMatchObject({
      model: { provider: 'openai', id: 'gpt-a', name: 'GPT A' },
    });
    expect(pi.state.setModelCalls).toEqual([{ provider: 'openai', id: 'gpt-a' }]);
    expect(events).toContainEqual({
      type: 'session_model_changed',
      state: expect.objectContaining({
        model: expect.objectContaining({ provider: 'openai', id: 'gpt-a', name: 'GPT A' }),
      }),
    });

    pi.state.isIdle = false;
    await expect(session.setModel({ provider: 'anthropic', id: 'claude-a' })).rejects.toThrow(
      'Agent 正在运行'
    );
  });

  it('列出持久化会话并按不透明 id 打开对应 Pi 文件', async () => {
    pi.state.sessionInfos = [
      {
        id: 'older',
        path: '/tmp/lvdagun-test/sessions/older.jsonl',
        name: '已有标题',
        firstMessage: '旧会话首条消息',
        created: new Date(10),
        modified: new Date(20),
        messageCount: 2,
      },
      {
        id: 'newer',
        path: '/tmp/lvdagun-test/sessions/newer.jsonl',
        firstMessage: '新会话首条消息',
        created: new Date(30),
        modified: new Date(40),
        messageCount: 4,
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });

    await expect(hub.listSessions()).resolves.toEqual([
      {
        id: 'newer',
        name: undefined,
        firstMessage: '新会话首条消息',
        createdAt: 30,
        updatedAt: 40,
        messageCount: 4,
      },
      {
        id: 'older',
        name: '已有标题',
        firstMessage: '旧会话首条消息',
        createdAt: 10,
        updatedAt: 20,
        messageCount: 2,
      },
    ]);
    await hub.openSession({ provider: 'anthropic', apiKey: '', modelId: 'claude-a' }, 'older');
    expect(pi.state.openSessionPaths).toEqual(['/tmp/lvdagun-test/sessions/older.jsonl']);
    await expect(
      hub.openSession({ provider: 'anthropic', apiKey: '', modelId: 'claude-a' }, 'missing')
    ).rejects.toThrow('会话不存在:missing');
  });

  it('把归档会话移出活跃目录并永久删除未归档会话文件', async () => {
    pi.state.sessionInfos = [
      {
        id: 'archived',
        path: '/tmp/lvdagun-test/sessions/archived.jsonl',
        firstMessage: '待归档',
        created: new Date(10),
        modified: new Date(20),
        messageCount: 2,
      },
      {
        id: 'deleted',
        path: '/tmp/lvdagun-test/sessions/deleted.jsonl',
        firstMessage: '待删除',
        created: new Date(30),
        modified: new Date(40),
        messageCount: 1,
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });

    await hub.archiveSession('archived');
    await expect(hub.listSessions()).resolves.toEqual([
      {
        id: 'deleted',
        name: undefined,
        firstMessage: '待删除',
        createdAt: 30,
        updatedAt: 40,
        messageCount: 1,
      },
    ]);
    await expect(
      hub.openSession({ provider: 'anthropic', apiKey: '', modelId: 'claude-a' }, 'archived')
    ).rejects.toThrow('会话已归档:archived');
    await expect(hub.deleteSession('archived')).rejects.toThrow('会话已归档:archived');

    await hub.deleteSession('deleted');
    expect(pi.state.deletedPaths).toEqual(['/tmp/lvdagun-test/sessions/deleted.jsonl']);
    await expect(hub.listSessions()).resolves.toEqual([]);
  });

  it('恢复空会话分支中已持久化的会话模型', async () => {
    pi.state.providers.push({
      id: 'openai',
      name: 'OpenAI',
      hasApiKeyAuth: true,
      models: [{ id: 'gpt-a', name: 'GPT A' }],
    });
    pi.state.storedModel = { provider: 'openai', modelId: 'gpt-a' };
    pi.state.sessionInfos = [
      {
        id: 'saved',
        path: '/tmp/lvdagun-test/sessions/saved.jsonl',
        firstMessage: '',
        created: new Date(10),
        modified: new Date(20),
        messageCount: 0,
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });

    const session = await hub.openSession(
      { provider: 'anthropic', apiKey: '', modelId: 'claude-a' },
      'saved'
    );

    expect(session.getState()).toMatchObject({
      model: { provider: 'openai', id: 'gpt-a', name: 'GPT A' },
      modelWarning: null,
    });
  });

  it('恢复空会话分支中已持久化的思考等级', async () => {
    pi.state.storedThinkingLevel = 'high';
    pi.state.entries = [{ type: 'thinking_level_change', thinkingLevel: 'high' }];
    pi.state.sessionInfos = [
      {
        id: 'saved',
        path: '/tmp/lvdagun-test/sessions/saved.jsonl',
        firstMessage: '',
        created: new Date(10),
        modified: new Date(20),
        messageCount: 0,
      },
    ];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });

    const session = await hub.openSession(
      { provider: 'anthropic', apiKey: '', modelId: 'claude-a' },
      'saved'
    );

    expect(session.getState().thinkingLevel).toBe('high');
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

  it('首次成功运行后使用当前模型生成一次 Pi 会话名称', async () => {
    const userMessage: ChatMessage = { role: 'user', content: '帮我设计自动标题功能', timestamp: 1 };
    const answerMessage: Extract<ChatMessage, { role: 'assistant' }> = {
      role: 'assistant',
      content: [{ type: 'text', text: '采用 Pi 原生会话名称实现。' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-a',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 2,
    };
    pi.state.entries = [
      { type: 'message', message: userMessage },
      { type: 'message', message: answerMessage },
    ];
    pi.state.sessionEvents = [{ type: 'agent_settled' }];
    pi.state.streamResult = { ...answerMessage, content: [{ type: 'text', text: '自动生成的会话标题' }] };
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });

    await session.prompt('继续');
    await vi.waitFor(() => expect(session.getState().sessionName).toBe('自动生成的会话标题'));
    await session.prompt('再次运行');

    expect(pi.state.streamContexts).toHaveLength(1);
    expect(pi.state.entries).toContainEqual(
      expect.objectContaining({ type: 'custom', customType: 'lvdagun.auto-title-attempted' })
    );
  });

  it('自动标题生成期间的手动名称不会被覆盖', async () => {
    const answerMessage: Extract<ChatMessage, { role: 'assistant' }> = {
      role: 'assistant',
      content: [{ type: 'text', text: '已经完成实现。' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-a',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 2,
    };
    pi.state.entries = [
      { type: 'message', message: { role: 'user', content: '实现标题', timestamp: 1 } },
      { type: 'message', message: answerMessage },
    ];
    pi.state.sessionEvents = [{ type: 'agent_settled' }];
    let resolveTitle!: (message: ChatMessage) => void;
    pi.state.streamResult = new Promise((resolve) => {
      resolveTitle = resolve;
    });
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });

    await session.prompt('继续');
    await vi.waitFor(() => expect(pi.state.streamContexts).toHaveLength(1));
    session.setSessionName('用户手动设置的标题');
    resolveTitle({ ...answerMessage, content: [{ type: 'text', text: '自动生成的会话标题' }] });

    await vi.waitFor(() => expect(session.getState().sessionName).toBe('用户手动设置的标题'));
  });

  it('跟踪自动压缩，并在中止时同时取消压缩和 Agent 运行', async () => {
    pi.state.sessionEvents = [{ type: 'compaction_start', reason: 'threshold' }];
    const hub = createHub({ dataDir: '/tmp/lvdagun-test' });
    const session = await hub.createSession({
      provider: 'anthropic',
      apiKey: '',
      modelId: 'claude-a',
    });

    await session.prompt('你好');
    expect(session.getState()).toMatchObject({
      isRunning: true,
      activeCompaction: { reason: 'threshold' },
    });

    await session.abort();
    expect(session.getState().activeCompaction).toBeNull();
    await expect(session.setThinkingLevel('high')).resolves.toMatchObject({
      thinkingLevel: 'high',
    });
    await session.dispose();

    expect(pi.state.abortCalls).toBe(1);
    expect(pi.state.abortCompactionCalls).toBe(1);
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
