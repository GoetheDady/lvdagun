/**
 * @file 客户端 ↔ 本地服务通信协议。
 *
 * 类型的单一事实来源:backend 包定义并导出,web 以 type-only 方式 import。
 * 传输层是 HTTP + SSE,语义与领域术语一一对应(见 CONTEXT.md)。
 */

/** 模型配置(存于 ~/.lvdagun/config.json,决定 Hub 使用哪个模型对话) */
export interface ModelConfig {
  /** provider id,如 anthropic / openai / deepseek */
  provider: string;
  /** API Key;本地模型等场景可为空 */
  apiKey: string;
  /** 模型 id */
  modelId: string;
}

/** 向导第一步展示的 Provider 条目 */
export interface ProviderInfo {
  /** provider id(写入配置的值) */
  id: string;
  /** 展示名 */
  name: string;
}

/** 向导第三步展示的模型条目 */
export interface ModelInfo {
  /** 模型 id(写入配置的值) */
  id: string;
  /** 展示名 */
  name: string;
}

/** 测试连接结果 */
export type TestConnectionResult = { ok: true } | { ok: false; message: string };

/** 对话消息 */
export interface ChatMessage {
  /** 消息唯一 id(在边界处生成,Pi 消息无 id) */
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Hub 推送给客户端的事件(SSE 流)。
 *
 * 语义与 Pi 会话事件对应,但不暴露 Pi 内部类型——
 * 客户端只依赖本协议,不感知 Pi 的存在。
 */
export type HubEvent =
  /** 用户消息已被 Hub 接收 */
  | { type: 'user_message'; message: ChatMessage }
  /** AI 开始输出一条新消息 */
  | { type: 'assistant_message_start'; messageId: string }
  /** AI 文本增量(流式输出) */
  | { type: 'assistant_text_delta'; messageId: string; delta: string }
  /** AI 消息输出完成 */
  | { type: 'assistant_message_end'; message: ChatMessage }
  /** 会话已清空(客户端应清空消息列表) */
  | { type: 'session_cleared' }
  /** 对话错误,retryable 为 true 时客户端可提供重试入口 */
  | { type: 'error'; message: string; retryable: boolean };
