import { useCallback, useEffect, useReducer } from 'react';

import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  CompactionReason,
  ModelReference,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { api } from '@/services/api-client';
import { subscribeEvents } from '@/services/event-stream';

export type AssistantChatMessage = Extract<ChatMessage, { role: 'assistant' }>;
export type ToolResultChatMessage = Extract<ChatMessage, { role: 'toolResult' }>;
type AssistantUpdate = Extract<
  AgentStreamEvent,
  { type: 'message_update' }
>['assistantMessageEvent'];

/** 对话操作错误。 */
interface ChatError {
  /** 面向用户的错误说明 */
  message: string;
  /** 是否可通过重发最后一条用户消息恢复 */
  retryable: boolean;
}

/** 单次工具调用的实时状态。 */
export interface ToolRunState {
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError: boolean;
  status: 'running' | 'success' | 'error';
}

/** Pi 自动重试在界面中的保留记录。 */
export interface RetryRecord {
  id: number;
  kind: 'model' | 'summarization';
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
  deadlineAt: number;
  status: 'waiting' | 'retrying' | 'success' | 'error';
}

/** Pi 上下文压缩的临时状态。 */
export interface CompactionState {
  status: 'running' | 'success' | 'aborted' | 'error';
  reason: CompactionReason;
  message?: string;
}

/** 当前 URL 指向的会话无法继续显示的原因。 */
export type SessionUnavailableReason = 'archived' | 'missing';

/** 对话会话的完整客户端状态。 */
export interface ChatSessionState {
  messages: ChatMessage[];
  activeAssistant: AssistantChatMessage | null;
  toolRuns: Record<string, ToolRunState>;
  retries: RetryRecord[];
  compaction: CompactionState | null;
  session: AgentSessionState | null;
  isRunning: boolean;
  loading: boolean;
  sending: boolean;
  aborting: boolean;
  settingThinkingLevel: boolean;
  settingModel: boolean;
  unavailableReason: SessionUnavailableReason | null;
  error: ChatError | null;
}

/** 尚未连接本地服务时的对话初始状态。 */
export const initialState: ChatSessionState = {
  messages: [],
  activeAssistant: null,
  toolRuns: {},
  retries: [],
  compaction: null,
  session: null,
  isRunning: false,
  loading: true,
  sending: false,
  aborting: false,
  settingThinkingLevel: false,
  settingModel: false,
  unavailableReason: null,
  error: null,
};

/** 会话状态机接受的动作。 */
export type ChatSessionAction =
  | { type: 'initialized'; messages: ChatMessage[]; session: AgentSessionState }
  | { type: 'history_loaded'; messages: ChatMessage[] }
  | { type: 'pi_event'; event: AgentStreamEvent; receivedAt?: number }
  | { type: 'send_started' }
  | { type: 'send_finished' }
  | { type: 'abort_started' }
  | { type: 'abort_finished' }
  | { type: 'thinking_level_started' }
  | { type: 'thinking_level_finished'; session: AgentSessionState }
  | { type: 'model_started' }
  | { type: 'model_finished'; session: AgentSessionState }
  | { type: 'unavailable'; reason: SessionUnavailableReason }
  | { type: 'operation_failed'; message: string; retryable: boolean };

/**
 * 把未知错误转换为统一的操作失败动作。
 *
 * @param error - 捕获到的未知错误
 * @param retryable - 是否允许重发最后一条消息
 * @returns 对话状态机可处理的失败动作
 */
function operationFailedAction(error: unknown, retryable = false): ChatSessionAction {
  return {
    type: 'operation_failed',
    message: error instanceof Error ? error.message : String(error),
    retryable,
  };
}

/**
 * 将 Pi 消息内容提取为可重发的纯文本。
 *
 * @param message - Pi 结构化消息
 * @returns 消息中的所有文本块；没有文本时返回空字符串
 */
