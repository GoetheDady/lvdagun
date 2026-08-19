import { resolveSessionTitle, type ChatMessage, type SessionMessage } from '@lvdagun/protocol';

import type { ChatSessionState, ToolResultChatMessage } from '@/state/chat-session-state';

/**
 * 投影当前工作区标题，复用服务端会话列表的同一优先级规则。
 *
 * @param state - 客户端会话语义状态
 * @param fallbackTitle - 侧边栏已经投影出的标题
 * @returns 当前工作区与浏览器标签使用的标题
 */
export function selectSessionTitle(state: ChatSessionState, fallbackTitle?: string): string {
  return resolveSessionTitle({
    sessionName: state.session?.sessionName,
    firstUserMessage: selectFirstUserMessageText(state.messages),
    fallbackTitle,
  });
}

/**
 * 选择当前允许编辑的最后一条用户消息。
 *
 * @param state - 客户端会话语义状态
 * @returns Pi 稳定条目标识；运行中、断线或没有用户消息时返回 null
 */
export function selectEditableUserEntryId(state: ChatSessionState): string | null {
  if (state.isRunning || !state.synchronized) return null;
  return (
    [...state.messages].reverse().find(({ message }) => message.role === 'user')?.entryId ?? null
  );
}

/** @param messages - 当前分支历史 @returns 首条用户消息中的纯文本 */
function selectFirstUserMessageText(messages: SessionMessage[]): string {
  const message = messages.find(({ message }) => message.role === 'user')?.message;
  return message?.role === 'user' ? getUserMessageText(message) : '';
}

/** @param messages - 当前分支历史 @returns 按 toolCallId 索引的工具结果 */
export function indexToolResults(messages: SessionMessage[]): Map<string, ToolResultChatMessage> {
  return new Map(
    messages
      .map(({ message }) => message)
      .filter((message): message is ToolResultChatMessage => message.role === 'toolResult')
      .map((message) => [message.toolCallId, message])
  );
}

/** @param messages - 当前分支历史 @returns 已在助手消息中出现的工具调用标识 */
export function selectPairedToolCallIds(messages: SessionMessage[]): Set<string> {
  return new Set(
    messages.flatMap(({ message }) =>
      message.role === 'assistant'
        ? message.content
            .filter((content) => content.type === 'toolCall')
            .map((content) => content.id)
        : []
    )
  );
}

/** @param message - Pi 用户消息 @returns 所有文本块拼接后的纯文本 */
function getUserMessageText(message: Extract<ChatMessage, { role: 'user' }>): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n');
}
