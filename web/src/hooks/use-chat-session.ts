import { useCallback, useEffect, useReducer } from 'react';

import type { ChatMessage, HubEvent } from '@lvdagun/backend';

import { api, subscribeEvents } from '@/lib/api';

/** 对话错误(重试 = 重发最后一条用户消息) */
export interface ChatError {
  message: string;
  retryable: boolean;
}

/** 对话会话状态:完整消息 + 流式占位 + 错误 + 发送中 */
export interface ChatSessionState {
  messages: ChatMessage[];
  /** 正在流式输出的 AI 文本(未定稿) */
  pending: string;
  streaming: boolean;
  error: ChatError | null;
  sending: boolean;
}

/** 初始状态:空列表、无流式、无错误 */
export const initialState: ChatSessionState = {
  messages: [],
  pending: '',
  streaming: false,
  error: null,
  sending: false,
};

/**
 * 会话状态机动作。
 *
 * hub_event 承载 SSE 推送;send_* 承载发送生命周期。
 * (内部接缝:导出供本模块测试直打,调用方只使用 useChatSession)
 */
export type ChatSessionAction =
  | { type: 'history_loaded'; messages: ChatMessage[] }
  | { type: 'hub_event'; event: HubEvent }
  | { type: 'send_started' }
  | { type: 'send_failed'; message: string }
  | { type: 'send_finished' };

/**
 * 对话会话状态机:所有事件 → 状态转换集中于此。
 *
 * 纯函数,不触网、不碰 React —— 会话语义(V1 长期记忆、多端恢复、重连)
 * 都在这张转换表上加动作,调用方零感知。
 *
 * @param state - 当前状态
 * @param action - 转换动作
 * @returns 新状态
 */
export function chatReducer(state: ChatSessionState, action: ChatSessionAction): ChatSessionState {
  switch (action.type) {
    case 'history_loaded':
      return { ...state, messages: action.messages };
    case 'send_started':
      return { ...state, sending: true, error: null };
    case 'send_failed':
      return { ...state, sending: false, error: { message: action.message, retryable: true } };
    case 'send_finished':
      return { ...state, sending: false };
    case 'hub_event':
      return reduceEvent(state, action.event);
  }
}

/** HubEvent → 状态转换(内部:switch 收敛在 reducer 一处) */
function reduceEvent(state: ChatSessionState, event: HubEvent): ChatSessionState {
  switch (event.type) {
    case 'user_message':
      return { ...state, messages: [...state.messages, event.message] };
    case 'assistant_message_start':
      return { ...state, streaming: true, pending: '', error: null };
    case 'assistant_text_delta':
      return { ...state, pending: state.pending + event.delta };
    case 'assistant_message_end':
      return {
        ...state,
        streaming: false,
        pending: '',
        messages: [...state.messages, event.message],
      };
    case 'session_cleared':
      return { ...state, messages: [], streaming: false, pending: '' };
    case 'error':
      return { ...state, error: { message: event.message, retryable: event.retryable } };
  }
}

/** useChatSession 的接口:页面拿到的全部 */
export interface ChatSession {
  messages: ChatMessage[];
  pending: string;
  streaming: boolean;
  error: ChatError | null;
  sending: boolean;
  /**
   * 发送消息;流式输出中或已有消息在途时忽略(会话同一时刻只允许一条在途消息)。
   *
   * @param text - 消息文本
   */
  send(text: string): Promise<void>;
  /** 重试:重发最后一条用户消息 */
  retry(): void;
  /** 清空会话(页面负责确认弹窗,这里只发请求) */
  clear(): void;
}

/**
 * 对话会话深模块:会话状态机的 React 接线。
 *
 * 只做三件事:挂 reducer、副作用(先拉历史再订阅事件)、动作翻译成 api 调用。
 * 顺序保证:历史落地前不订阅事件,否则 history_loaded 会覆盖已到达的 SSE 事件。
 *
 * @returns 会话状态与动作
 */
export function useChatSession(): ChatSession {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      try {
        const history = await api.getMessages();
        if (!cancelled) dispatch({ type: 'history_loaded', messages: history });
      } catch {
        if (!cancelled) dispatch({ type: 'history_loaded', messages: [] });
      }
      if (cancelled) return;
      unsubscribe = subscribeEvents(
        (event) => dispatch({ type: 'hub_event', event }),
        (errorEvent) =>
          dispatch({
            type: 'hub_event',
            event: { type: 'error', message: errorEvent.message, retryable: false },
          })
      );
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const send = useCallback(
    async (text: string): Promise<void> => {
      // 守卫:流式中/发送中不再发——后端一次只处理一条,插队会造成事件交错
      if (state.streaming || state.sending) {
        return;
      }
      dispatch({ type: 'send_started' });
      try {
        await api.prompt(text);
      } catch (errorEvent) {
        dispatch({
          type: 'send_failed',
          message: errorEvent instanceof Error ? errorEvent.message : String(errorEvent),
        });
        return;
      }
      dispatch({ type: 'send_finished' });
    },
    [state.streaming, state.sending]
  );

  const retry = useCallback((): void => {
    const lastUser = [...state.messages].reverse().find((message) => message.role === 'user');
    if (lastUser) {
      void send(lastUser.text);
    }
  }, [state.messages, send]);

  const clear = useCallback((): void => {
    void api.clearSession();
  }, []);

  return {
    messages: state.messages,
    pending: state.pending,
    streaming: state.streaming,
    error: state.error,
    sending: state.sending,
    send,
    retry,
    clear,
  };
}
