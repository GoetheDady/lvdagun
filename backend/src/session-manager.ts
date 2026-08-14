/**
 * @file 会话生命周期:懒创建、配置变更失效、事件广播。
 *
 * 独立于 HTTP:未配置抛领域错误,由传输层映射成对应状态码;
 * 换传输层(V1 壳/局域网接入)时本模块语义不变。
 */
import type { ConfigStore } from './config';
import type { Hub, HubSession } from './hub';
import type { ChatMessage, HubEvent, ModelConfig } from './protocol';

/** 未配置领域错误:对应 CONTEXT.md 的「未配置」,HTTP 层映射为 409 */
export class NotConfiguredError extends Error {
  constructor() {
    super('尚未配置模型');
    this.name = 'NotConfiguredError';
  }
}

/** 会话管理操作集:会话生命周期唯一接口 */
export interface SessionManager {
  /**
   * 获取当前会话;未配置抛 NotConfiguredError,配置变更时按新配置重建。
   *
   * @returns 就绪的会话
   * @throws 未配置模型
   */
  getSession(): Promise<HubSession>;

  /** 当前会话消息历史;无会话时为空 */
  getMessages(): ChatMessage[];

  /** 清空会话:释放当前会话并广播 session_cleared(无会话时不广播) */
  clear(): void;

  /** 配置变更后作废当前会话(下次对话重建,不广播) */
  invalidate(): void;
}

/**
 * 创建会话管理器。
 *
 * 懒创建:首次 getSession 才按当前配置建会话;
 * 复用:配置指纹不变就复用同一会话,避免每次请求重建;
 * 事件:会话事件经 broadcast 转发(由调用方接到 SSE 客户端)。
 *
 * @param hub - Hub 能力
 * @param configStore - 配置存取
 * @param broadcast - 事件广播函数
 * @returns 会话管理操作集
 */
export function createSessionManager(
  hub: Hub,
  configStore: ConfigStore,
  broadcast: (event: HubEvent) => void
): SessionManager {
  let session: HubSession | null = null;
  /** 创建会话时用的配置指纹:配置不变就复用会话 */
  let sessionKey: string | null = null;
  let unsubscribe: (() => void) | null = null;

  const dispose = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    session?.dispose();
    session = null;
    sessionKey = null;
  };

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
        dispose();
        session = await hub.createSession(config);
        sessionKey = key;
        unsubscribe = session.subscribe(broadcast);
      }
      return session;
    },

    getMessages(): ChatMessage[] {
      return session ? session.getMessages() : [];
    },

    clear(): void {
      const hadSession = session !== null;
      dispose();
      if (hadSession) {
        broadcast({ type: 'session_cleared' });
      }
    },

    invalidate(): void {
      dispose();
    },
  };
}
