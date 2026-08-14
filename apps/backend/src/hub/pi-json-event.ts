import type { AgentSessionEvent, JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent';

/**
 * 按 Pi JSON/RPC 线协议精简进程内会话事件。
 *
 * Pi 0.84.1 没有从包入口导出官方 `toJsonEvent`,因此在边界处复现同一结构化转换:
 * `message_update` 只保留增量事件并移除累计快照,其余事件保持原样。
 *
 * @param event - Pi 进程内会话事件
 * @returns 可通过 SSE 发送的 Pi JSON 事件
 */
export function toJsonAgentEvent(event: AgentSessionEvent): JsonAgentSessionEvent {
  if (event.type !== 'message_update') {
    return event;
  }
  const assistantMessageEvent = event.assistantMessageEvent;
  if (!('partial' in assistantMessageEvent)) {
    return { type: 'message_update', assistantMessageEvent };
  }
  const { partial, ...deltaEvent } = assistantMessageEvent;
  void partial;
  return { type: 'message_update', assistantMessageEvent: deltaEvent };
}