function getMessageText(message: ChatMessage): string {
  if (message.role !== 'user') {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter(
      (content): content is Extract<(typeof message.content)[number], { type: 'text' }> =>
        content.type === 'text'
    )
    .map((content) => content.text)
    .join('\n');
}

/**
 * 把 Pi 的助手增量应用到当前结构化消息。
 *
 * @param message - `message_start` 提供的助手消息骨架
 * @param update - Pi JSON 流中的单次内容更新
 * @returns 应用更新后的新助手消息
 */
export function applyAssistantUpdate(
  message: AssistantChatMessage,
  update: AssistantUpdate
): AssistantChatMessage {
  if (update.type === 'done') {
    return update.message;
  }
  if (update.type === 'error') {
    return update.error;
  }
  if (update.type === 'start') {
    return message;
  }

  const content = [...message.content];
  switch (update.type) {
    case 'text_start':
      content[update.contentIndex] = { type: 'text', text: '' };
      break;
    case 'text_delta': {
      const current = content[update.contentIndex];
      const text = current?.type === 'text' ? current.text : '';
      content[update.contentIndex] = { type: 'text', text: text + update.delta };
      break;
    }
    case 'text_end':
      content[update.contentIndex] = { type: 'text', text: update.content };
      break;
    case 'thinking_start':
      content[update.contentIndex] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta': {
      const current = content[update.contentIndex];
      const thinking = current?.type === 'thinking' ? current.thinking : '';
      content[update.contentIndex] = {
        type: 'thinking',
        thinking: thinking + update.delta,
      };
      break;
    }
    case 'thinking_end':
      content[update.contentIndex] = { type: 'thinking', thinking: update.content };
      break;
    case 'toolcall_start':
    case 'toolcall_delta':
      break;
    case 'toolcall_end':
      content[update.contentIndex] = update.toolCall;
      break;
  }
  return { ...message, content };
}

/**
 * 更新最近一条仍在进行的重试记录。
 *
 * @param retries - 现有重试记录
 * @param update - 对目标记录执行的更新
 * @returns 更新后的重试记录数组
 */
function updateLatestRetry(
  retries: RetryRecord[],
  update: (record: RetryRecord) => RetryRecord
): RetryRecord[] {
  let index = -1;
  for (let recordIndex = retries.length - 1; recordIndex >= 0; recordIndex -= 1) {
    const record = retries[recordIndex];
    if (record?.status === 'waiting' || record?.status === 'retrying') {
      index = recordIndex;
      break;
    }
  }
  if (index < 0) {
    return retries;
  }
  return retries.map((record, recordIndex) => (recordIndex === index ? update(record) : record));
}

/**
 * 把一条 Pi JSON 会话事件归并进客户端语义状态。
 *
 * 生命周期事件只驱动输入锁定等状态，不会被追加为消息行；消息、工具、重试和压缩事件
 * 分别进入自己的结构，避免把原始事件日志直接暴露给用户。
 *
 * @param state - 当前会话状态
 * @param event - Pi JSON 会话事件
 * @param receivedAt - 浏览器收到事件的时间，用于重试倒计时
 * @returns 归并后的新状态
 */
