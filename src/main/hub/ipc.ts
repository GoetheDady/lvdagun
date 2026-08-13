/**
 * @file Hub 的 IPC 接线:把协议表里的通道接到 Hub 能力上。
 *
 * 渲染进程经 preload invoke 这些通道;主进程侧在这里统一注册。
 * 每个通道的收发类型来自协议表,handler 参数与返回值自动类型化,无需手写断言。
 */
import { ipcMain } from 'electron';

import { hubChannel, type HubInvokeChannel, type HubProtocol } from '../../shared/ipc';
import type { ConfigStore } from './config';
import { listModels, listProviders, testConnection } from './models';

/**
 * 注册 Hub 相关的 IPC 通道(启动时调用一次)。
 *
 * @param configStore - 配置存取实现
 */
export function registerHubIpc(configStore: ConfigStore): void {
  registerInvoke('configGet', () => configStore.load());
  registerInvoke('configSave', (config) => configStore.save(config));
  registerInvoke('configTest', (request) => testConnection(request.provider, request.apiKey));
  registerInvoke('providersList', () => listProviders());
  registerInvoke('modelsList', (providerId) => listModels(providerId));
}

/**
 * 按协议表类型注册一个 invoke 通道。
 *
 * @param name - 协议表 key(通道字符串由 hubChannel 派生)
 * @param handler - 处理函数,参数与返回值类型由协议表约束
 */
function registerInvoke<K extends HubInvokeChannel>(
  name: K,
  handler: (
    request: HubProtocol[K]['request']
  ) => HubProtocol[K]['response'] | Promise<HubProtocol[K]['response']>
): void {
  ipcMain.handle(hubChannel(name), (_event, request: HubProtocol[K]['request']) =>
    handler(request)
  );
}
