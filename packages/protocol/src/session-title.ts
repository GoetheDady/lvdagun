/** 默认会话标题。 */
export const DEFAULT_SESSION_TITLE = '新对话';

/** 会话标题投影所需的候选来源。 */
export interface SessionTitleSources {
  /** Pi 持久化名称，可能来自手动重命名或自动标题。 */
  sessionName?: string | null;
  /** 当前分支首条用户消息。 */
  firstUserMessage?: string | null;
  /** 已由服务端投影过的标题，用于客户端快照尚未包含消息时兜底。 */
  fallbackTitle?: string | null;
}

/**
 * 按统一优先级投影用户可见的会话标题。
 *
 * @param sources - 持久化名称、首条用户消息和可选兜底标题
 * @returns 去除首尾空白后的会话标题
 */
export function resolveSessionTitle(sources: SessionTitleSources): string {
  return (
    sources.sessionName?.trim() ||
    sources.firstUserMessage?.trim() ||
    sources.fallbackTitle?.trim() ||
    DEFAULT_SESSION_TITLE
  );
}

/**
 * 从源会话展示标题生成派生会话标题。
 *
 * @param sourceTitle - 已按统一优先级投影的源会话标题
 * @returns 带分叉后缀的派生会话标题
 */
export function createForkSessionTitle(sourceTitle: string): string {
  return `${sourceTitle}（分叉）`;
}