function reducePiEvent(
  state: ChatSessionState,
  event: AgentStreamEvent,
  receivedAt: number
): ChatSessionState {
  switch (event.type) {
    case 'agent_start':
      return { ...state, isRunning: true, error: null };
    case 'agent_settled':
      return {
        ...state,
        isRunning: false,
        sending: false,
        aborting: false,
        activeAssistant: null,
      };
    case 'message_start':
      return event.message.role === 'assistant'
        ? { ...state, activeAssistant: event.message }
        : state;
    case 'message_update':
      return state.activeAssistant
        ? {
            ...state,
            activeAssistant: applyAssistantUpdate(
              state.activeAssistant,
              event.assistantMessageEvent
            ),
          }
        : state;
    case 'message_end': {
      const toolRuns = { ...state.toolRuns };
      if (event.message.role === 'toolResult') {
        const previous = toolRuns[event.message.toolCallId];
        toolRuns[event.message.toolCallId] = {
          toolCallId: event.message.toolCallId,
          toolName: event.message.toolName,
          args: previous?.args ?? {},
          result: event.message,
          isError: event.message.isError,
          status: event.message.isError ? 'error' : 'success',
        };
      }
      return {
        ...state,
        messages: [...state.messages, event.message],
        activeAssistant: event.message.role === 'assistant' ? null : state.activeAssistant,
        toolRuns,
        compaction: event.message.role === 'compactionSummary' ? null : state.compaction,
      };
    }
    case 'tool_execution_start':
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [event.toolCallId]: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            isError: false,
            status: 'running',
          },
        },
      };
    case 'tool_execution_update':
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [event.toolCallId]: {
            ...(state.toolRuns[event.toolCallId] ?? {
              toolCallId: event.toolCallId,
              isError: false,
              status: 'running' as const,
            }),
            toolName: event.toolName,
            args: event.args,
            partialResult: event.partialResult,
          },
        },
      };
    case 'tool_execution_end':
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [event.toolCallId]: {
            ...(state.toolRuns[event.toolCallId] ?? {
              toolCallId: event.toolCallId,
              args: {},
            }),
            toolName: event.toolName,
            result: event.result,
            isError: event.isError,
            status: event.isError ? 'error' : 'success',
          },
        },
      };
    case 'auto_retry_start':
      return {
        ...state,
        isRunning: true,
        retries: [
          ...state.retries,
          {
            id: state.retries.length,
            kind: 'model',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
            deadlineAt: receivedAt + event.delayMs,
            status: 'waiting',
          },
        ],
      };
    case 'auto_retry_end':
      return {
        ...state,
        retries: updateLatestRetry(state.retries, (record) => ({
          ...record,
          attempt: event.attempt,
          errorMessage: event.finalError ?? record.errorMessage,
          status: event.success ? 'success' : 'error',
        })),
      };
    case 'summarization_retry_scheduled':
      return {
        ...state,
        retries: [
          ...state.retries,
          {
            id: state.retries.length,
            kind: 'summarization',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
            deadlineAt: receivedAt + event.delayMs,
            status: 'waiting',
          },
        ],
      };
    case 'summarization_retry_attempt_start':
      return {
        ...state,
        retries: updateLatestRetry(state.retries, (record) => ({
          ...record,
          status: 'retrying',
        })),
      };
    case 'summarization_retry_finished':
      return {
        ...state,
        retries: updateLatestRetry(state.retries, (record) => ({
          ...record,
          status: 'success',
        })),
      };
    case 'compaction_start':
      return {
        ...state,
        isRunning: true,
        compaction: { status: 'running', reason: event.reason },
      };
    case 'compaction_end':
      return {
        ...state,
        compaction: event.aborted
          ? { status: 'aborted', reason: event.reason }
          : event.errorMessage
            ? { status: 'error', reason: event.reason, message: event.errorMessage }
            : { status: 'success', reason: event.reason },
      };
    case 'thinking_level_changed':
      return state.session
        ? { ...state, session: { ...state.session, thinkingLevel: event.level } }
        : state;
    case 'session_model_changed':
    case 'session_state':
      return {
        ...state,
        session: event.state,
        isRunning: event.state.isRunning,
      };
    case 'session_info_changed':
      return state.session
        ? { ...state, session: { ...state.session, sessionName: event.name ?? null } }
        : state;
    case 'pending_messages_changed':
      return state.session
        ? { ...state, session: { ...state.session, pendingMessages: event.pendingMessages } }
        : state;
    case 'session_archived':
      return unavailableState(state, 'archived');
    case 'session_deleted':
      return unavailableState(state, 'missing');
    case 'agent_end':
    case 'turn_start':
    case 'turn_end':
    case 'queue_update':
    case 'entry_appended':
    case 'bash_execution_update':
      return state;
  }
}

/**
 * 清除不可再访问会话的内容和运行状态。
 *
 * @param state - 当前会话状态
 * @param reason - 会话不可显示的原因
 * @returns 不再暴露原会话内容的空状态
 */
function unavailableState(
  state: ChatSessionState,
  reason: SessionUnavailableReason
): ChatSessionState {
  return {
    ...state,
    messages: [],
    activeAssistant: null,
    toolRuns: {},
    retries: [],
    compaction: null,
    session: null,
    isRunning: false,
    loading: false,
    sending: false,
    aborting: false,
    settingThinkingLevel: false,
    settingModel: false,
    unavailableReason: reason,
    error: null,
  };
}

/**
 * 对话会话纯状态机。
 *
 * @param state - 当前状态
 * @param action - HTTP、SSE 或界面操作产生的动作
 * @returns 下一状态
 */
