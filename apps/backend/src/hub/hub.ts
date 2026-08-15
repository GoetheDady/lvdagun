import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  ModelConfig,
  ModelInfo,
  ProviderInfo,
  TestConnectionResult,
  ThinkingLevel,
} from '@lvdagun/protocol';

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

/** 本地服务与 Pi Agent 会话之间的能力契约 */
export interface HubSession {
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

  /**
   * 订阅 Pi JSON 会话事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: AgentStreamEvent) => void): () => void;

  /**
   * 读取 Pi 当前会话的全部结构化消息。
   *
   * @returns 消息历史副本
   */
  getMessages(): ChatMessage[];

  /**
   * 读取当前 Agent 运行与思考等级状态。
   *
   * @returns 当前会话状态
   */
  getState(): AgentSessionState;

  /**
   * 中止当前 Agent 运行并等待其稳定。
   *
   * @returns Agent 完全稳定后解决的 Promise
   */
  abort(): Promise<void>;

  /**
   * 设置 Pi 思考等级。
   *
   * @param level - 请求的思考等级，Pi 会按当前模型能力收窄
   * @returns 设置后的当前会话状态
   */
  setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState>;

  /**
   * 释放 Pi Runtime 与事件订阅。
   *
   * @returns 资源释放完成后解决的 Promise
   */
  dispose(): Promise<void>;
}

/** Hub 从 Pi 会话目录读取的持久化摘要 */
export interface StoredSessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Agent Hub 对本地服务提供的能力 */
export interface Hub {
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
   * 测试 Provider 凭证和网络链路。
   *
   * @param providerId - Provider id
   * @param apiKey - 待测试的 API Key
   * @returns 连接测试结果
   */
  testConnection(providerId: string, apiKey: string): Promise<TestConnectionResult>;

  /**
   * 列出驴打滚数据目录中的全部持久化会话。
   *
   * @returns 按最后消息时间倒序排列的会话摘要
   */
  listSessions(): Promise<StoredSessionSummary[]>;

  /**
   * 按模型配置创建会话。
   *
   * @param config - 模型配置
   * @returns 就绪的 Hub 会话
   * @throws 模型不存在或初始化失败
   */
  createSession(config: ModelConfig): Promise<HubSession>;

  /**
   * 按不透明标识打开一个已有持久化会话。
   *
   * @param config - 当前全局模型配置
   * @param sessionId - 会话标识
   * @returns 就绪的 Hub 会话
   * @throws 会话不存在、模型不存在或初始化失败
   */
  openSession(config: ModelConfig, sessionId: string): Promise<HubSession>;
}
