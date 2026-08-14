import { API_PATHS, TOKEN_HEADER, type HubEvent } from '@lvdagun/protocol';

import { getToken } from './access-token';

/**
 * 订阅 Agent Hub 的 SSE 事件流。
 *
 * @param onEvent - 事件回调
 * @param onError - 连接错误回调
 * @returns 退订函数
 */
export function subscribeEvents(
  onEvent: (event: HubEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const token = getToken();
  const controller = new AbortController();
  if (!token) {
    onError?.(new Error('缺少访问 token'));
    return () => controller.abort();
  }

  void readEventStream(token, controller, onEvent, onError);
  return () => controller.abort();
}

/**
 * 建立并持续解析 SSE 连接。
 *
 * @param token - 本机访问 token
 * @param controller - 用于退订的请求控制器
 * @param onEvent - 事件回调
 * @param onError - 连接错误回调
 * @returns 连接结束后解决的 Promise
 */
async function readEventStream(
  token: string,
  controller: AbortController,
  onEvent: (event: HubEvent) => void,
  onError?: (error: Error) => void
): Promise<void> {
  try {
    const response = await fetch(API_PATHS.events, {
      headers: { [TOKEN_HEADER]: token },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      onError?.(new Error(`事件流连接失败(${response.status})`));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine) {
          onEvent(JSON.parse(dataLine.slice(6)) as HubEvent);
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
