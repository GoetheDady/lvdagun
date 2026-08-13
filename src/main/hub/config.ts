/**
 * @file Hub 配置:模型与凭证。
 *
 * 存储位置:应用数据目录(本机文件),API Key 仅存本机,不出网之外。
 */
export interface ModelConfig {
  /** provider id,如 anthropic / openai / deepseek / ollama */
  provider: string;
  /** API Key;Ollama 等本地模型可为空 */
  apiKey: string;
  /** 模型 id,如 claude-sonnet-4-6 */
  modelId: string;
}

/** 配置存取契约;具体实现(本机 JSON 文件)后续接入 */
export interface ConfigStore {
  /** 读取配置;未配置返回 null */
  load(): Promise<ModelConfig | null>;

  /** 写入配置(覆盖) */
  save(config: ModelConfig): Promise<void>;
}
