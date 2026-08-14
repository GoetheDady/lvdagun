/** 模型配置（存于 ~/.lvdagun/config.json，决定 Hub 使用哪个模型对话） */
export interface ModelConfig {
  /** Provider id，例如 anthropic、openai、deepseek */
  provider: string;
  /** API Key；本地模型等场景可为空 */
  apiKey: string;
  /** 模型 id */
  modelId: string;
}

/** 配置向导展示的 Provider 条目 */
export interface ProviderInfo {
  /** Provider id（写入配置的值） */
  id: string;
  /** 展示名 */
  name: string;
}

/** 配置向导展示的模型条目 */
export interface ModelInfo {
  /** 模型 id（写入配置的值） */
  id: string;
  /** 展示名 */
  name: string;
}

/** 测试连接结果 */
export type TestConnectionResult = { ok: true } | { ok: false; message: string };
