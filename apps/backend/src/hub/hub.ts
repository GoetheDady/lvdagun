import type {
  ChatMessage,
  HubEvent,
  ModelConfig,
  ModelInfo,
  ProviderInfo,
  TestConnectionResult,
} from '@lvdagun/protocol';

/** Hub 会话：本地服务与 Agent Hub 之间的契约 */
export interface HubSession {
  /**
   * 发送用户消息并处理完整回复。
   *
   * @param text - 用户消息文本
   * @returns 回复处理完成后解决的 Promise
   */
  prompt(text: string): Promise<void>;

  /**
   * 订阅 Hub 事件流。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: HubEvent) => void): () => void;

  /**
   * 读取当前会话的消息历史。
   *
   * @returns 消息历史副本
   */
  getMessages(): ChatMessage[];

  /**
   * 释放会话资源。
   *
   * @returns 无返回值
   */
  dispose(): void;
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
