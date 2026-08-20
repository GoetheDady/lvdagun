import { useCallback, useEffect, useReducer } from 'react';

import type { ModelReference, ThinkingLevel } from '@lvdagun/protocol';

import { api } from '@/services/api-client';
import { connectSessionRecovery } from '@/services/session-recovery';
import {
  chatReducer,
  initialState,
  operationFailedAction,
  type ChatSessionState,
} from '@/state/chat-session-state';

/** useChatSession 暴露给页面的稳定接口。 */
export interface ChatSession {
  state: ChatSessionState;
  /** @param text - 用户输入的纯文本 @returns Pi 是否接受提示 */
  send(text: string): Promise<boolean>;
  /** @param runId - 助手回复运行标识 @returns 新会话标识；失败时返回 null */
  forkSession(runId: string): Promise<string | null>;
  /** @param itemId - 用户消息条目标识 @param text - 修改文本 @returns 是否被接受 */
  editAndResend(itemId: string, text: string): Promise<boolean>;
  /** @returns Pi 完全稳定后应恢复到输入框的文本 */
  abort(): Promise<string[]>;
  /** @param messageId - 待处理消息标识 @returns Pi 接受调整方向后的 Promise */
  steerPendingMessage(messageId: string): Promise<void>;
  /** @param messageId - 待处理消息标识 @returns 删除完成后的 Promise */
  removePendingMessage(messageId: string): Promise<void>;
  /** @returns 按排队顺序取回的全部文本 */
  takePendingMessages(): Promise<string[]>;
  /** @returns 丢弃全部待处理消息后的 Promise */
  discardPendingMessages(): Promise<void>;
  /** @param level - 当前模型支持的思考等级 @returns 持久化完成后的 Promise */
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  /** @param model - 跨 Provider 模型引用 @returns 持久化完成后的 Promise */
  setModel(model: ModelReference): Promise<void>;
}

/**
 * 连接会话恢复线路和 JSON-RPC 命令，并向对话页提供结构化状态。
 *
 * @param sessionId - 当前 URL 选择的会话标识
 * @returns 会话状态和用户可执行的命令
 */
export function useChatSession(sessionId: string): ChatSession {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  useEffect(() => connectSessionRecovery(sessionId, dispatch), [sessionId]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (
        !state.synchronized ||
        state.session?.executionAvailable === false ||
        state.sending ||
        state.settingModel ||
        state.settingThinkingLevel
      ) {
        return false;
      }
      dispatch({ type: 'send_started' });
      try {
        await api.prompt(sessionId, text);
        dispatch({ type: 'send_finished' });
        return true;
      } catch (error) {
        dispatch(
          operationFailedAction(
            getErrorStatus(error) === null ? new Error('发送结果未知，请检查会话后手动发送') : error
          )
        );
        return false;
      }
    },
    [
      sessionId,
      state.sending,
      state.session?.executionAvailable,
      state.settingModel,
      state.settingThinkingLevel,
      state.synchronized,
    ]
  );

  const forkSession = useCallback(
    async (runId: string): Promise<string | null> => {
      if (!state.synchronized || state.session?.executionAvailable === false) return null;
      try {
        return (await api.forkSession(sessionId, runId)).sessionId;
      } catch (error) {
        dispatch(operationFailedAction(error));
        return null;
      }
    },
    [sessionId, state.session?.executionAvailable, state.synchronized]
  );

  const editAndResend = useCallback(
    async (itemId: string, text: string): Promise<boolean> => {
      if (!state.synchronized || state.session?.executionAvailable === false) return false;
      try {
        const result = await api.editAndResend(sessionId, itemId, text);
        dispatch({ type: 'history_loaded', history: result.history });
        return true;
      } catch (error) {
        dispatch(operationFailedAction(error));
        return false;
      }
    },
    [sessionId, state.session?.executionAvailable, state.synchronized]
  );

  const abort = useCallback(async (): Promise<string[]> => {
    if (!state.isRunning || state.aborting) return [];
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
      if (!state.synchronized || state.session?.executionAvailable === false) return;
      try {
        await api.steerPendingMessage(sessionId, messageId);
      } catch (error) {
        dispatch(operationFailedAction(error));
      }
    },
    [sessionId, state.session?.executionAvailable, state.synchronized]
  );

  const removePendingMessage = useCallback(
    async (messageId: string): Promise<void> => {
      if (!state.synchronized || state.session?.executionAvailable === false) return;
      try {
        await api.removePendingMessage(sessionId, messageId);
      } catch (error) {
        dispatch(operationFailedAction(error));
      }
    },
    [sessionId, state.session?.executionAvailable, state.synchronized]
  );

  const takePendingMessages = useCallback(async (): Promise<string[]> => {
    if (!state.synchronized || state.session?.executionAvailable === false) return [];
    try {
      return (await api.takePendingMessages(sessionId)).texts;
    } catch (error) {
      dispatch(operationFailedAction(error));
      return [];
    }
  }, [sessionId, state.session?.executionAvailable, state.synchronized]);

  const discardPendingMessages = useCallback(async (): Promise<void> => {
    if (!state.synchronized || state.session?.executionAvailable === false) return;
    try {
      await api.discardPendingMessages(sessionId);
    } catch (error) {
      dispatch(operationFailedAction(error));
    }
  }, [sessionId, state.session?.executionAvailable, state.synchronized]);

  const setThinkingLevel = useCallback(
    async (level: ThinkingLevel): Promise<void> => {
      if (
        !state.synchronized ||
        state.session?.executionAvailable === false ||
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
      state.session?.executionAvailable,
      state.settingModel,
      state.settingThinkingLevel,
      state.synchronized,
    ]
  );

  const setModel = useCallback(
    async (model: ModelReference): Promise<void> => {
      if (
        !state.synchronized ||
        state.session?.executionAvailable === false ||
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
    [
      sessionId,
      state.isRunning,
      state.session,
      state.settingModel,
      state.settingThinkingLevel,
      state.synchronized,
    ]
  );

  return {
    state,
    send,
    forkSession,
    editAndResend,
    abort,
    steerPendingMessage,
    removePendingMessage,
    takePendingMessages,
    discardPendingMessages,
    setThinkingLevel,
    setModel,
  };
}

/** @param error - 未知请求错误 @returns HTTP 状态码；普通错误返回 null */
function getErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  return typeof error.status === 'number' ? error.status : null;
}
