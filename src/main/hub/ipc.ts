/**
 * @file Hub 的 IPC 接线:把协议通道接到 Hub 能力上。
 *
 * 渲染进程经 preload invoke 这些通道;主进程侧在这里统一注册。
 */
import { ipcMain } from 'electron';

import { HUB_CHANNELS, type ModelConfig, type TestConnectionRequest } from '../../shared/ipc';
import type { ConfigStore } from './config';
import { listModels, listProviders, testConnection } from './models';

/**
 * 注册 Hub 相关的 IPC 通道(启动时调用一次)。
 *
 * @param configStore - 配置存取实现
 */
export function registerHubIpc(configStore: ConfigStore): void {
  ipcMain.handle(HUB_CHANNELS.configGet, () => configStore.load());

  ipcMain.handle(HUB_CHANNELS.configSave, (_event, config: ModelConfig) =>
    configStore.save(config)
  );

  ipcMain.handle(HUB_CHANNELS.configTest, (_event, request: TestConnectionRequest) =>
    testConnection(request.provider, request.apiKey)
  );

  ipcMain.handle(HUB_CHANNELS.providersList, () => listProviders());

  ipcMain.handle(HUB_CHANNELS.modelsList, (_event, providerId: string) => listModels(providerId));
}
