import { randomUUID } from 'node:crypto';

import type { AgentEndEvent, AgentSession } from '@earendil-works/pi-coding-agent';
import type { PendingMessage } from '@lvdagun/protocol';

/** 控制器调用的最小 Pi 队列接口 */
export type PendingMessageSession = Pick<
  AgentSession,
  'abort' | 'abortCompaction' | 'clearQueue' | 'followUp' | 'steer'
>;

/** 待处理消息不存在 */
export class PendingMessageNotFoundError extends Error {
  readonly status = 404;

  /** @param messageId - 未找到的消息标识 */
  constructor(messageId: string) {
    super(`待处理消息不存在:${messageId}`);
    this.name = 'PendingMessageNotFoundError';
  }
}

/** 驴打滚待处理消息的 Runtime 内权威控制器 */
export class PendingMessageController {
  private readonly messages: PendingMessage[] = [];
  private readonly listeners = new Set<(messages: PendingMessage[]) => void>();
  private session: PendingMessageSession | null = null;
  private dispatchSuppressed = false;

  /** @param createId - 生成 Runtime 内稳定消息标识的方法 */
  constructor(private readonly createId: () => string = randomUUID) {}

  /** @param session - Runtime 当前 AgentSession */
  bindSession(session: PendingMessageSession): void {
    this.session = session;
  }

  /** @param listener - 权威快照监听器 @returns 退订函数 */
  subscribe(listener: (messages: PendingMessage[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @returns 待处理消息的防御性副本 */
  getSnapshot(): PendingMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  /** @param text - 用户消息 @returns 无返回值 */
  enqueue(text: string): void {
    const message = { id: this.createId(), text };
    this.messages.push(message);
    this.emit();
  }

  /**
   * 将指定消息交给 Pi 调整当前方向。
   *
   * @param messageId - 待处理消息标识
   * @returns Pi 接受消息后解决的 Promise
   */
  async steer(messageId: string): Promise<void> {
    await this.transfer(messageId, (session, text) => session.steer(text));
  }

  /** @param messageId - 待处理消息标识 @returns 无返回值 */
  remove(messageId: string): void {
    const index = this.findIndex(messageId);
    this.messages.splice(index, 1);
    this.emit();
  }

  /** @returns 按排队顺序取回的全部文本 */
  takeAll(): string[] {
    const texts = this.messages.map((message) => message.text);
    if (texts.length > 0) {
      this.messages.splice(0);
      this.emit();
    }
    return texts;
  }

  /**
   * 成功运行自然结束时，把下一条消息交给 Pi 的后续队列。
   *
   * @param event - Pi Extension 的 Agent 结束事件
   * @returns 移交完成后的 Promise
   */
  async handleAgentEnd(event: AgentEndEvent): Promise<void> {
    if (
      this.dispatchSuppressed ||
      this.messages.length === 0 ||
      !event.messages.some(
        (message) => message.role === 'assistant' && message.stopReason === 'stop'
      )
    ) {
      return;
    }
    await this.transfer(this.messages[0]!.id, (session, text) => session.followUp(text));
  }

  /**
   * 停止当前运行并返回所有尚未处理的文本。
   *
   * @returns Pi 临时队列和待处理区中的文本
   */
  async abortAndTakeAll(): Promise<string[]> {
    const session = this.getSession();
    this.dispatchSuppressed = true;
    const pending = this.takeAll();
    let restoredTexts = pending;
    try {
      const queued = session.clearQueue();
      restoredTexts = [...queued.steering, ...queued.followUp, ...pending];
      session.abortCompaction();
      await session.abort();
      return restoredTexts;
    } catch (error) {
      for (const text of restoredTexts) this.enqueue(text);
      throw error;
    } finally {
      this.dispatchSuppressed = false;
    }
  }

  /** @param messageId - 消息标识 @returns 消息下标 */
  private findIndex(messageId: string): number {
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new PendingMessageNotFoundError(messageId);
    return index;
  }

  /** @returns 已绑定的 Pi 会话 */
  private getSession(): PendingMessageSession {
    if (!this.session) throw new Error('待处理消息控制器尚未绑定 Pi 会话');
    return this.session;
  }

  /**
   * 先按稳定 ID 原子移除，再移交给 Pi；失败时恢复原位置。
   *
   * @param messageId - 待处理消息标识
   * @param deliver - Pi 移交操作
   * @returns 移交完成后的 Promise
   */
  private async transfer(
    messageId: string,
    deliver: (session: PendingMessageSession, text: string) => Promise<void>
  ): Promise<void> {
    const index = this.findIndex(messageId);
    const [message] = this.messages.splice(index, 1);
    this.emit();
    try {
      await deliver(this.getSession(), message!.text);
    } catch (error) {
      this.messages.splice(index, 0, message!);
      this.emit();
      throw error;
    }
  }

  /** @returns 无返回值 */
  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
