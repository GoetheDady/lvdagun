import { randomUUID } from 'node:crypto';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, HubEvent } from '@lvdagun/protocol';

import type { HubSession } from './hub';

/** 将 Pi 会话事件翻译为共享协议事件的 HubSession 实现 */
export class PiHubSession implements HubSession {
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private history: ChatMessage[] = [];
  private streaming: { messageId: string; text: string } | null = null;
  private readonly unsubscribe: () => void;

  /**
   * 创建 Pi 会话适配器。
   *
   * @param session - Pi Agent 会话
   */
  constructor(private readonly session: AgentSession) {
    this.unsubscribe = session.subscribe(this.handleEvent);
  }

  /**
   * 发送用户消息并转发 Pi 产生的事件。
   *
   * @param text - 用户消息文本
   * @returns 回复处理完成后解决的 Promise
   */
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

  /**
   * 订阅共享协议事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 读取当前消息历史。
   *
   * @returns 消息历史副本
   */
  getMessages(): ChatMessage[] {
    return [...this.history];
  }

  /**
   * 退订事件并释放 Pi 会话。
   *
   * @returns 无返回值
   */
  dispose(): void {
    this.unsubscribe();
    this.session.dispose();
  }

  /**
   * 向全部订阅者发送共享协议事件。
   *
   * @param event - 要发送的事件
   * @returns 无返回值
   */
  private emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** 将 Pi 事件翻译为共享协议事件 */
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
