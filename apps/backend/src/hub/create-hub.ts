/**
 * @file Pi SDK 的 Agent Hub 适配器。
 *
 * 本模块是本地服务中唯一创建 Pi 运行时和会话的地方。
 */
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager as PiSessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { ModelInfo, ProviderInfo, TestConnectionResult } from '@lvdagun/protocol';

import { SessionNotFoundError, type Hub, type HubSession } from './hub';
import { PiHubSession } from './pi-hub-session';

const INFRA_PROVIDERS = new Set([
  'faux',
  'cloudflare-auth',
  'radius-config',
  'radius',
  'amazon-bedrock',
]);

const DEFAULT_SYSTEM_PROMPT = '你是驴打滚,运行在用户电脑上的个人 AI 管家。回答简洁、直接、用中文。';
const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'];

/**
 * 创建基于 Pi SDK 的 Agent Hub。
 *
 * @param options.dataDir - Pi 缓存、自定义模型和 Agent 资源使用的数据目录
 * @returns Agent Hub 实例
 */
export function createHub(options: { dataDir: string }): Hub {
  const { dataDir } = options;
  const cwd = homedir();
  const sessionDir = join(dataDir, 'sessions');
  let runtimePromise: Promise<ModelRuntime> | null = null;

  /**
   * 懒加载并复用模型运行时。
   *
   * @returns 模型运行时
   */
  const getRuntime = (): Promise<ModelRuntime> => {
    runtimePromise ??= ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: join(dataDir, 'models.json'),
      modelsStorePath: join(dataDir, 'models-store.json'),
    });
    return runtimePromise;
  };

  /**
   * 使用指定 Pi SessionManager 创建完整会话 Runtime。
   *
   * @param config - 当前模型配置
   * @param piSessionManager - 新建或打开的 Pi 持久化会话管理器
   * @returns Hub 会话适配器
   */
  const createHubSession = async (
    config: Parameters<Hub['createSession']>[0],
    piSessionManager: PiSessionManager
  ): Promise<HubSession> => {
    const runtime = await getRuntime();
    if (config.apiKey) {
      await runtime.setRuntimeApiKey(config.provider, config.apiKey);
    }

    const model = runtime.getModel(config.provider, config.modelId);
    if (!model) {
      throw new Error(`未找到模型:${config.provider}/${config.modelId}`);
    }

    const settingsManager = SettingsManager.create(piSessionManager.getCwd(), dataDir, {
      projectTrusted: true,
    });

    /**
     * 为当前持久化会话创建一致的 Pi Runtime 服务。
     *
     * @param runtimeOptions - Pi Runtime 请求的工作目录、会话存储和启动事件
     * @returns 完整的 Pi AgentSession Runtime 结果
     */
    const createRuntime: CreateAgentSessionRuntimeFactory = async (runtimeOptions) => {
      const services = await createAgentSessionServices({
        cwd: runtimeOptions.cwd,
        agentDir: dataDir,
        modelRuntime: runtime,
        settingsManager,
        resourceLoaderOptions: {
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager: runtimeOptions.sessionManager,
          sessionStartEvent: runtimeOptions.sessionStartEvent,
          model,
          tools: DEFAULT_TOOLS,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    const agentRuntime = await createAgentSessionRuntime(createRuntime, {
      cwd: piSessionManager.getCwd(),
      agentDir: dataDir,
      sessionManager: piSessionManager,
    });

    return new PiHubSession(agentRuntime);
  };

  /**
   * 创建立即可被 Pi 列出的空会话。
   *
   * Pi 默认等到第一条 assistant 消息才创建 JSONL；产品中的“新对话”在点击后就已经是
   * 持久会话，因此先写入 Pi 生成的标准 header，再重新打开以同步其内部持久化状态。
   *
   * @returns 已持久化的 Pi 会话管理器
   */
  const createPersistedSessionManager = async (): Promise<PiSessionManager> => {
    const manager = PiSessionManager.create(cwd, sessionDir);
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) {
      throw new Error('Pi 未生成会话文件路径');
    }
    await writeFile(sessionFile, `${JSON.stringify(manager.getHeader())}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return PiSessionManager.open(sessionFile, sessionDir);
  };

  return {
    async listProviders(): Promise<ProviderInfo[]> {
      const runtime = await getRuntime();
      return runtime
        .getProviders()
        .filter(
          (provider) => provider.auth.apiKey !== undefined && !INFRA_PROVIDERS.has(provider.id)
        )
        .map((provider) => ({ id: provider.id, name: provider.name }));
    },

    async listModels(providerId: string): Promise<ModelInfo[]> {
      const runtime = await getRuntime();
      const provider = runtime.getProviders().find((item) => item.id === providerId);
      if (!provider) {
        return [];
      }
      return provider.getModels().map((model) => ({ id: model.id, name: model.name }));
    },

    async testConnection(providerId: string, apiKey: string): Promise<TestConnectionResult> {
      const runtime = await getRuntime();
      await runtime.setRuntimeApiKey(providerId, apiKey);

      const model = runtime
        .getProviders()
        .find((item) => item.id === providerId)
        ?.getModels()[0];
      if (!model) {
        return { ok: false, message: `未找到 provider:${providerId}` };
      }

      const stream = runtime.streamSimple(
        model,
        {
          systemPrompt: '连接测试。',
          messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
          tools: [],
        },
        { maxTokens: 1, signal: AbortSignal.timeout(10_000) }
      );

      try {
        const result = await stream.result();
        // Pi 通过 stopReason 报告 API 错误，不会让 result() reject。
        if (result.stopReason === 'error') {
          return { ok: false, message: result.errorMessage ?? '连接失败' };
        }
        return { ok: true };
      } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'TimeoutError';
        return {
          ok: false,
          message: isTimeout
            ? '连接超时(10 秒)'
            : `连接失败:${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    async listSessions() {
      const sessions = await PiSessionManager.listAll(sessionDir);
      return sessions
        .map((session) => ({
          id: session.id,
          createdAt: session.created.getTime(),
          updatedAt: session.modified.getTime(),
          messageCount: session.messageCount,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },

    async createSession(config) {
      return createHubSession(config, await createPersistedSessionManager());
    },

    async openSession(config, sessionId) {
      const stored = (await PiSessionManager.listAll(sessionDir)).find(
        (session) => session.id === sessionId
      );
      if (!stored) {
        throw new SessionNotFoundError(sessionId);
      }
      return createHubSession(config, PiSessionManager.open(stored.path, sessionDir));
    },
  };
}
