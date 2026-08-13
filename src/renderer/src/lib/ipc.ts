/**
 * @file 客户端侧协议封装。
 *
 * 渲染进程只依赖本模块与 Hub 通信,业务代码不直接触碰 window.electron。
 * invoke 型调用经协议表类型化:参数与返回值由 HubProtocol 推导。
 */
import {
  HUB_CHANNELS,
  hubChannel,
  type HubEvent,
  type HubInvokeChannel,
  type HubProtocol,
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
  return invoke('configGet', undefined);
}

/**
 * 保存模型配置。
 *
 * @param config - 配置
 */
export function saveConfig(config: ModelConfig): Promise<void> {
  return invoke('configSave', config);
}

/**
 * 测试连接。
 *
 * @param request - 测试请求
 * @returns 测试结果
 */
export function testConnection(request: TestConnectionRequest): Promise<TestConnectionResult> {
  return invoke('configTest', request);
}

/**
 * 列出可选 Provider。
 *
 * @returns Provider 列表
 */
export function listProviders(): Promise<ProviderInfo[]> {
  return invoke('providersList', undefined);
}

/**
 * 列出指定 Provider 的模型。
 *
 * @param providerId - Provider id
 * @returns 模型列表
 */
export function listModels(providerId: string): Promise<ModelInfo[]> {
  return invoke('modelsList', providerId);
}

/**
 * 按协议表发起 invoke 调用。
 *
 * 请求/响应类型由 HubProtocol 推导;仅此一处保留 as 断言(Electron 桥的边界),
 * 各业务函数不再各自断言。
 *
 * @param name - 协议表 key
 * @param request - 请求体
 * @returns 响应
 */
function invoke<K extends HubInvokeChannel>(
  name: K,
  request: HubProtocol[K]['request']
): Promise<HubProtocol[K]['response']> {
  return window.electron.ipcRenderer.invoke(hubChannel(name), request) as Promise<
    HubProtocol[K]['response']
  >;
}
