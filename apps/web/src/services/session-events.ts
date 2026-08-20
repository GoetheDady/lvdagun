import type { AgentStreamEvent } from '@lvdagun/protocol';
import { getRpcConnection, RpcRequestError } from '@/services/rpc-client';

/**
 * 订阅 Agent Hub 的会话事件流。
 *
 * @param sessionId - 当前会话标识
 * @param onEvent - 事件回调
 * @param onDisconnect - 连接断开回调；RPC 客户端随后会重连
 * @param onError - 事件无法解析时的终态错误回调
 * @returns 退订函数
 */
export function subscribeEvents(
  sessionId: string,
  onEvent: (event: AgentStreamEvent) => void,
  onDisconnect?: () => void,
  onError?: (error: Error) => void
): () => void {
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  void getRpcConnection()
    .subscribeSession(sessionId, { onEvent, onDisconnect, onError })
    .then((close) => {
      if (closed) close();
      else unsubscribe = close;
    })
    .catch((error) => {
      const code =
        error instanceof RpcRequestError &&
        typeof error.data === 'object' &&
        error.data !== null &&
        'code' in error.data
          ? error.data.code
          : null;
      if (code === 'session_archived' || code === 'session_not_found') {
        onEvent({
          type: 'session_unavailable',
          reason: code === 'session_archived' ? 'archived' : 'missing',
        });
        return;
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  return () => {
    closed = true;
    unsubscribe?.();
  };
}
