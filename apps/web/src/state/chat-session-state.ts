import type {
  AgentSessionState,
  AgentStreamEvent,
  ProductSessionHistory,
} from '@lvdagun/protocol';

interface ChatError {
  message: string;
}

export type SessionUnavailableReason = 'archived' | 'missing';

/** 对话会话的完整客户端状态。 */
export interface ChatSessionState {
  history: ProductSessionHistory | null;
  session: AgentSessionState | null;
  isRunning: boolean;
  loading: boolean;
  sending: boolean;
  aborting: boolean;
  settingThinkingLevel: boolean;
  settingModel: boolean;
  unavailableReason: SessionUnavailableReason | null;
  synchronized: boolean;
  showReconnectNotice: boolean;
  error: ChatError | null;
}

export const initialState: ChatSessionState = {
  history: null,
  session: null,
  isRunning: false,
  loading: true,
  sending: false,
  aborting: false,
  settingThinkingLevel: false,
  settingModel: false,
  unavailableReason: null,
  synchronized: false,
  showReconnectNotice: false,
  error: null,
};

export type ChatSessionAction =
  | { type: 'history_loaded'; history: ProductSessionHistory }
  | { type: 'product_event'; event: AgentStreamEvent }
  | { type: 'send_started' }
  | { type: 'send_finished' }
  | { type: 'abort_started' }
  | { type: 'abort_finished' }
  | { type: 'thinking_level_started' }
  | { type: 'thinking_level_finished'; session: AgentSessionState }
  | { type: 'model_started' }
  | { type: 'model_finished'; session: AgentSessionState }
  | { type: 'connection_lost' }
  | { type: 'connection_notice' }
  | { type: 'operation_failed'; message: string };

/** @param error - 未知错误 @returns 操作失败动作 */
export function operationFailedAction(error: unknown): ChatSessionAction {
  return {
    type: 'operation_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** @param state - 当前状态 @param reason - 不可访问原因 @returns 空状态 */
function unavailableState(
  state: ChatSessionState,
  reason: SessionUnavailableReason
): ChatSessionState {
  return {
    ...state,
    history: null,
    session: null,
    isRunning: false,
    loading: false,
    sending: false,
    aborting: false,
    unavailableReason: reason,
    synchronized: false,
    showReconnectNotice: false,
    error: null,
  };
}

/** @param state - 当前状态 @param event - 产品会话事件 @returns 下一状态 */
function reduceProductEvent(state: ChatSessionState, event: AgentStreamEvent): ChatSessionState {
  switch (event.type) {
    case 'session_snapshot':
      return {
        ...state,
        history: event.history,
        session: event.state,
        isRunning: event.state.isRunning,
        loading: false,
        sending: false,
        settingThinkingLevel: false,
        settingModel: false,
        unavailableReason: null,
        synchronized: true,
        showReconnectNotice: false,
      };
    case 'session_history_changed':
      return {
        ...state,
        history: event.history,
        isRunning:
          event.history.runs.at(-1)?.status === 'accepted' ||
          event.history.runs.at(-1)?.status === 'running',
        sending: false,
      };
    case 'session_draft_changed':
      return state.history && state.history.revision === event.revision
        ? { ...state, history: { ...state.history, draft: event.draft } }
        : state;
    case 'session_model_changed':
      return { ...state, session: event.state, isRunning: event.state.isRunning };
    case 'session_info_changed':
      return state.session
        ? { ...state, session: { ...state.session, sessionName: event.name ?? null } }
        : state;
    case 'thinking_level_changed':
      return state.session
        ? { ...state, session: { ...state.session, thinkingLevel: event.level } }
        : state;
    case 'pending_messages_changed':
      return state.session
        ? { ...state, session: { ...state.session, pendingMessages: event.pendingMessages } }
        : state;
    case 'session_unavailable':
      return unavailableState(state, event.reason);
    case 'session_archived':
      return unavailableState(state, 'archived');
    case 'session_deleted':
      return unavailableState(state, 'missing');
  }
}

/** @param state - 当前状态 @param action - 状态动作 @returns 下一状态 */
export function chatReducer(state: ChatSessionState, action: ChatSessionAction): ChatSessionState {
  switch (action.type) {
    case 'history_loaded':
      return { ...state, history: action.history };
    case 'product_event':
      return reduceProductEvent(state, action.event);
    case 'send_started':
      return { ...state, sending: true, error: null };
    case 'send_finished':
      return { ...state, sending: false };
    case 'abort_started':
      return { ...state, aborting: true, error: null };
    case 'abort_finished':
      return { ...state, aborting: false };
    case 'thinking_level_started':
      return { ...state, settingThinkingLevel: true, error: null };
    case 'thinking_level_finished':
      return { ...state, session: action.session, settingThinkingLevel: false };
    case 'model_started':
      return { ...state, settingModel: true, error: null };
    case 'model_finished':
      return { ...state, session: action.session, settingModel: false };
    case 'connection_lost':
      return { ...state, synchronized: false };
    case 'connection_notice':
      return state.synchronized ? state : { ...state, showReconnectNotice: true };
    case 'operation_failed':
      return {
        ...state,
        loading: false,
        sending: false,
        aborting: false,
        settingThinkingLevel: false,
        settingModel: false,
        error: { message: action.message },
      };
  }
}
