import { randomUUID } from 'node:crypto';

import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { PendingMessage } from '@lvdagun/protocol';

type PendingMessageSession = Pick<
  AgentSession,
  'abort' | 'abortCompaction' | 'clearQueue' | 'followUp' | 'isIdle' | 'steer'
>;

/** Agent 已经停止，待处理消息不能再调整当前方向。 */
export class AgentNotRunningError extends Error {
  readonly status = 409;

  /** 创建 Agent 未运行错误。 */
  constructor() {
    super('Agent 已停止，消息仍在待处理区');
    this.name = 'AgentNotRunningError';
  }
}

/** 待处理消息不存在。 */
export class PendingMessageNotFoundError extends Error {
  readonly status = 404;

  /** @param messageId - 未找到的消息标识 */
  constructor(messageId: string) {
    super(`待处理消息不存在:${messageId}`);
    this.name = 'PendingMessageNotFoundError';
  }
}

/** 待处理消息内置 Extension 及其产品操作。 */
export interface PendingMessageExtension {
  /** 供 Pi ResourceLoader 显式加载的隐藏 Extension。 */
  readonly extension: { name: string; hidden: true; factory: ExtensionFactory };

  /** @param session - Runtime 当前 AgentSession @returns 无返回值 */
  bindSession(session: PendingMessageSession): void;

  /** @param listener - 权威快照监听器 @returns 退订函数 */
  subscribe(listener: (messages: PendingMessage[]) => void): () => void;

  /** @returns 待处理消息的防御性副本 */
  getSnapshot(): PendingMessage[];

  /** @param text - 用户消息 @returns 无返回值 */
  enqueue(text: string): void;

  /** @param messageId - 待处理消息标识 @returns Pi 接受后解决的 Promise */
  steer(messageId: string): Promise<void>;

  /** @param messageId - 待处理消息标识 @returns 无返回值 */
  remove(messageId: string): void;

  /** @returns 按排队顺序取回的全部文本 */
  takeAll(): string[];

  /** @returns 停止 Agent 后可恢复到输入区的全部文本 */
  abortAndTakeAll(): Promise<string[]>;
}

/**
 * 创建待处理消息内置 Extension。
 *
 * @param options - 创建选项
 * @param options.createId - 测试可注入的稳定消息标识生成器
 * @returns 同时供 Pi 和会话适配器使用的待处理消息 module
 */
export function createPendingMessageExtension(
  options: { createId?: () => string } = {}
): PendingMessageExtension {
  const createId = options.createId ?? randomUUID;
  const messages: PendingMessage[] = [];
  const listeners = new Set<(messages: PendingMessage[]) => void>();
  let session: PendingMessageSession | null = null;
  let dispatchSuppressed = false;

  /** @returns 当前绑定的 Pi 会话 */
  const getSession = (): PendingMessageSession => {
    if (!session) throw new Error('待处理消息 Extension 尚未绑定 Pi 会话');
    return session;
  };

  /** @returns 待处理消息的防御性副本 */
  const getSnapshot = (): PendingMessage[] => messages.map((message) => ({ ...message }));

  /** @returns 无返回值 */
  const emit = (): void => {
    const snapshot = getSnapshot();
    for (const listener of listeners) listener(snapshot);
  };

  /** @param messageId - 消息标识 @returns 消息下标 */
  const findIndex = (messageId: string): number => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new PendingMessageNotFoundError(messageId);
    return index;
  };

  /**
   * 先按稳定 ID 原子移除，再移交给 Pi；失败时恢复原位置。
   *
   * @param messageId - 消息标识
   * @param deliver - Pi 移交操作
   * @returns 移交完成后的 Promise
   */
  const transfer = async (
    messageId: string,
    deliver: (boundSession: PendingMessageSession, text: string) => Promise<void>
  ): Promise<void> => {
    const index = findIndex(messageId);
    const [message] = messages.splice(index, 1);
    emit();
    try {
      await deliver(getSession(), message!.text);
    } catch (error) {
      messages.splice(index, 0, message!);
      emit();
      throw error;
    }
  };

  /** @returns 按排队顺序取回的全部文本 */
  const takeAll = (): string[] => {
    const texts = messages.map((message) => message.text);
    if (texts.length > 0) {
      messages.splice(0);
      emit();
    }
    return texts;
  };

  const extension: PendingMessageExtension['extension'] = {
    name: 'lvdagun-pending-messages',
    hidden: true,
    factory: (pi) => {
      pi.on('agent_end', async (event) => {
        if (
          dispatchSuppressed ||
          messages.length === 0 ||
          !event.messages.some(
            (message) => message.role === 'assistant' && message.stopReason === 'stop'
          )
        ) {
          return;
        }
        await transfer(messages[0]!.id, (boundSession, text) => boundSession.followUp(text));
      });

      pi.on('session_shutdown', () => {
        session = null;
      });
    },
  };

  return {
    extension,
    bindSession(nextSession) {
      session = nextSession;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    enqueue(text) {
      messages.push({ id: createId(), text });
      emit();
    },
    async steer(messageId) {
      if (getSession().isIdle) throw new AgentNotRunningError();
      await transfer(messageId, (boundSession, text) => boundSession.steer(text));
    },
    remove(messageId) {
      messages.splice(findIndex(messageId), 1);
      emit();
    },
    takeAll,
    async abortAndTakeAll() {
      const boundSession = getSession();
      dispatchSuppressed = true;
      const pending = takeAll();
      let restoredTexts = pending;
      try {
        const queued = boundSession.clearQueue();
        restoredTexts = [...queued.steering, ...queued.followUp, ...pending];
        boundSession.abortCompaction();
        await boundSession.abort();
        return restoredTexts;
      } catch (error) {
        for (const text of restoredTexts) {
          messages.push({ id: createId(), text });
          emit();
        }
        throw error;
      } finally {
        dispatchSuppressed = false;
      }
    },
  };
}