export function chatReducer(state: ChatSessionState, action: ChatSessionAction): ChatSessionState {
  switch (action.type) {
    case 'initialized':
      return {
        ...state,
        messages: action.messages,
        session: action.session,
        isRunning: action.session.isRunning,
        compaction: action.session.activeCompaction
          ? { status: 'running', reason: action.session.activeCompaction.reason }
          : null,
        loading: false,
        unavailableReason: null,
        error: null,
      };
    case 'history_loaded':
      return {
        ...state,
        messages: action.messages,
        compaction:
          state.compaction?.status === 'success' &&
          action.messages.some((message) => message.role === 'compactionSummary')
            ? null
            : state.compaction,
      };
    case 'pi_event':
      return reducePiEvent(state, action.event, action.receivedAt ?? Date.now());
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
      return {
        ...state,
        session: action.session,
        isRunning: action.session.isRunning,
        settingThinkingLevel: false,
      };
    case 'model_started':
      return { ...state, settingModel: true, error: null };
    case 'model_finished':
      return {
        ...state,
        session: action.session,
        isRunning: action.session.isRunning,
        settingModel: false,
      };
    case 'unavailable':
      return unavailableState(state, action.reason);
    case 'operation_failed':
      return {
        ...state,
        loading: false,
        sending: false,
        aborting: false,
        settingThinkingLevel: false,
        settingModel: false,
        error: { message: action.message, retryable: action.retryable },
      };
  }
}

/** useChatSession 暴露给页面的稳定接口。 */
export interface ChatSession {
  state: ChatSessionState;
  /**
   * 发送一条用户提示。
   *
   * @param text - 用户输入的纯文本
   * @returns Pi 接受提示后解决的 Promise
   */
  send(text: string): Promise<void>;
  /**
   * 重发历史中的最后一条用户文本消息。
   *
   * @returns 无返回值
   */
  retry(): void;
  /**
   * 中止当前 Pi Agent 运行或上下文压缩。
   *
   * @returns Pi 完全稳定后解决的 Promise
   */
  abort(): Promise<string[]>;
  /** @param messageId - 待处理消息标识 @returns Pi 接受调整方向后解决的 Promise */
  steerPendingMessage(messageId: string): Promise<void>;
  /** @param messageId - 待处理消息标识 @returns 删除完成后的 Promise */
  removePendingMessage(messageId: string): Promise<void>;
  /** @returns 按排队顺序取回的全部文本 */
  takePendingMessages(): Promise<string[]>;
  /** @returns 丢弃全部待处理消息后的 Promise */
  discardPendingMessages(): Promise<void>;
  /**
   * 设置 Pi 当前思考等级。
   *
   * @param level - 当前模型声明支持的思考等级
   * @returns 设置持久化后解决的 Promise
   */
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  /**
   * 设置当前会话后续 Agent 运行使用的模型。
   *
   * @param model - 跨 Provider 模型引用
   * @returns 设置持久化后解决的 Promise
   */
  setModel(model: ModelReference): Promise<void>;
}

/**
 * 连接 HTTP 与 SSE，并向对话页提供结构化 Pi 会话状态。
 *
 * @param sessionId - 当前 URL 选择的会话标识
 * @returns 会话状态和可执行操作
 */
