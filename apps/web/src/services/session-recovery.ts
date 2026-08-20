import type { AgentStreamEvent } from '@lvdagun/protocol';

import type { ChatSessionAction } from '@/state/chat-session-state';
import { operationFailedAction } from '@/state/chat-session-state';
import { api } from '@/services/api-client';
import { subscribeEvents } from '@/services/session-events';

/**
 * 建立一条会话恢复线路：权威快照先校准页面，随后消费增量事件，并在结算后收敛稳定条目标识。
 *
 * @param sessionId - 当前会话标识
 * @param dispatch - 客户端会话状态机入口
 * @returns 关闭订阅、计时器和后续历史读取的函数
 */
export function connectSessionRecovery(
  sessionId: string,
  dispatch: (action: ChatSessionAction) => void
): () => void {
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  /** 收敛实时临时消息与服务端持久化历史中的稳定条目标识。 */
  const convergeHistory = (): void => {
    void api
      .getMessages(sessionId)
      .then((messages) => {
        if (!closed) dispatch({ type: 'history_loaded', history: messages });
      })
      // 实时订阅已经给出完整可用状态；历史收敛失败时保留当前展示，等待下一次快照校准。
      .catch(() => undefined);
  };

  try {
    unsubscribe = subscribeEvents(
      sessionId,
      (event) => {
        dispatch({ type: 'product_event', event });

        if (isTerminalSessionEvent(event)) {
          unsubscribe?.();
          return;
        }
        if (requiresHistoryConvergence(event)) {
          convergeHistory();
        }
      },
      () => dispatch({ type: 'connection_lost' }),
      (error) => dispatch(operationFailedAction(error))
    );
  } catch (error) {
    dispatch(operationFailedAction(error));
  }

  return () => {
    closed = true;
    unsubscribe?.();
  };
}

/** @param event - 实时会话事件 @returns 是否应停止当前订阅 */
function isTerminalSessionEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === 'session_archived' ||
    event.type === 'session_deleted' ||
    event.type === 'session_unavailable'
  );
}

/** @param event - 实时会话事件 @returns 是否需要重新读取持久化历史 */
function requiresHistoryConvergence(event: AgentStreamEvent): boolean {
  return event.type === 'session_history_changed';
}
