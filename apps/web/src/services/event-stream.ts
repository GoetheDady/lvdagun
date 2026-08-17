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
  const source = new EventSource(sessionApiPaths(sessionId).events);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as AgentStreamEvent);
    } catch (error) {
      source.close();
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  source.onerror = (event) => {
    source.close();
    const error =
      event instanceof ErrorEvent && event.error instanceof Error
        ? event.error
        : new Error('事件流连接失败', { cause: event });
    onError?.(error);
  };
  return () => source.close();
}
