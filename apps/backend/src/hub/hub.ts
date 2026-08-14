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

/** 本地服务与 Pi Agent 会话之间的能力契约 */
export interface HubSession {
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
   * 在 Agent 空闲时创建 Pi 新会话。
   *
   * @returns 新会话完成绑定后解决的 Promise
   * @throws Agent 正在运行
   */
  newSession(): Promise<void>;

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
   * 按模型配置创建会话。
   *
   * @param config - 模型配置
   * @returns 就绪的 Hub 会话
   * @throws 模型不存在或初始化失败
   */
  createSession(config: ModelConfig): Promise<HubSession>;
}
