/**
 * @file Hub:Pi SDK 的适配层。
 *
 * 客户端与本地服务只依赖 Hub 接口,不感知 Pi 的存在;
 * 本模块是唯一 import Pi SDK 的地方,SDK 升级/替换只影响这里。
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';

import type {
  ChatMessage,
  HubEvent,
  ModelConfig,
  ModelInfo,
  ProviderInfo,
  TestConnectionResult,
} from './protocol';

/**
 * Hub 会话:本地服务与内核之间唯一的契约。
 */
export interface HubSession {
  /**
   * 发送用户消息,处理完整回复(含流式事件推送)。
   *
   * @param text - 用户消息文本
   */
  prompt(text: string): Promise<void>;

  /**
   * 订阅 Hub 事件流。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: HubEvent) => void): () => void;

  /** 当前会话的完整消息历史(客户端重新打开页面时恢复) */
  getMessages(): ChatMessage[];

  /** 释放会话资源 */
  dispose(): void;
}

/** Hub 能力集合:向导所需目录能力 + 会话工厂 */
export interface Hub {
  listProviders(): Promise<ProviderInfo[]>;

  listModels(providerId: string): Promise<ModelInfo[]>;

  testConnection(provider: string, apiKey: string): Promise<TestConnectionResult>;

  /**
   * 按模型配置创建会话。
   *
   * @param config - 模型配置(provider/apiKey/modelId)
   * @returns 就绪的 Hub 会话
   * @throws 模型不存在或初始化失败
   */
  createSession(config: ModelConfig): Promise<HubSession>;
}

/** 基础设施/内部 Provider:不是给用户填 Key 用的,向导列表排除 */
const INFRA_PROVIDERS = new Set([
  'faux',
  'cloudflare-auth',
  'radius-config',
  'radius',
  'amazon-bedrock',
]);

/** V0 默认系统提示词(后续挪到配置/资源文件) */
const DEFAULT_SYSTEM_PROMPT = '你是驴打滚,运行在用户电脑上的个人 AI 管家。回答简洁、直接、用中文。';

/**
 * 创建 Hub。
 *
 * @param options.dataDir - 数据目录:Pi 的目录缓存与自定义模型文件指向这里,凭证不落盘
 * @returns Hub 实例
 */
export function createHub(options: { dataDir: string }): Hub {
  const { dataDir } = options;
  // 懒加载单例:缓存 Promise 而非实例,并发首调也只初始化一次;
  // 向导流程不需要运行时,所以延迟到首次真正使用
  let runtimePromise: Promise<ModelRuntime> | null = null;
  const getRuntime = (): Promise<ModelRuntime> => {
    runtimePromise ??= ModelRuntime.create({
      // 凭证只存内存:持久化凭证的唯一来源是本项目的 config.json
      credentials: new InMemoryCredentialStore(),
      modelsPath: join(dataDir, 'models.json'),
      modelsStorePath: join(dataDir, 'models-store.json'),
    });
    return runtimePromise;
  };

  return {
    async listProviders(): Promise<ProviderInfo[]> {
      const runtime = await getRuntime();
      // 过滤:排除基础设施黑名单,且必须有 API Key 认证方式
      // (oauth-only 的条目用户无法在向导里配置,如 github-copilot)
      return runtime
        .getProviders()
        .filter((provider) => provider.auth.apiKey !== undefined && !INFRA_PROVIDERS.has(provider.id))
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
      // setRuntimeApiKey 只写入运行时、不落盘,测试通过后保存配置时才真正持久化
      await runtime.setRuntimeApiKey(providerId, apiKey);

      const model = runtime
        .getProviders()
        .find((item) => item.id === providerId)
        ?.getModels()[0];
      if (!model) {
        return { ok: false, message: `未找到 provider:${providerId}` };
      }

      // 用目录里第一个模型发 1 token 最小请求,10 秒超时;
      // 比查 API 状态更真实(同时验证 Key 与网络链路)
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
        // Pi 的事件流在 API 报错时不 reject:错误以 stopReason: 'error' 的消息收尾,必须显式检查
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

    async createSession(config: ModelConfig): Promise<HubSession> {
      const runtime = await getRuntime();
      if (config.apiKey) {
        await runtime.setRuntimeApiKey(config.provider, config.apiKey);
      }

      const model = runtime.getModel(config.provider, config.modelId);
      if (!model) {
        throw new Error(`未找到模型:${config.provider}/${config.modelId}`);
      }

      // 关闭 skills/上下文文件发现:它们是为编码代理设计的,注入个人管家会产生干扰。
      // cwd 用主目录,为后续文件工具铺路;agentDir 指向自己的数据目录。
      const loader = new DefaultResourceLoader({
        cwd: homedir(),
        agentDir: dataDir,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        noSkills: true,
        noContextFiles: true,
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: homedir(),
        agentDir: dataDir,
        model,
        modelRuntime: runtime,
        resourceLoader: loader,
        // V0 纯对话:不启用任何工具
        noTools: 'all',
        sessionManager: SessionManager.inMemory(),
        settingsManager: SettingsManager.inMemory(),
      });

      return new PiHubSession(session);
    },
  };
}

/**
 * Pi 会话的 HubSession 实现:把 Pi 事件流翻译为协议事件流。
 *
 * 翻译职责:Pi 的消息对象没有 id 字段,协议要求消息带 id,
 * 所以 id 在边界处生成(user 在 prompt 时、assistant 在 message_start 时)。
 */
class PiHubSession implements HubSession {
  private readonly session: AgentSession;
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private history: ChatMessage[] = [];
  /** 当前正在流式输出的 AI 消息(累计文本) */
  private streaming: { messageId: string; text: string } | null = null;
  private readonly unsubscribe: () => void;

  constructor(session: AgentSession) {
    this.session = session;
    this.unsubscribe = session.subscribe(this.handleEvent);
  }

  async prompt(text: string): Promise<void> {
    const message: ChatMessage = { id: randomUUID(), role: 'user', text };
    this.history.push(message);
    this.emit({ type: 'user_message', message });
    try {
      await this.session.prompt(text);
    } catch (error) {
      this.emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getMessages(): ChatMessage[] {
    // 返回副本:外部修改不会破坏内部历史
    return [...this.history];
  }

  dispose(): void {
    this.unsubscribe();
    this.session.dispose();
  }

  private emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Pi 事件 → 协议事件。只翻译 V0 对话需要的事件,其余忽略。 */
  private handleEvent = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case 'message_start': {
        if (event.message.role === 'assistant') {
          this.streaming = { messageId: randomUUID(), text: '' };
          this.emit({ type: 'assistant_message_start', messageId: this.streaming.messageId });
        }
        break;
      }
      case 'message_update': {
        // 只转发文本增量;thinking_delta 是模型思考过程,不进对话流
        if (this.streaming && event.assistantMessageEvent.type === 'text_delta') {
          this.streaming.text += event.assistantMessageEvent.delta;
          this.emit({
            type: 'assistant_text_delta',
            messageId: this.streaming.messageId,
            delta: event.assistantMessageEvent.delta,
          });
        }
        break;
      }
      case 'message_end': {
        if (event.message.role === 'assistant' && this.streaming) {
          const message: ChatMessage = {
            id: this.streaming.messageId,
            role: 'assistant',
            text: this.streaming.text,
          };
          this.history.push(message);
          this.emit({ type: 'assistant_message_end', message });
          this.streaming = null;
        }
        break;
      }
      default:
        break;
    }
  };
}