export function useChatSession(sessionId: string): ChatSession {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      try {
        const [messages, session] = await Promise.all([
          api.getMessages(sessionId),
          api.getSessionState(sessionId),
        ]);
        if (cancelled) {
          return;
        }
        dispatch({ type: 'initialized', messages, session });
        unsubscribe = subscribeEvents(
          sessionId,
          (event) => {
            dispatch({ type: 'pi_event', event, receivedAt: Date.now() });
            if (event.type === 'session_archived' || event.type === 'session_deleted') {
              unsubscribe?.();
            }
            if (event.type === 'compaction_end' && event.result && !event.aborted) {
              void api.getMessages(sessionId).then((history) => {
                if (!cancelled) {
                  dispatch({ type: 'history_loaded', messages: history });
                }
              });
            }
          },
          (error) => {
            dispatch(operationFailedAction(error));
          }
        );
      } catch (error) {
        if (!cancelled) {
          const status = getErrorStatus(error);
          if (status === 404 || status === 410) {
            dispatch({
              type: 'unavailable',
              reason: status === 410 ? 'archived' : 'missing',
            });
            return;
          }
          dispatch(operationFailedAction(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [sessionId]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (
        state.sending ||
        state.compaction?.status === 'running' ||
        state.settingModel ||
        state.settingThinkingLevel
      ) {
        return;
      }
      dispatch({ type: 'send_started' });
      try {
        await api.prompt(sessionId, text);
        dispatch({ type: 'send_finished' });
      } catch (error) {
        dispatch(operationFailedAction(error, true));
      }
    },
    [
      sessionId,
      state.compaction?.status,
      state.sending,
      state.settingModel,
      state.settingThinkingLevel,
    ]
  );

  const retry = useCallback((): void => {
    const lastUserMessage = [...state.messages]
      .reverse()
      .find((message) => message.role === 'user');
    if (lastUserMessage) {
      const text = getMessageText(lastUserMessage);
      if (text) {
        void send(text);
      }
    }
  }, [send, state.messages]);

  const abort = useCallback(async (): Promise<string[]> => {
    if (!state.isRunning || state.aborting) {
      return [];
    }
    dispatch({ type: 'abort_started' });
    try {
      const result = await api.abortSession(sessionId);
      dispatch({ type: 'abort_finished' });
      return result.restoredTexts;
    } catch (error) {
      dispatch(operationFailedAction(error));
      return [];
    }
  }, [sessionId, state.aborting, state.isRunning]);

  const steerPendingMessage = useCallback(
    async (messageId: string): Promise<void> => {
      try {
        await api.steerPendingMessage(sessionId, messageId);
      } catch (error) {
        dispatch(operationFailedAction(error));
      }
    },
    [sessionId]
  );

  const removePendingMessage = useCallback(
    async (messageId: string): Promise<void> => {
      try {
        await api.removePendingMessage(sessionId, messageId);
      } catch (error) {
        dispatch(operationFailedAction(error));
      }
    },
    [sessionId]
  );

  const takePendingMessages = useCallback(async (): Promise<string[]> => {
    try {
      return (await api.takePendingMessages(sessionId)).texts;
    } catch (error) {
      dispatch(operationFailedAction(error));
      return [];
    }
  }, [sessionId]);

  const discardPendingMessages = useCallback(async (): Promise<void> => {
    try {
      await api.discardPendingMessages(sessionId);
    } catch (error) {
      dispatch(operationFailedAction(error));
    }
  }, [sessionId]);

  const setThinkingLevel = useCallback(
    async (level: ThinkingLevel): Promise<void> => {
      if (
        state.isRunning ||
        state.settingModel ||
        state.settingThinkingLevel ||
        state.session?.thinkingLevel === level
      ) {
        return;
      }
      dispatch({ type: 'thinking_level_started' });
      try {
        const session = await api.setThinkingLevel(sessionId, level);
        dispatch({ type: 'thinking_level_finished', session });
      } catch (error) {
        dispatch(operationFailedAction(error));
      }
    },
    [
      sessionId,
      state.isRunning,
      state.session?.thinkingLevel,
      state.settingModel,
      state.settingThinkingLevel,
    ]
  );

  const setModel = useCallback(
    async (model: ModelReference): Promise<void> => {
      if (
        state.isRunning ||
        state.settingModel ||
        state.settingThinkingLevel ||
        (state.session?.model.provider === model.provider && state.session.model.id === model.id)
      ) {
        return;
      }
      dispatch({ type: 'model_started' });
      try {
        const session = await api.setSessionModel(sessionId, model);
        dispatch({ type: 'model_finished', session });
      } catch (error) {
        dispatch(operationFailedAction(error));
      }
    },
    [sessionId, state.isRunning, state.session, state.settingModel, state.settingThinkingLevel]
  );

  return {
    state,
    send,
    retry,
    abort,
    steerPendingMessage,
    removePendingMessage,
    takePendingMessages,
    discardPendingMessages,
    setThinkingLevel,
    setModel,
  };
}

/**
 * 从接口错误中读取 HTTP 状态码。
 *
 * @param error - 未知请求错误
 * @returns HTTP 状态码；普通错误返回 null
 */
function getErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null;
  }
  return typeof error.status === 'number' ? error.status : null;
}
