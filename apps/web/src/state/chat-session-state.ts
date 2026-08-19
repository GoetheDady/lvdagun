import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  CompactionReason,
  SessionMessage,
} from '@lvdagun/protocol';

export type AssistantChatMessage = Extract<ChatMessage, { role: 'assistant' }>;
export type ToolResultChatMessage = Extract<ChatMessage, { role: 'toolResult' }>;
type AssistantUpdate = Extract<
  AgentStreamEvent,
  { type: 'message_update' }
>['assistantMessageEvent'];

/** 对话操作错误。 */
interface ChatError {
  /** 面向用户的错误说明 */
  message: string;
}

/** 单次工具调用的实时状态。 */
export interface ToolRunState {
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError: boolean;
  status: 'running' | 'success' | 'error';
}

/** Pi 自动重试在界面中的保留记录。 */
export interface RetryRecord {
  id: number;
  kind: 'model' | 'summarization';
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
  deadlineAt: number;
  status: 'waiting' | 'retrying' | 'success' | 'error';
}

/** Pi 上下文压缩的临时状态。 */
export interface CompactionState {
  status: 'running' | 'success' | 'aborted' | 'error';
  reason: CompactionReason;
  message?: string;
}

/** 当前 URL 指向的会话无法继续显示的原因。 */
export type SessionUnavailableReason = 'archived' | 'missing';

/** 对话会话的完整客户端状态。 */
export interface ChatSessionState {
  messages: SessionMessage[];
  activeAssistant: AssistantChatMessage | null;
  toolRuns: Record<string, ToolRunState>;
  retries: RetryRecord[];
  compaction: CompactionState | null;
  session: AgentSessionState | null;
  isRunning: boolean;
  loading: boolean;
  sending: boolean;
  aborting: boolean;
  settingThinkingLevel: boolean;
  settingModel: boolean;
  unavailableReason: SessionUnavailableReason | null;
  /** 是否已经用当前 SSE 连接的权威快照校准页面 */
  synchronized: boolean;
  /** 断线超过一秒后是否显示重连提示 */
  showReconnectNotice: boolean;
  error: ChatError | null;
}

/** 尚未连接本地服务时的对话初始状态。 */
export const initialState: ChatSessionState = {
  messages: [],
  activeAssistant: null,
  toolRuns: {},
  retries: [],
  compaction: null,
  session: null,
  isRunning: false,
  loading: true,
  sending: false,
  aborting: false,
  settingThinkingLevel: false,
  settingModel: false,
  unavailableReason: null,
  synchronized: false,
  showReconnectNotice: false,
  error: null,
};

/** 会话状态机接受的动作。 */
export type ChatSessionAction =
  | { type: 'history_loaded'; messages: SessionMessage[] }
  | { type: 'pi_event'; event: AgentStreamEvent; receivedAt?: number }
  | { type: 'send_started' }
  | { type: 'send_finished' }
  | { type: 'abort_started' }
  | { type: 'abort_finished' }
  | { type: 'thinking_level_started' }
  | { type: 'thinking_level_finished'; session: AgentSessionState }
  | { type: 'model_started' }
  | { type: 'model_finished'; session: AgentSessionState }
  | { type: 'connection_lost' }
  | { type: 'connection_notice' }
  | { type: 'operation_failed'; message: string };

/**
 * 把未知错误转换为统一的操作失败动作。
 *
 * @param error - 捕获到的未知错误
 * @returns 对话状态机可处理的失败动作
 */
