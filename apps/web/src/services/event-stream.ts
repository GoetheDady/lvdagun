import { sessionApiPaths, type AgentStreamEvent } from '@lvdagun/protocol';

/**
 * 订阅 Agent Hub 的 SSE 事件流。
 *
 * @param sessionId - 当前会话标识
 * @param onEvent - 事件回调
 * @param onError - 连接错误回调
 * @returns 退订函数
 */
export function subscribeEvents(
  sessionId: string,
  onEvent: (event: AgentStreamEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const controller = new AbortController();

  void readEventStream(sessionId, controller, onEvent, onError);
  return () => controller.abort();
}

/**
 * 建立并持续解析 SSE 连接。
 *
 * @param sessionId - 当前会话标识
 * @param controller - 用于退订的请求控制器
 * @param onEvent - 事件回调
 * @param onError - 连接错误回调
 * @returns 连接结束后解决的 Promise
 */
async function readEventStream(
  sessionId: string,
  controller: AbortController,
  onEvent: (event: AgentStreamEvent) => void,
  onError?: (error: Error) => void
): Promise<void> {
  try {
    const response = await fetch(sessionApiPaths(sessionId).events, {
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
          onEvent(JSON.parse(dataLine.slice(6)) as AgentStreamEvent);
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
