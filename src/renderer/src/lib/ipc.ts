/**
 * @file 客户端侧协议封装。
 *
 * 渲染进程只依赖本模块与 Hub 通信,业务代码不直接触碰 window.electron。
 * 组件层通过 hooks(后续实现)消费事件流。
 */
import { HUB_CHANNELS, type HubEvent, type PromptRequest } from '../../../shared/ipc';

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