export function operationFailedAction(error: unknown): ChatSessionAction {
  return {
    type: 'operation_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 将 Pi 用户消息内容提取为纯文本。
 *
 * @param message - Pi 结构化消息
 * @returns 消息中的所有文本块；非用户消息或没有文本时返回空字符串
 */
function getMessageText(message: ChatMessage): string {
  if (message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter(
      (content): content is Extract<(typeof message.content)[number], { type: 'text' }> =>
        content.type === 'text'
    )
    .map((content) => content.text)
    .join('\n');
}

/**
 * 把 Pi 的助手增量应用到当前结构化消息。
 *
 * @param message - `message_start` 提供的助手消息骨架
 * @param update - Pi JSON 流中的单次内容更新
 * @returns 应用更新后的新助手消息
 */
export function applyAssistantUpdate(
  message: AssistantChatMessage,
  update: AssistantUpdate
): AssistantChatMessage {
  if (update.type === 'done') {
    return update.message;
  }
  if (update.type === 'error') {
    return update.error;
  }
  if (update.type === 'start') {
    return message;
  }

  const content = [...message.content];
  switch (update.type) {
    case 'text_start':
      content[update.contentIndex] = { type: 'text', text: '' };
      break;
    case 'text_delta': {
      const current = content[update.contentIndex];
      const text = current?.type === 'text' ? current.text : '';
      content[update.contentIndex] = { type: 'text', text: text + update.delta };
      break;
    }
    case 'text_end':
      content[update.contentIndex] = { type: 'text', text: update.content };
      break;
    case 'thinking_start':
      content[update.contentIndex] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta': {
      const current = content[update.contentIndex];
      const thinking = current?.type === 'thinking' ? current.thinking : '';
      content[update.contentIndex] = {
        type: 'thinking',
        thinking: thinking + update.delta,
      };
      break;
    }
    case 'thinking_end':
      content[update.contentIndex] = { type: 'thinking', thinking: update.content };
      break;
    case 'toolcall_start':
    case 'toolcall_delta':
      break;
    case 'toolcall_end':
      content[update.contentIndex] = update.toolCall;
      break;
  }
  return { ...message, content };
}

/**
 * 更新最近一条仍在进行的重试记录。
 *
 * @param retries - 现有重试记录
 * @param update - 对目标记录执行的更新
 * @returns 更新后的重试记录数组
 */
function updateLatestRetry(
  retries: RetryRecord[],
  update: (record: RetryRecord) => RetryRecord
): RetryRecord[] {
  let index = -1;
  for (let recordIndex = retries.length - 1; recordIndex >= 0; recordIndex -= 1) {
    const record = retries[recordIndex];
    if (record?.status === 'waiting' || record?.status === 'retrying') {
      index = recordIndex;
      break;
    }
  }
  if (index < 0) {
    return retries;
  }
  return retries.map((record, recordIndex) => (recordIndex === index ? update(record) : record));
}

/**
 * 从快照中的最后一条助手消息恢复尚未取得结果的工具运行。
 *
 * @param messages - 当前分支完整历史
 * @param activeAssistant - 当前仍在生成的助手消息
 * @param isRunning - Agent 是否仍在运行
 * @returns 可继续由实时工具事件更新的运行状态
 */
function getSnapshotToolRuns(
  messages: SessionMessage[],
  activeAssistant: AssistantChatMessage | null,
  isRunning: boolean
): Record<string, ToolRunState> {
  if (!isRunning) return {};
  const completedIds = new Set(
    messages
      .filter(
        (item): item is SessionMessage & { message: ToolResultChatMessage } =>
          item.message.role === 'toolResult'
      )
      .map((item) => item.message.toolCallId)
  );
  const assistant =
    activeAssistant ??
    [...messages]
      .reverse()
      .find(
        (item): item is SessionMessage & { message: AssistantChatMessage } =>
          item.message.role === 'assistant'
      )?.message;
  if (!assistant) return {};
  return Object.fromEntries(
    assistant.content
      .filter(
        (
          content
        ): content is Extract<AssistantChatMessage['content'][number], { type: 'toolCall' }> =>
          content.type === 'toolCall' && !completedIds.has(content.id)
      )
      .map((content) => [
        content.id,
        {
          toolCallId: content.id,
          toolName: content.name,
          args: content.arguments,
          isError: false,
          status: 'running' as const,
        },
      ])
  );
}

/**
 * 把一条 Pi JSON 会话事件归并进客户端语义状态。
 *
 * 生命周期事件只驱动输入锁定等状态，不会被追加为消息行；消息、工具、重试和压缩事件
 * 分别进入自己的结构，避免把原始事件日志直接暴露给用户。
 *
 * @param state - 当前会话状态
 * @param event - Pi JSON 会话事件
 * @param receivedAt - 浏览器收到事件的时间，用于重试倒计时
 * @returns 归并后的新状态
 */
function reducePiEvent(
  state: ChatSessionState,
  event: AgentStreamEvent,
  receivedAt: number
): ChatSessionState {
  switch (event.type) {
    case 'agent_start':
      return { ...state, isRunning: true, error: null };
    case 'agent_settled':
      return {
        ...state,
        isRunning: false,
        sending: false,
        aborting: false,
        activeAssistant: null,
      };
    case 'message_start':
      return event.message.role === 'assistant'
        ? { ...state, activeAssistant: event.message }
        : state;
    case 'message_update':
      return state.activeAssistant
        ? {
            ...state,
            activeAssistant: applyAssistantUpdate(
              state.activeAssistant,
              event.assistantMessageEvent
            ),
          }
        : state;
    case 'message_end': {
      const toolRuns = { ...state.toolRuns };
      if (event.message.role === 'toolResult') {
        const previous = toolRuns[event.message.toolCallId];
        toolRuns[event.message.toolCallId] = {
          toolCallId: event.message.toolCallId,
          toolName: event.message.toolName,
          args: previous?.args ?? {},
          result: event.message,
          isError: event.message.isError,
          status: event.message.isError ? 'error' : 'success',
        };
      }
      const messageItem: SessionMessage = { entryId: null, message: event.message };
      const lastMessage = state.messages.at(-1);
      const replacesTransientUser =
        event.message.role === 'user' &&
        lastMessage?.entryId === null &&
        lastMessage.message.role === 'user' &&
        getMessageText(lastMessage.message) === getMessageText(event.message);
      return {
        ...state,
        messages: replacesTransientUser
          ? [...state.messages.slice(0, -1), messageItem]
          : [...state.messages, messageItem],
        activeAssistant: event.message.role === 'assistant' ? null : state.activeAssistant,
        toolRuns,
        compaction: event.message.role === 'compactionSummary' ? null : state.compaction,
      };
    }
    case 'tool_execution_start':
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [event.toolCallId]: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            isError: false,
            status: 'running',
          },
        },
      };
    case 'tool_execution_update':
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [event.toolCallId]: {
            ...(state.toolRuns[event.toolCallId] ?? {
              toolCallId: event.toolCallId,
              isError: false,
              status: 'running' as const,
            }),
            toolName: event.toolName,
            args: event.args,
            partialResult: event.partialResult,
          },
        },
      };
    case 'tool_execution_end':
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [event.toolCallId]: {
            ...(state.toolRuns[event.toolCallId] ?? {
              toolCallId: event.toolCallId,
              args: {},
            }),
            toolName: event.toolName,
            result: event.result,
            isError: event.isError,
            status: event.isError ? 'error' : 'success',
          },
        },
      };
    case 'auto_retry_start':
      return {
        ...state,
        isRunning: true,
        retries: [
          ...state.retries,
          {
            id: state.retries.length,
            kind: 'model',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
            deadlineAt: receivedAt + event.delayMs,
            status: 'waiting',
          },
        ],
      };
    case 'auto_retry_end':
      return {
        ...state,
        retries: updateLatestRetry(state.retries, (record) => ({
          ...record,
          attempt: event.attempt,
          errorMessage: event.finalError ?? record.errorMessage,
          status: event.success ? 'success' : 'error',
        })),
      };
    case 'summarization_retry_scheduled':
      return {
        ...state,
        retries: [
          ...state.retries,
          {
            id: state.retries.length,
            kind: 'summarization',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
            deadlineAt: receivedAt + event.delayMs,
            status: 'waiting',
          },
        ],
      };
    case 'summarization_retry_attempt_start':
      return {
        ...state,
        retries: updateLatestRetry(state.retries, (record) => ({
          ...record,
          status: 'retrying',
        })),
      };
    case 'summarization_retry_finished':
      return {
        ...state,
        retries: updateLatestRetry(state.retries, (record) => ({
          ...record,
          status: 'success',
        })),
      };
    case 'compaction_start':
      return {
        ...state,
        isRunning: true,
        compaction: { status: 'running', reason: event.reason },
      };
    case 'compaction_end':
      return {
        ...state,
        compaction: event.aborted
          ? { status: 'aborted', reason: event.reason }
          : event.errorMessage
            ? { status: 'error', reason: event.reason, message: event.errorMessage }
            : { status: 'success', reason: event.reason },
      };
    case 'thinking_level_changed':
      return state.session
        ? { ...state, session: { ...state.session, thinkingLevel: event.level } }
        : state;
    case 'session_model_changed':
      return {
        ...state,
        session: event.state,
        isRunning: event.state.isRunning,
      };
    case 'session_snapshot':
      return {
        ...state,
        messages: event.messages,
        activeAssistant: event.activeAssistant,
        toolRuns: getSnapshotToolRuns(event.messages, event.activeAssistant, event.state.isRunning),
        retries: [],
        compaction: event.state.activeCompaction
          ? { status: 'running', reason: event.state.activeCompaction.reason }
          : null,
        session: event.state,
        isRunning: event.state.isRunning,
        loading: false,
        sending: false,
        settingThinkingLevel: false,
        settingModel: false,
        unavailableReason: null,
        synchronized: true,
        showReconnectNotice: false,
      };
    case 'session_unavailable':
      return unavailableState(state, event.reason);
    case 'session_info_changed':
      return state.session
        ? { ...state, session: { ...state.session, sessionName: event.name ?? null } }
        : state;
    case 'pending_messages_changed':
      return state.session
        ? { ...state, session: { ...state.session, pendingMessages: event.pendingMessages } }
        : state;
    case 'session_history_changed':
      return {
        ...state,
        messages: event.messages,
        toolRuns: {},
        retries: [],
        compaction: null,
      };
    case 'session_archived':
      return unavailableState(state, 'archived');
    case 'session_deleted':
      return unavailableState(state, 'missing');
    case 'agent_end':
    case 'turn_start':
    case 'turn_end':
    case 'queue_update':
    case 'entry_appended':
    case 'bash_execution_update':
      return state;
  }
}

