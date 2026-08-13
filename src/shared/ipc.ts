/**
 * @file 客户端 ↔ Hub 通信协议。
 *
 * 单一事实来源:主进程(Hub)与渲染进程(客户端)共享本文件的类型与通道名。
 * V0 走 Electron IPC;V2 换网络传输时,本协议语义保持不变,只换传输层。
 */

/** 消息型通道名(发送/推送,无请求响应配对;渲染进程 ↔ 主进程) */
export const HUB_CHANNELS = {
  /** 渲染 → 主:发送一条用户消息 */
  prompt: 'hub:prompt',
  /** 渲染 → 主:中止当前生成 */
  abort: 'hub:abort',
  /** 主 → 渲染:Hub 事件流 */
  events: 'hub:events',
} as const;

/**
 * Hub 协议表:invoke 型通道的单一事实来源。
 *
 * key = 通道逻辑名,通道字符串由 hubChannel() 自动派生(configGet → hub:config:get);
 * request / response 是该通道的收发类型,主进程注册与渲染端调用都从这里拿类型。
 * V2 换网络传输时,这张表就是协议的定义,两端实现重写即可。
 */
export interface HubProtocol {
  /** 读取模型配置(返回 ModelConfig 或 null) */
  configGet: { request: void; response: ModelConfig | null };
  /** 保存模型配置 */
  configSave: { request: ModelConfig; response: void };
  /** 测试连接 */
  configTest: { request: TestConnectionRequest; response: TestConnectionResult };
  /** 列出可选 Provider */
  providersList: { request: void; response: ProviderInfo[] };
  /** 列出指定 Provider 的模型 */
  modelsList: { request: string; response: ModelInfo[] };
}

/** 协议表中的通道名 */
export type HubInvokeChannel = keyof HubProtocol;

/**
 * 派生通道字符串:configGet → hub:config:get。
 *
 * @param name - 协议表 key
 * @returns IPC 通道字符串
 */
export function hubChannel(name: HubInvokeChannel): string {
  return `hub:${name.replace(/[A-Z]/g, (char) => `:${char.toLowerCase()}`)}`;
}

/** 用户发送消息的请求体 */
export interface PromptRequest {
  /** 消息文本 */
  text: string;
}

/** 对话消息(渲染进程渲染与历史恢复所需的最小结构) */
export interface ChatMessage {
  /** 消息唯一 id(边界处生成,Pi 消息无 id) */
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Hub 推送给客户端的事件。
 *
 * 语义与 Pi 会话事件一一对应,但不暴露 Pi 内部类型——
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
  /** 对话错误,retryable 为 true 时客户端可提供重试入口 */
  | { type: 'error'; message: string; retryable: boolean };

/** 模型配置(存于 ~/.lvdagun/config.json,决定 Hub 使用哪个模型对话) */
export interface ModelConfig {
  /** provider id,如 anthropic / openai / deepseek */
  provider: string;
  /** API Key;本地模型等场景可为空 */
  apiKey: string;
  /** 模型 id,如 claude-sonnet-4-6 */
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

/** 测试连接请求(向导第二步) */
export interface TestConnectionRequest {
  provider: string;
  apiKey: string;
}

/** 测试连接结果 */
export type TestConnectionResult = { ok: true } | { ok: false; message: string };
