/**
 * @file 会话生命周期:懒创建、配置变更失效、Pi 事件广播。
 */
import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  ModelConfig,
  ThinkingLevel,
} from '@lvdagun/protocol';

import type { ConfigStore } from '../config/config-store';
import type { Hub, HubSession } from '../hub/hub';

/** 未配置领域错误:HTTP 层映射为 409 */
export class NotConfiguredError extends Error {
  /**
   * 创建未配置错误。
   */
  constructor() {
    super('尚未配置模型');
    this.name = 'NotConfiguredError';
  }
}

/** 会话生命周期唯一接口 */
export interface SessionManager {
  /**
   * 获取当前会话，配置变更时按新配置重建。
   *
   * @returns 就绪的会话
   * @throws 未配置模型
   */
  getSession(): Promise<HubSession>;

  /**
   * 读取当前会话消息，无会话时返回空数组。
   *
   * @returns Pi 结构化消息历史
   */
  getMessages(): ChatMessage[];

  /**
   * 读取当前会话状态，必要时懒创建会话。
   *
   * @returns Agent 运行与思考等级状态
   */
  getState(): Promise<AgentSessionState>;

  /**
   * 在 Agent 空闲时创建 Pi 新会话。
   *
   * @returns 新会话就绪后解决的 Promise
   */
  newSession(): Promise<void>;

  /**
   * 中止当前 Agent 运行，无会话时直接完成。
   *
   * @returns Agent 稳定后解决的 Promise
   */
  abort(): Promise<void>;

  /**
   * 设置当前会话思考等级。
   *
   * @param level - 请求的 Pi 思考等级
   * @returns 设置后的会话状态
   */
  setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState>;

  /**
   * 配置变更后释放并作废当前会话。
   *
   * @returns 资源释放完成后解决的 Promise
   */
  invalidate(): Promise<void>;
}

/**
 * 创建会话管理器。
 *
 * @param hub - Hub 能力
 * @param configStore - 配置存取
 * @param broadcast - Pi JSON 事件广播函数
 * @returns 会话管理操作集
 */
export function createSessionManager(
  hub: Hub,
  configStore: ConfigStore,
  broadcast: (event: AgentStreamEvent) => void
): SessionManager {
  let session: HubSession | null = null;
  let sessionKey: string | null = null;
  let unsubscribe: (() => void) | null = null;

  /**
   * 释放当前会话及事件订阅。
   *
   * @returns 资源释放完成后解决的 Promise
   */
  const dispose = async (): Promise<void> => {
    const currentSession = session;
    unsubscribe?.();
    unsubscribe = null;
    session = null;
    sessionKey = null;
    await currentSession?.dispose();
  };

  /**
   * 根据模型配置生成会话复用指纹。
   *
   * @param config - 完整模型配置
   * @returns 稳定的配置指纹
   */
  const keyOf = (config: ModelConfig): string =>
    `${config.provider}\n${config.modelId}\n${config.apiKey}`;

  return {
    async getSession(): Promise<HubSession> {
      const config = await configStore.load();
      if (!config) {
        throw new NotConfiguredError();
      }
      const key = keyOf(config);
      if (!session || sessionKey !== key) {
        await dispose();
        session = await hub.createSession(config);
        sessionKey = key;
        unsubscribe = session.subscribe(broadcast);
      }
      return session;
    },

    getMessages(): ChatMessage[] {
      return session ? session.getMessages() : [];
    },

    async getState(): Promise<AgentSessionState> {
      return (await this.getSession()).getState();
    },

    async newSession(): Promise<void> {
      await (await this.getSession()).newSession();
    },

    async abort(): Promise<void> {
      await session?.abort();
    },

    async setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState> {
      return (await this.getSession()).setThinkingLevel(level);
    },

    async invalidate(): Promise<void> {
      await dispose();
    },
  };
}
