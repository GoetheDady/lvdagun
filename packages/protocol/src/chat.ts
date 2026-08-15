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

/** 侧边栏展示的持久化会话摘要 */
export interface SessionSummary {
  /** 不透明会话标识，不暴露本机会话文件路径 */
  id: string;
  /** 当前展示标题；自动标题功能接入前固定为“新对话” */
  title: string;
  /** 会话创建时间，Unix 毫秒时间戳 */
  createdAt: number;
  /** 最后一条消息更新时间，Unix 毫秒时间戳 */
  updatedAt: number;
  /** Pi 会话文件中的消息条目数量 */
  messageCount: number;
  /** 该会话的 Agent 是否正在运行 */
  isRunning: boolean;
}

/** 创建持久化会话后的资源标识 */
export interface CreateSessionResult {
  sessionId: string;
}

export type { ThinkingLevel };
