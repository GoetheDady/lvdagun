import { resolveSessionTitle } from '@lvdagun/protocol';

import type { ChatSessionState } from '@/state/chat-session-state';

/** @param state - 会话状态 @param fallbackTitle - 列表标题 @returns 当前标题 */
export function selectSessionTitle(state: ChatSessionState, fallbackTitle?: string): string {
  const firstUser = state.history?.runs
    .flatMap((run) => run.items)
    .find((item) => item.type === 'user_message');
  return resolveSessionTitle({
    sessionName: state.session?.sessionName,
    firstUserMessage: firstUser?.type === 'user_message' ? firstUser.text : '',
    fallbackTitle,
  });
}

/** @param state - 会话状态 @returns 可编辑的最后一条产品用户消息 */
export function selectEditableUserItemId(state: ChatSessionState): string | null {
  if (state.isRunning || !state.synchronized || state.session?.executionAvailable === false) {
    return null;
  }
  return (
    [...(state.history?.runs.flatMap((run) => run.items) ?? [])]
      .reverse()
      .find((item) => item.type === 'user_message')?.itemId ?? null
  );
}
