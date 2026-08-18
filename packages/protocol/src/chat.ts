import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { JsonAgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { AvailableModel } from './model.ts';

/** 会话模型变更后由 Hub 广播的完整状态 */
export interface SessionModelChangedEvent {
  /** 驴打滚会话模型变更事件 */
  type: 'session_model_changed';
  /** 变更后的权威会话状态 */
  state: AgentSessionState;
}

/** SSE 建连后用于校准 HTTP 初始化竞态的权威会话快照 */
export interface SessionStateEvent {
  /** 会话事件流的初始状态 */
  type: 'session_state';
  /** 建立订阅时的权威会话状态 */
  state: AgentSessionState;
}

/** 会话归档后由 Hub 广播的生命周期事件 */
export interface SessionArchivedEvent {
  /** 当前会话已归档，不再允许通过普通会话接口访问 */
  type: 'session_archived';
  /** 生命周期发生变化的不透明会话标识 */
  sessionId: string;
}

/** 会话永久删除后由 Hub 广播的生命周期事件 */
export interface SessionDeletedEvent {
  /** 当前会话及其本地数据已永久删除 */
  type: 'session_deleted';
  /** 生命周期发生变化的不透明会话标识 */
  sessionId: string;
}

/** Agent 运行期间由驴打滚等待移交的用户消息 */
export interface PendingMessage {
  /** Runtime 内稳定且唯一的消息标识 */
  id: string;
  /** 用户提交的纯文本 */
  text: string;
}

/** 待处理消息集合变化后由 Hub 广播的权威快照 */
export interface PendingMessagesChangedEvent {
  /** 驴打滚待处理消息变化事件 */
  type: 'pending_messages_changed';
  /** 当前会话中尚未移交给 Pi 的全部消息 */
  pendingMessages: PendingMessage[];
}

/** SSE 传输的 Pi JSON 事件与驴打滚会话状态事件 */
export type AgentStreamEvent =
  | JsonAgentSessionEvent
  | SessionModelChangedEvent
  | SessionStateEvent
  | SessionArchivedEvent
  | SessionDeletedEvent
  | PendingMessagesChangedEvent;

/** Pi 会话中的结构化消息 */
export type ChatMessage = AgentMessage;

/** Pi 上下文压缩的触发原因 */
export type CompactionReason = Extract<AgentStreamEvent, { type: 'compaction_start' }>['reason'];

/** 当前仍在进行的上下文压缩 */
export interface ActiveCompaction {
  /** 手动触发、阈值触发或上下文溢出恢复 */
  reason: CompactionReason;
}

/** Pi 当前会话的运行与思考等级状态 */
export interface AgentSessionState {
  /** Pi 持久化的会话标题；尚未设置时为 null */
  sessionName: string | null;
  /** Agent 是否仍在运行、重试、压缩或处理排队任务 */
  isRunning: boolean;
  /** 客户端重连时用于恢复压缩状态；没有压缩时为 null */
  activeCompaction: ActiveCompaction | null;
  /** 尚未移交给 Pi 的待处理消息 */
  pendingMessages: PendingMessage[];
  /** 当前实际思考等级 */
  thinkingLevel: ThinkingLevel;
  /** 当前模型支持的思考等级 */
  availableThinkingLevels: ThinkingLevel[];
  /** 当前会话后续 Agent 运行使用的模型 */
  model: AvailableModel;
  /** Agent Hub 当前具有有效凭据的全部模型 */
  availableModels: AvailableModel[];
  /** 恢复会话模型失败时的非阻塞警告 */
  modelWarning: string | null;
}

/** 侧边栏展示的持久化会话摘要 */
export interface SessionSummary {
  /** 不透明会话标识，不暴露本机会话文件路径 */
  id: string;
  /** 当前展示标题，依次取 Pi 持久化标题、首条用户消息和“新对话” */
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

/** 停止 Agent 后应恢复到发起客户端草稿的文本 */
export interface AbortSessionResult {
  /** 包含 Pi 临时队列与驴打滚待处理区中的未处理文本 */
  restoredTexts: string[];
}

/** 取回全部待处理消息后的文本结果 */
export interface TakePendingMessagesResult {
  /** 按原排队顺序返回的文本 */
  texts: string[];
}

export type { ThinkingLevel };
