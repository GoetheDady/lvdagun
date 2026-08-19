import { sessionApiPaths, type AgentStreamEvent } from '@lvdagun/protocol';

/**
 * 订阅 Agent Hub 的 SSE 事件流。
 *
 * @param sessionId - 当前会话标识
 * @param onEvent - 事件回调
 * @param onDisconnect - 连接断开回调；浏览器随后会自动重连
 * @param onError - 事件无法解析时的终态错误回调
 * @returns 退订函数
 */
export function subscribeEvents(
  sessionId: string,
  onEvent: (event: AgentStreamEvent) => void,
  onDisconnect?: () => void,
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
  source.onerror = () => {
    onDisconnect?.();
  };
  return () => source.close();
}
