import type {
  AgentMessage,
} from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type {
  AgentSessionState,
  AgentStreamEvent,
  ModelReference,
  ModelSettings,
  ModelInfo,
  ProviderInfo,
  SessionSnapshotEvent,
  TestConnectionResult,
  ThinkingLevel,
} from '@lvdagun/protocol';

/** Pi 执行条目只在后端历史映射器内部使用。 */
export interface ExecutionMessage {
  entryId: string | null;
  message: AgentMessage;
}

/** 单会话适配器发出的后端事件，不跨越 JSON-RPC 边界。 */
export type AgentSessionAdapterEvent =
  | AgentSessionEvent
  | Extract<
      AgentStreamEvent,
      {
        type:
          | 'session_model_changed'
          | 'pending_messages_changed'
          | 'session_info_changed'
          | 'thinking_level_changed';
      }
    >;

/** Agent 正在运行，当前操作不能与之并发 */
export class AgentBusyError extends Error {
  /**
   * 创建 Agent 忙碌错误。
   */
  constructor() {
    super('Agent 正在运行');
    this.name = 'AgentBusyError';
  }
}

/** 请求的持久化会话不存在 */
export class SessionNotFoundError extends Error {
  readonly status = 404;

  /**
   * 创建会话不存在错误。
   *
   * @param sessionId - 请求的会话标识
   */
  constructor(sessionId: string) {
    super(`会话不存在:${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

/** 请求的会话已经归档，不能通过普通会话接口访问 */
export class SessionArchivedError extends Error {
  readonly status = 410;

  /**
   * 创建会话已归档错误。
   *
   * @param sessionId - 请求的会话标识
   */
  constructor(sessionId: string) {
    super(`会话已归档:${sessionId}`);
    this.name = 'SessionArchivedError';
  }
}

/** 请求的模型当前没有有效凭据或不存在 */
export class ModelUnavailableError extends Error {
  readonly status = 400;

  /**
   * 创建模型不可用错误。
   *
   * @param model - 请求的跨 Provider 模型引用
   */
  constructor(model: ModelReference) {
    super(`模型不可用:${model.provider}/${model.id}`);
    this.name = 'ModelUnavailableError';
  }
}

/** 会话历史已经变化，请求的条目不再适用于当前操作 */
export class SessionEntryConflictError extends Error {
  readonly status = 409;

  /** @param message - 面向用户的冲突说明 */
  constructor(message: string) {
    super(message);
    this.name = 'SessionEntryConflictError';
  }
}

/** Agent Hub 内部使用的单会话适配器接口。 */
export interface AgentSessionAdapter {
  /** Pi 持久化会话的不透明标识 */
  readonly id: string;

  /** 会话创建时间，Unix 毫秒时间戳 */
  readonly createdAt: number;

  /**
   * 接受一条用户提示。
   *
   * @param text - 用户提示文本
   * @returns Pi 完成前置校验并接受提示后解决的 Promise
   * @throws Agent 正在运行或 Pi 前置校验失败
   */
  prompt(text: string): Promise<void>;

  /** @param text - 运行期间提交的用户文本 @returns 无返回值 */
  enqueuePendingMessage(text: string): void;

  /** @param messageId - 待处理消息标识 @returns Pi 接受调整方向后解决的 Promise */
  steerPendingMessage(messageId: string): Promise<void>;

  /** @param messageId - 待处理消息标识 @returns 无返回值 */
  removePendingMessage(messageId: string): void;

  /** @returns 按排队顺序取回的全部待处理文本 */
  takePendingMessages(): string[];

  /**
   * 订阅 Pi JSON 事件和 Hub 会话状态事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: AgentSessionAdapterEvent) => void): () => void;

  /**
   * 读取 Pi 当前会话的全部结构化消息。
   *
   * @returns 消息历史副本
   */
  getExecutionHistory(): ExecutionMessage[];

  /**
   * 编辑当前分支最后一条用户消息并重新开始 Agent 运行。
   *
   * @param entryId - 最后一条用户消息的 Pi 条目标识
   * @param text - 修改后的非空文本
   * @returns 提示被接受后的当前分支历史
   */
  editAndResend(entryId: string, text: string): Promise<void>;

  /**
   * 读取当前 Agent 运行与思考等级状态。
   *
   * @returns 当前会话状态
   */
  getState(): AgentSessionState;

  /**
   * 读取当前会话的历史、流式助手消息和运行状态快照。
   *
   * @returns 建立订阅时的权威会话快照
   */
  getSnapshot(): Omit<SessionSnapshotEvent, 'history'>;

  /**
   * 设置 Pi 持久化会话标题。
   *
   * @param title - 非空会话标题
   * @returns 无返回值
   */
  setSessionName(title: string): void;

  /**
   * 中止当前 Agent 运行或上下文压缩并等待其稳定。
   *
   * @returns Agent 完全稳定后解决的 Promise
   */
  abort(): Promise<string[]>;

  /**
   * 设置 Pi 思考等级。
   *
   * @param level - 请求的思考等级，Pi 会按当前模型能力收窄
   * @returns 设置后的当前会话状态
   */
  setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState>;

  /**
   * 设置当前会话后续 Agent 运行使用的模型。
   *
   * @param model - 跨 Provider 模型引用
   * @returns 设置后的权威会话状态
   * @throws Agent 正在运行或模型当前不可用
   */
  setModel(model: ModelReference): Promise<AgentSessionState>;

  /**
   * 释放 Pi Runtime 与事件订阅。
   *
   * @returns 资源释放完成后解决的 Promise
   */
  dispose(): Promise<void>;
}

/** Hub 从 Pi 会话目录读取的持久化摘要 */
interface StoredSessionSummary {
  id: string;
  name?: string;
  firstMessage: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Agent Hub 内部依赖的持久化与 Pi Runtime 适配器接口。 */
export interface AgentHubAdapter {
  /** @returns 清空切换前遗留的活动与归档 Pi 会话 */
  clearLegacySessions(): Promise<void>;
  /**
   * 列出可配置的模型服务商。
   *
   * @returns Provider 列表
   */
  listProviders(): Promise<ProviderInfo[]>;

  /**
   * 列出指定 Provider 的模型。
   *
   * @param providerId - Provider id
   * @returns 模型列表
   */
  listModels(providerId: string): Promise<ModelInfo[]>;

  /**
   * 测试 Provider 凭证和网络链路;成功时由 Pi 持久化凭证,失败时不修改凭据。
   *
   * @param providerId - Provider id
   * @param apiKey - 待测试的 API Key
   * @param modelId - 待测试的模型 id
   * @returns 连接测试结果
   */
  testConnection(providerId: string, apiKey: string, modelId: string): Promise<TestConnectionResult>;

  /**
   * 列出驴打滚数据目录中的全部持久化会话。
   *
   * @returns 按最后消息时间倒序排列的会话摘要
   */
  listSessions(): Promise<StoredSessionSummary[]>;

  /**
   * 按模型服务配置创建会话。
   *
   * @param settings - 模型服务配置
   * @returns 就绪的 Hub 会话
   * @throws 模型不存在或初始化失败
   */
  createSession(settings: ModelSettings): Promise<AgentSessionAdapter>;

  /**
   * 按不透明标识打开一个已有持久化会话。
   *
   * @param settings - 当前模型服务配置
   * @param sessionId - 会话标识
   * @returns 就绪的 Hub 会话
   * @throws 会话不存在、模型不存在或初始化失败
   */
  openSession(settings: ModelSettings, sessionId: string): Promise<AgentSessionAdapter>;

  /**
   * 从源会话指定助手回复创建独立持久化会话。
   *
   * @param settings - 当前模型服务配置
   * @param sourceSessionId - 源会话标识
   * @param entryId - 要保留到的助手回复条目标识
   * @param title - 派生会话标题
   * @returns 独立的 Hub 会话
   */
  forkSession(
    settings: ModelSettings,
    sourceSessionId: string,
    entryId: string,
    title: string
  ): Promise<AgentSessionAdapter>;

  /**
   * 保留 Pi 会话文件并将会话移出普通会话列表。
   *
   * @param sessionId - 会话标识
   * @returns 会话文件移入归档目录后解决的 Promise
   * @throws 会话已归档、会话不存在或文件移动失败
   */
  archiveSession(sessionId: string): Promise<void>;

  /**
   * 永久删除指定 Pi 会话文件。
   *
   * @param sessionId - 会话标识
   * @returns 会话文件删除后解决的 Promise
   * @throws 会话已归档、会话不存在或文件删除失败
   */
  deleteSession(sessionId: string): Promise<void>;
}
