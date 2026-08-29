import { resolveSessionTitle } from '@lvdagun/protocol';

import type { ChatSessionState } from '@/state/chat-session-state';

export interface RunMarkerState {
  runId: string | null;
  text: string;
}

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

/** @param state - 会话状态 @returns 当前 Agent 运行的瞬时标记 */
export function selectRunMarker(state: ChatSessionState): RunMarkerState | null {
  const run = state.history?.runs.at(-1);
  const active = run?.status === 'accepted' || run?.status === 'running';

  if (!active) {
    if (state.aborting) return { runId: null, text: '正在停止' };
    if (state.sending) return { runId: null, text: '正在准备回复' };
    return state.isRunning ? { runId: null, text: '正在处理' } : null;
  }

  if (state.aborting) return { runId: run.runId, text: '正在停止' };
  if (
    run.items.some(
      (item) => item.type === 'retry' && (item.status === 'waiting' || item.status === 'retrying')
    )
  ) {
    return { runId: run.runId, text: '正在重试' };
  }
  if (run.items.some((item) => item.type === 'compaction' && item.status === 'running')) {
    return { runId: run.runId, text: '正在压缩上下文' };
  }

  const draft = state.history?.draft?.runId === run.runId ? state.history.draft : null;
  const runningTools = draft?.tools.filter((tool) => tool.status === 'running') ?? [];
  if (runningTools.some((tool) => tool.toolName === 'todo')) {
    return { runId: run.runId, text: '正在更新执行计划' };
  }
  if (runningTools.length > 0) return { runId: run.runId, text: '正在使用工具' };

  const lastBlock = draft?.activeSegment?.content.at(-1);
  if (lastBlock?.type === 'thinking') return { runId: run.runId, text: '正在思考' };
  if (lastBlock?.type === 'text') return { runId: run.runId, text: '正在生成回复' };
  if (run.status === 'accepted' || run.startedAt === null) {
    return { runId: run.runId, text: '正在准备回复' };
  }
  return { runId: run.runId, text: '正在处理' };
}
