import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
} from '@earendil-works/pi-coding-agent';
import { sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import type {
  ActiveCompaction,
  AgentSessionState,
  AgentStreamEvent,
  AvailableModel,
  ChatMessage,
  ModelReference,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { AgentBusyError, ModelUnavailableError, type HubSession } from './hub';
import { toJsonAgentEvent } from './pi-json-event';

/** 使用 Pi AgentSessionRuntime 的 Hub 会话实现 */
export class PiHubSession implements HubSession {
  readonly id: string;
  readonly createdAt: number;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private activeCompaction: ActiveCompaction | null = null;
  private modelWarning: string | null;
  private unsubscribeSession: (() => void) | null = null;

  /**
   * 创建 Pi Runtime 会话适配器并绑定当前会话事件。
   *
   * @param runtime - 可替换当前 AgentSession 的 Pi Runtime
   * @param modelWarning - 恢复会话模型失败时的非阻塞警告
   */
  constructor(
    private readonly runtime: AgentSessionRuntime,
    modelWarning: string | null = null
  ) {
    this.modelWarning = modelWarning;
    this.id = runtime.session.sessionId;
    this.createdAt = Date.now();
    this.bindSession(runtime.session);
    runtime.setRebindSession(async (session) => {
      this.bindSession(session);
    });
  }

  /**
   * 接受用户提示，前置校验通过后立即返回。
   *
   * @param text - 用户提示文本
   * @returns Pi 接受提示后解决的 Promise
   * @throws Agent 正在运行或 Pi 前置校验失败
   */
  async prompt(text: string): Promise<void> {
    const session = this.runtime.session;
    if (!session.isIdle) {
      throw new AgentBusyError();
    }

    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      void session
        .prompt(text, {
          preflightResult: (ok) => {
            if (ok) {
              accepted = true;
              resolve();
            }
          },
        })
        .catch((error: unknown) => {
          if (!accepted) {
            reject(error);
            return;
          }
          console.error('Pi Agent 运行异常:', error);
        });
    });
  }

  /**
   * 订阅 Pi JSON 会话事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 读取当前 Pi 会话分支的完整展示历史。
   *
   * `session.messages` 是压缩后提供给模型的上下文，会省略已被摘要覆盖的旧消息；展示历史
   * 必须从 Pi 的追加式会话条目投影，才能保留压缩前消息及压缩分割线。
   *
   * @returns 当前分支中的完整结构化消息
   */
  getMessages(): ChatMessage[] {
    return this.runtime.session.sessionManager
      .getBranch()
      .flatMap((entry) => sessionEntryToContextMessages(entry));
  }

  /**
   * 读取 Agent 运行与思考等级状态。
   *
   * @returns 当前会话状态
   */
  getState(): AgentSessionState {
    const session = this.runtime.session;
    const model = session.model;
    if (!model) {
      throw new Error('Pi 会话没有可用模型');
    }
    return {
      isRunning: !session.isIdle || this.activeCompaction !== null,
      activeCompaction: this.activeCompaction ? { ...this.activeCompaction } : null,
      thinkingLevel: session.thinkingLevel,
      availableThinkingLevels: [...session.getAvailableThinkingLevels()],
      model: this.toAvailableModel(model),
      availableModels: this.runtime.services.modelRuntime
        .getAvailableSnapshot()
        .map((availableModel) => this.toAvailableModel(availableModel)),
      modelWarning: this.modelWarning,
    };
  }

  /**
   * 中止 Agent 运行或上下文压缩并等待其稳定。
   *
   * @returns Agent 完全稳定后解决的 Promise
   */
  async abort(): Promise<void> {
    const session = this.runtime.session;
    session.abortCompaction();
    await session.abort();
  }

  /**
   * 设置 Pi 思考等级。
   *
   * @param level - 请求的思考等级
   * @returns 设置后的会话状态
   */
  async setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState> {
    this.assertIdle();
    this.runtime.session.setThinkingLevel(level);
    await this.runtime.services.settingsManager.flush();
    return this.getState();
  }

  /**
   * 设置当前会话模型并向全部客户端广播权威状态。
   *
   * @param reference - 跨 Provider 模型引用
   * @returns 设置后的权威会话状态
   */
  async setModel(reference: ModelReference): Promise<AgentSessionState> {
    this.assertIdle();
    const model = this.runtime.services.modelRuntime
      .getAvailableSnapshot()
      .find((candidate) => candidate.provider === reference.provider && candidate.id === reference.id);
    if (!model) {
      throw new ModelUnavailableError(reference);
    }

    await this.runtime.session.setModel(model);
    await this.runtime.services.settingsManager.flush();
    this.modelWarning = null;
    const state = this.getState();
    this.emit({ type: 'session_model_changed', state });
    return state;
  }

  /**
   * 释放 Pi Runtime 与事件订阅。
   *
   * @returns 资源释放完成后解决的 Promise
   */
  async dispose(): Promise<void> {
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.runtime.setRebindSession(undefined);
    await this.runtime.services.settingsManager.flush();
    await this.runtime.dispose();
  }

  /**
   * 将适配器绑定到 Runtime 当前的 AgentSession。
   *
   * @param session - 新的 Pi AgentSession
   * @returns 无返回值
   */
  private bindSession(session: AgentSession): void {
    this.unsubscribeSession?.();
    this.unsubscribeSession = session.subscribe(this.handleEvent);
  }

  /** @throws Agent 正在运行或压缩 */
  private assertIdle(): void {
    if (!this.runtime.session.isIdle || this.activeCompaction !== null) {
      throw new AgentBusyError();
    }
  }

  /**
   * 将 Pi 模型投影为客户端可展示的可用模型。
   *
   * @param model - Pi 模型对象
   * @returns 跨 Provider 的展示模型
   */
  private toAvailableModel(model: { provider: string; id: string; name: string }): AvailableModel {
    return {
      provider: model.provider,
      providerName:
        this.runtime.services.modelRuntime.getProvider(model.provider)?.name ?? model.provider,
      id: model.id,
      name: model.name,
    };
  }

  /** @param event - 要广播给当前会话全部客户端的事件 */
  private emit(event: AgentStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * 转换并广播 Pi 进程内事件。
   *
   * @param event - Pi 进程内会话事件
   * @returns 无返回值
   */
  private readonly handleEvent = (event: AgentSessionEvent): void => {
    if (event.type === 'compaction_start') {
      this.activeCompaction = { reason: event.reason };
    } else if (event.type === 'compaction_end' || event.type === 'agent_settled') {
      this.activeCompaction = null;
    }

    const jsonEvent = toJsonAgentEvent(event);
    this.emit(jsonEvent);
  };
}