/**
 * 清除不可再访问会话的内容和运行状态。
 *
 * @param state - 当前会话状态
 * @param reason - 会话不可显示的原因
 * @returns 不再暴露原会话内容的空状态
 */
function unavailableState(
  state: ChatSessionState,
  reason: SessionUnavailableReason
): ChatSessionState {
  return {
    ...state,
    messages: [],
    activeAssistant: null,
    toolRuns: {},
    retries: [],
    compaction: null,
    session: null,
    isRunning: false,
    loading: false,
    sending: false,
    aborting: false,
    settingThinkingLevel: false,
    settingModel: false,
    unavailableReason: reason,
    synchronized: false,
    showReconnectNotice: false,
    error: null,
  };
}

/**
 * 对话会话纯状态机。
 *
 * @param state - 当前状态
 * @param action - HTTP、SSE 或界面操作产生的动作
 * @returns 下一状态
 */
export function chatReducer(state: ChatSessionState, action: ChatSessionAction): ChatSessionState {
  switch (action.type) {
    case 'history_loaded':
      return {
        ...state,
        messages: action.messages,
        compaction:
          state.compaction?.status === 'success' &&
          action.messages.some(({ message }) => message.role === 'compactionSummary')
            ? null
            : state.compaction,
      };
    case 'pi_event':
      return reducePiEvent(state, action.event, action.receivedAt ?? Date.now());
    case 'send_started':
      return { ...state, sending: true, error: null };
    case 'send_finished':
      return { ...state, sending: false };
    case 'abort_started':
      return { ...state, aborting: true, error: null };
    case 'abort_finished':
      return { ...state, aborting: false };
    case 'thinking_level_started':
      return { ...state, settingThinkingLevel: true, error: null };
    case 'thinking_level_finished':
      return {
        ...state,
        session: action.session,
        isRunning: action.session.isRunning,
        settingThinkingLevel: false,
      };
    case 'model_started':
      return { ...state, settingModel: true, error: null };
    case 'model_finished':
      return {
        ...state,
        session: action.session,
        isRunning: action.session.isRunning,
        settingModel: false,
      };
    case 'connection_lost':
      return { ...state, synchronized: false };
    case 'connection_notice':
      return state.synchronized ? state : { ...state, showReconnectNotice: true };
    case 'operation_failed':
      return {
        ...state,
        loading: false,
        sending: false,
        aborting: false,
        settingThinkingLevel: false,
        settingModel: false,
        error: { message: action.message },
      };
  }
}
