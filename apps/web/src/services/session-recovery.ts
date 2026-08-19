import type { AgentStreamEvent } from '@lvdagun/protocol';

import type { ChatSessionAction } from '@/state/chat-session-state';
import { operationFailedAction } from '@/state/chat-session-state';
import { api } from '@/services/api-client';
import { subscribeEvents } from '@/services/event-stream';

const RECONNECT_NOTICE_DELAY_MS = 1_000;

/**
 * 建立一条会话恢复线路：权威快照先校准页面，随后消费增量事件，并在结算后收敛稳定条目标识。
 *
 * @param sessionId - 当前会话标识
 * @param dispatch - 客户端会话状态机入口
 * @returns 关闭 SSE、计时器和后续历史读取的函数
 */
export function connectSessionRecovery(
  sessionId: string,
  dispatch: (action: ChatSessionAction) => void
): () => void {
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let reconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  /** 收敛 SSE 临时消息与服务端持久化历史中的稳定条目标识。 */
  const convergeHistory = (): void => {
    void api
      .getMessages(sessionId)
      .then((messages) => {
        if (!closed) dispatch({ type: 'history_loaded', messages });
      })
      // SSE 已经给出完整可用状态；历史收敛失败时保留当前展示，等待下一次快照校准。
      .catch(() => undefined);
  };

  try {
    unsubscribe = subscribeEvents(
      sessionId,
      (event) => {
        if (event.type === 'session_snapshot' && reconnectNoticeTimer) {
          clearTimeout(reconnectNoticeTimer);
          reconnectNoticeTimer = null;
        }
        dispatch({ type: 'pi_event', event, receivedAt: Date.now() });

        if (isTerminalSessionEvent(event)) {
          unsubscribe?.();
          return;
        }
        if (requiresHistoryConvergence(event)) {
          convergeHistory();
        }
      },
      () => {
        dispatch({ type: 'connection_lost' });
        if (reconnectNoticeTimer) clearTimeout(reconnectNoticeTimer);
        reconnectNoticeTimer = setTimeout(() => {
          dispatch({ type: 'connection_notice' });
        }, RECONNECT_NOTICE_DELAY_MS);
      },
      (error) => dispatch(operationFailedAction(error))
    );
  } catch (error) {
    dispatch(operationFailedAction(error));
  }

  return () => {
    closed = true;
    if (reconnectNoticeTimer) clearTimeout(reconnectNoticeTimer);
    unsubscribe?.();
  };
}

/** @param event - SSE 会话事件 @returns 是否应停止当前连接 */
function isTerminalSessionEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === 'session_archived' ||
    event.type === 'session_deleted' ||
    event.type === 'session_unavailable'
  );
}

/** @param event - SSE 会话事件 @returns 是否需要重新读取持久化历史 */
function requiresHistoryConvergence(event: AgentStreamEvent): boolean {
  return (
    event.type === 'agent_settled' ||
    (event.type === 'compaction_end' && event.result !== undefined && !event.aborted)
  );
}
