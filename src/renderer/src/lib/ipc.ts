/**
 * @file 客户端侧协议封装。
 *
 * 渲染进程只依赖本模块与 Hub 通信,业务代码不直接触碰 window.electron。
 * 组件层通过 hooks(后续实现)消费事件流。
 */
import {
  HUB_CHANNELS,
  type HubEvent,
  type ModelConfig,
  type ModelInfo,
  type PromptRequest,
  type ProviderInfo,
  type TestConnectionRequest,
  type TestConnectionResult,
} from '../../../shared/ipc';

/**
 * 发送用户消息。
 *
 * @param request - 消息请求
 */
export function prompt(request: PromptRequest): void {
  window.electron.ipcRenderer.send(HUB_CHANNELS.prompt, request);
}

/** 中止当前生成 */
export function abort(): void {
  window.electron.ipcRenderer.send(HUB_CHANNELS.abort);
}

/**
 * 订阅 Hub 事件流。
 *
 * @param listener - 事件回调
 * @returns 退订函数
 */
export function subscribeHubEvents(listener: (event: HubEvent) => void): () => void {
  const handler = (_: unknown, event: HubEvent): void => listener(event);
  window.electron.ipcRenderer.on(HUB_CHANNELS.events, handler);
  return () => {
    window.electron.ipcRenderer.removeListener(HUB_CHANNELS.events, handler);
  };
}

/**
 * 读取模型配置。
 *
 * @returns 配置;未配置或损坏为 null
 */
export function getConfig(): Promise<ModelConfig | null> {
  return window.electron.ipcRenderer.invoke(HUB_CHANNELS.configGet) as Promise<ModelConfig | null>;
}

/**
 * 保存模型配置。
 *
 * @param config - 配置
 */
export function saveConfig(config: ModelConfig): Promise<void> {
  return window.electron.ipcRenderer.invoke(HUB_CHANNELS.configSave, config) as Promise<void>;
}

/**
 * 测试连接。
 *
 * @param request - 测试请求
 * @returns 测试结果
 */
export function testConnection(request: TestConnectionRequest): Promise<TestConnectionResult> {
  return window.electron.ipcRenderer.invoke(
    HUB_CHANNELS.configTest,
    request
  ) as Promise<TestConnectionResult>;
}

/**
 * 列出可选 Provider。
 *
 * @returns Provider 列表
 */
export function listProviders(): Promise<ProviderInfo[]> {
  return window.electron.ipcRenderer.invoke(HUB_CHANNELS.providersList) as Promise<ProviderInfo[]>;
}

/**
 * 列出指定 Provider 的模型。
 *
 * @param providerId - Provider id
 * @returns 模型列表
 */
export function listModels(providerId: string): Promise<ModelInfo[]> {
  return window.electron.ipcRenderer.invoke(HUB_CHANNELS.modelsList, providerId) as Promise<
    ModelInfo[]
  >;
}
