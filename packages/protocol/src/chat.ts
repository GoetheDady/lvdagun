import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent';

/** SSE 传输的 Pi JSON 会话事件 */
export type AgentStreamEvent = JsonAgentSessionEvent;

/** Pi 会话中的结构化消息 */
export type ChatMessage = AgentMessage;

/** Pi 当前会话的运行与思考等级状态 */
export interface AgentSessionState {
  /** Agent 是否仍在运行、重试、压缩或处理排队任务 */
  isRunning: boolean;
  /** 当前实际思考等级 */
  thinkingLevel: ThinkingLevel;
  /** 当前模型支持的思考等级 */
  availableThinkingLevels: ThinkingLevel[];
}

export type { ThinkingLevel };
