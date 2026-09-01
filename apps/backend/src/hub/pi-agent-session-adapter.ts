import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
} from '@earendil-works/pi-coding-agent';
import { sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';

import { readPiUserText } from '../history/pi-history-event-mapper';
import type {
  ActiveCompaction,
  AgentSessionState,
  AvailableModel,
  ModelReference,
  SessionSnapshotEvent,
  ThinkingLevel,
} from '@lvdagun/protocol';

import type { PendingMessageExtension } from '../extensions/pending-messages/pending-message-extension';
import {
  AgentBusyError,
  ModelUnavailableError,
  SessionEntryConflictError,
  type AgentSessionAdapter,
  type AgentSessionAdapterEvent,
  type ExecutionMessage,
} from './agent-hub-adapter';

/** 使用 Pi AgentSessionRuntime 的 Hub 会话实现 */
export class PiAgentSessionAdapter implements AgentSessionAdapter {
  readonly id: string;
  readonly createdAt: number;
  private readonly listeners = new Set<(event: AgentSessionAdapterEvent) => void>();
  private activeCompaction: ActiveCompaction | null = null;
  private modelWarning: string | null;
  private unsubscribeSession: (() => void) | null = null;
  private unsubscribePendingMessages: (() => void) | null = null;

  /**
   * 创建 Pi Runtime 会话适配器并绑定当前会话事件。
   *
   * @param runtime - 可替换当前 AgentSession 的 Pi Runtime
   * @param modelWarning - 恢复会话模型失败时的非阻塞警告
   */
  constructor(
    private readonly runtime: AgentSessionRuntime,
    private readonly pendingMessages: PendingMessageExtension,
    modelWarning: string | null = null
  ) {
    this.modelWarning = modelWarning;
    this.id = runtime.session.sessionId;
    this.createdAt = Date.now();
    this.bindSession(runtime.session);
    this.unsubscribePendingMessages = pendingMessages.subscribe((messages) => {
      this.emit({ type: 'pending_messages_changed', pendingMessages: messages });
    });
    runtime.setRebindSession(async (session) => {
      this.bindSession(session);
    });
  }

  /** @param text - 用户消息 @returns 无返回值 */
  enqueuePendingMessage(text: string): void {
    this.pendingMessages.enqueue(text);
  }

  /** @param messageId - 待处理消息标识 @returns Pi 接受后解决的 Promise */
  async steerPendingMessage(messageId: string): Promise<void> {
    await this.pendingMessages.steer(messageId);
  }

  /** @param messageId - 待处理消息标识 @returns 无返回值 */
  removePendingMessage(messageId: string): void {
    this.pendingMessages.remove(messageId);
  }

  /** @returns 按排队顺序取回的全部文本 */
  takePendingMessages(): string[] {
    return this.pendingMessages.takeAll();
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
  subscribe(listener: (event: AgentSessionAdapterEvent) => void): () => void {
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
  getExecutionHistory(): ExecutionMessage[] {
    return this.runtime.session.sessionManager
      .getBranch()
      .flatMap((entry) =>
        sessionEntryToContextMessages(entry).map((message) => ({ entryId: entry.id, message }))
      );
  }

  /**
   * 在当前分支最后一条用户消息之前建立新分支并发送修改后的文本。
   *
   * 目标校验用文本而非 pi_entry 引用：分叉会话重启后 toolCallId 映射丢失，
   * 引用可能缺失，但产品消息原文与 Pi 分支末尾的用户消息始终一致。
   *
   * @param expectedText - 被编辑消息的原文，必须与当前分支最后一条用户消息一致
   * @param text - 修改后的文本
   * @returns 无返回值
   */
  async editAndResend(expectedText: string, text: string): Promise<void> {
    this.assertIdle();
    const session = this.runtime.session;
    const branch = session.sessionManager.getBranch();
    const targetEntry = [...branch]
      .reverse()
      .find((entry) => entry.type === 'message' && entry.message.role === 'user');
    if (
      targetEntry?.type !== 'message' ||
      readPiUserText(targetEntry.message) !== expectedText
    ) {
      throw new SessionEntryConflictError('只能编辑当前分支最后一条用户消息');
    }

    const oldLeafId = session.sessionManager.getLeafId();
    if (oldLeafId === targetEntry.id) {
      if (targetEntry.parentId === null) {
        session.sessionManager.resetLeaf();
      } else {
        session.sessionManager.branch(targetEntry.parentId);
      }
      session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
    } else {
      await session.navigateTree(targetEntry.id);
    }
    try {
      await this.prompt(text);
    } catch (error) {
      if (oldLeafId === null) {
        session.sessionManager.resetLeaf();
      } else {
        session.sessionManager.branch(oldLeafId);
      }
      session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
      throw error;
    }

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
      sessionName: session.sessionName ?? null,
      executionAvailable: true,
      isRunning: !session.isIdle || this.activeCompaction !== null,
      activeCompaction: this.activeCompaction ? { ...this.activeCompaction } : null,
      pendingMessages: this.pendingMessages.getSnapshot(),
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
   * 读取当前会话的历史、流式助手消息和运行状态快照。
   *
   * @returns 当前 Pi Runtime 的权威展示快照
   */
  getSnapshot(): Omit<SessionSnapshotEvent, 'history'> {
    return {
      type: 'session_snapshot',
      state: this.getState(),
    };
  }

  /**
   * 设置 Pi 原生会话标题并由 Pi 广播标题变化事件。
   *
   * @param title - 非空会话标题
   * @returns 无返回值
   */
  setSessionName(title: string): void {
    this.runtime.session.setSessionName(title);
  }

  /**
   * 中止 Agent 运行或上下文压缩并等待其稳定。
   *
   * @returns Agent 完全稳定后解决的 Promise
   */
  async abort(): Promise<string[]> {
    return this.pendingMessages.abortAndTakeAll();
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
      .find(
        (candidate) => candidate.provider === reference.provider && candidate.id === reference.id
      );
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
    this.unsubscribePendingMessages?.();
    this.unsubscribePendingMessages = null;
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
    this.pendingMessages.bindSession(session);
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
  private emit(event: AgentSessionAdapterEvent): void {
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

    this.emit(event);
  };
}
