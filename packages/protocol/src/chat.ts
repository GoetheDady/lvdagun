/** 对话消息 */
export interface ChatMessage {
  /** 消息唯一 id（在边界处生成，Pi 消息无 id） */
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Hub 推送给客户端的事件（SSE 流）。
 *
 * 事件语义与 Pi 会话事件对应，但不暴露 Pi 内部类型。
 */
export type HubEvent =
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'assistant_message_start'; messageId: string }
  | { type: 'assistant_text_delta'; messageId: string; delta: string }
  | { type: 'assistant_message_end'; message: ChatMessage }
  | { type: 'session_cleared' }
  | { type: 'error'; message: string; retryable: boolean };
