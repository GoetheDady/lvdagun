/** Provider 访问凭据条目；本地模型等场景 apiKey 可为空 */
export interface ProviderCredential {
  /** Provider id，例如 anthropic、openai、deepseek */
  provider: string;
  /** API Key；本地模型等场景可为空 */
  apiKey: string;
}

/** 模型服务配置（多 Provider 凭据 + 默认模型） */
export interface ModelSettings {
  /** 已配置 Provider 凭据列表，每个 Provider 至多一条 */
  providers: ProviderCredential[];
  /** 默认模型：新会话的初始会话模型与会话模型失效时的回退目标；未指定为 null */
  defaultModel: ModelReference | null;
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

/** 跨 Provider 唯一标识一个模型 */
export interface ModelReference {
  /** Provider id */
  provider: string;
  /** Provider 内的模型 id */
  id: string;
}

/** Agent Hub 当前具有有效凭据的模型 */
export interface AvailableModel extends ModelReference {
  /** Provider 展示名 */
  providerName: string;
  /** 模型展示名 */
  name: string;
}

/** 测试连接结果 */
export type TestConnectionResult = { ok: true } | { ok: false; message: string };
