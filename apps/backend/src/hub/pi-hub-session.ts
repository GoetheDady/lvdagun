import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
} from '@earendil-works/pi-coding-agent';
import { sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { AgentBusyError, type HubSession } from './hub';
import { toJsonAgentEvent } from './pi-json-event';

/** 使用 Pi AgentSessionRuntime 的 Hub 会话实现 */
export class PiHubSession implements HubSession {
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private unsubscribeSession: (() => void) | null = null;

  /**
   * 创建 Pi Runtime 会话适配器并绑定当前会话事件。
   *
   * @param runtime - 可替换当前 AgentSession 的 Pi Runtime
   */
  constructor(private readonly runtime: AgentSessionRuntime) {
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
    return {
      isRunning: !session.isIdle,
      thinkingLevel: session.thinkingLevel,
      availableThinkingLevels: [...session.getAvailableThinkingLevels()],
    };
  }

  /**
   * 在 Agent 空闲时创建 Pi 新会话。
   *
   * @returns 新会话完成绑定后解决的 Promise
   * @throws Agent 正在运行
   */
  async newSession(): Promise<void> {
    if (!this.runtime.session.isIdle) {
      throw new AgentBusyError();
    }
    await this.runtime.newSession();
  }

  /**
   * 中止 Agent 运行并等待其稳定。
   *
   * @returns Agent 完全稳定后解决的 Promise
   */
  async abort(): Promise<void> {
    await this.runtime.session.abort();
  }

  /**
   * 设置 Pi 思考等级。
   *
   * @param level - 请求的思考等级
   * @returns 设置后的会话状态
   */
  async setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState> {
    this.runtime.session.setThinkingLevel(level);
    await this.runtime.services.settingsManager.flush();
    return this.getState();
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

  /**
   * 转换并广播 Pi 进程内事件。
   *
   * @param event - Pi 进程内会话事件
   * @returns 无返回值
   */
  private readonly handleEvent = (event: AgentSessionEvent): void => {
    const jsonEvent = toJsonAgentEvent(event);
    for (const listener of this.listeners) {
      listener(jsonEvent);
    }
  };
}
