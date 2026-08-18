import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ChatMessage } from '@lvdagun/protocol';

import {
  applyAssistantUpdate,
  chatReducer,
  initialState,
  type AssistantChatMessage,
  useChatSession,
} from '@/hooks/use-chat-session';

vi.mock('@/services/api-client', () => ({
  api: {
    getMessages: vi.fn(),
    getSessionState: vi.fn(),
    prompt: vi.fn(),
    abortSession: vi.fn(),
    steerPendingMessage: vi.fn(),
    removePendingMessage: vi.fn(),
    takePendingMessages: vi.fn(),
    discardPendingMessages: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionModel: vi.fn(),
  },
}));

vi.mock('@/services/event-stream', () => ({
  subscribeEvents: vi.fn(
    (
      _sessionId: string,
      onEvent: (event: AgentStreamEvent) => void,
      onError?: (error: Error) => void
    ) => {
      captured.onEvent = onEvent;
      captured.onError = onError ?? null;
      return () => {
        captured.onEvent = null;
        captured.onError = null;
      };
    }
  ),
}));

const captured = vi.hoisted(() => ({
  onEvent: null as null | ((event: AgentStreamEvent) => void),
  onError: null as null | ((error: Error) => void),
}));

import { api } from '@/services/api-client';

const sessionState: AgentSessionState = {
  sessionName: null,
  isRunning: false,
  activeCompaction: null,
  pendingMessages: [],
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'low', 'medium', 'high'],
  model: {
    provider: 'anthropic',
    providerName: 'Anthropic',
    id: 'claude-a',
    name: 'Claude A',
  },
  availableModels: [
    {
      provider: 'anthropic',
      providerName: 'Anthropic',
      id: 'claude-a',
      name: 'Claude A',
    },
    { provider: 'openai', providerName: 'OpenAI', id: 'gpt-a', name: 'GPT A' },
  ],
  modelWarning: null,
};

/**
 * 构造完整的 Pi 助手消息。
 *
 * @param text - 助手文本
 * @param timestamp - 时间戳
 * @param stopReason - Pi 结束原因
 * @returns 结构化助手消息
 */
function assistantMessage(
  text: string,
  timestamp = 2,
  stopReason: 'stop' | 'aborted' = 'stop'
): AssistantChatMessage {
  return {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-a',
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
    stopReason,
    timestamp,
  };
}

/** 构造最小 AgentSessionState 副本。 */
function stateCopy(overrides: Partial<AgentSessionState> = {}): AgentSessionState {
  return { ...sessionState, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.onEvent = null;
  captured.onError = null;
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.getSessionState).mockResolvedValue(stateCopy());
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.abortSession).mockResolvedValue({ restoredTexts: [] });
  vi.mocked(api.steerPendingMessage).mockResolvedValue(undefined);
  vi.mocked(api.removePendingMessage).mockResolvedValue(undefined);
  vi.mocked(api.takePendingMessages).mockResolvedValue({ texts: [] });
  vi.mocked(api.discardPendingMessages).mockResolvedValue(undefined);
  vi.mocked(api.setThinkingLevel).mockResolvedValue(stateCopy({ thinkingLevel: 'high' }));
  vi.mocked(api.setSessionModel).mockResolvedValue(
    stateCopy({ model: sessionState.availableModels[1]! })
  );
});

describe('chatReducer', () => {
  it('初始状态包含结构化消息和 Pi 会话状态', () => {
    expect(initialState.messages).toEqual([]);
    expect(initialState.activeAssistant).toBeNull();
    expect(initialState.loading).toBe(true);
    expect(initialState.retries).toEqual([]);
    expect(initialState.unavailableReason).toBeNull();
  });

  it.each([
    [{ type: 'session_archived', sessionId: 'session-a' } as const, 'archived'],
    [{ type: 'session_deleted', sessionId: 'session-a' } as const, 'missing'],
  ])('生命周期事件 %s 清除会话内容', (event, unavailableReason) => {
    const state = chatReducer(
      {
        ...initialState,
        loading: false,
        messages: [{ role: 'user', content: '敏感内容', timestamp: 1 }],
        session: stateCopy(),
      },
      { type: 'pi_event', event }
    );

    expect(state.messages).toEqual([]);
    expect(state.session).toBeNull();
    expect(state.unavailableReason).toBe(unavailableReason);
  });

  it('初始化时恢复服务端仍在进行的自动压缩', () => {
    const state = chatReducer(initialState, {
      type: 'initialized',
      messages: [],
      session: stateCopy({
        isRunning: true,
        activeCompaction: { reason: 'threshold' },
      }),
    });

    expect(state.isRunning).toBe(true);
    expect(state.compaction).toEqual({ status: 'running', reason: 'threshold' });
  });

  it('用 SSE 初始快照覆盖 HTTP 初始化期间过期的会话状态', () => {
    const stale = chatReducer(initialState, {
      type: 'initialized',
      messages: [],
      session: sessionState,
    });
    const current = stateCopy({ model: sessionState.availableModels[1]! });

    const state = chatReducer(stale, {
      type: 'pi_event',
      event: { type: 'session_state', state: current },
      receivedAt: 1,
    });

    expect(state.session).toBe(current);
  });

  it('用 Pi 标题变化事件更新当前会话标题', () => {
    const initialized = chatReducer(initialState, {
      type: 'initialized',
      messages: [],
      session: sessionState,
    });

    const state = chatReducer(initialized, {
      type: 'pi_event',
      event: { type: 'session_info_changed', name: '自动生成的标题' },
    });

    expect(state.session?.sessionName).toBe('自动生成的标题');
  });

  it('用驴打滚事件同步权威待处理消息', () => {
    const initialized = chatReducer(initialState, {
      type: 'initialized',
      messages: [],
      session: sessionState,
    });

    const state = chatReducer(initialized, {
      type: 'pi_event',
      event: {
        type: 'pending_messages_changed',
        pendingMessages: [{ id: 'pending-a', text: '继续检查测试' }],
      },
    });

    expect(state.session?.pendingMessages).toEqual([{ id: 'pending-a', text: '继续检查测试' }]);
  });

  it('message_start/update/end 完整归并文本增量', () => {
    const start = assistantMessage('', 2);
    let state = chatReducer(initialState, {
      type: 'pi_event',
      event: { type: 'message_start', message: start },
    });
    state = chatReducer(state, {
      type: 'pi_event',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
      },
    });
    state = chatReducer(state, {
      type: 'pi_event',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你好' },
      },
    });
    expect(state.activeAssistant?.content).toEqual([{ type: 'text', text: '你好' }]);

    const final = assistantMessage('你好', 2);
    state = chatReducer(state, {
      type: 'pi_event',
      event: { type: 'message_end', message: final },
    });
    expect(state.activeAssistant).toBeNull();
    expect(state.messages).toEqual([final]);
  });

  it('thinking 和工具事件保留结构化内容并按 toolCallId 合并结果', () => {
    const start = assistantMessage('', 2);
    let state = chatReducer(initialState, {
      type: 'pi_event',
      event: { type: 'message_start', message: start },
    });
    state = chatReducer(state, {
      type: 'pi_event',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 },
      },
    });
    state = chatReducer(state, {
      type: 'pi_event',
      event: {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: '先分析',
        },
      },
    });
    expect(state.activeAssistant?.content).toEqual([{ type: 'thinking', thinking: '先分析' }]);

    const toolCall = {
      type: 'toolCall' as const,
      id: 'call-1',
      name: 'read',
      arguments: { path: 'README.md' },
    };
    state = chatReducer(state, {
      type: 'pi_event',
      event: {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
      },
    });
    expect(state.toolRuns['call-1']?.status).toBe('running');
    const final = { ...assistantMessage('', 2), content: [toolCall] };
    state = chatReducer(state, {
      type: 'pi_event',
      event: { type: 'message_end', message: final },
    });
    const result: ChatMessage = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text', text: '内容' }],
      details: {},
      isError: false,
      timestamp: 3,
    };
    state = chatReducer(state, {
      type: 'pi_event',
      event: { type: 'message_end', message: result },
    });
    expect(state.toolRuns['call-1']).toMatchObject({ status: 'success', result });
    expect(state.messages).toEqual([final, result]);
  });

  it('保留重试记录并在压缩完成后显示状态', () => {
    let state = chatReducer(initialState, {
      type: 'pi_event',
      receivedAt: 1000,
      event: {
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 2,
        delayMs: 5000,
        errorMessage: '限流',
      },
    });
    state = chatReducer(state, {
      type: 'pi_event',
      event: { type: 'auto_retry_end', success: true, attempt: 1 },
    });
    expect(state.retries[0]).toMatchObject({ status: 'success', errorMessage: '限流' });
    state = chatReducer(state, {
      type: 'pi_event',
      event: { type: 'compaction_start', reason: 'threshold' },
    });
    expect(state.compaction).toEqual({ status: 'running', reason: 'threshold' });
    state = chatReducer(state, {
      type: 'pi_event',
      event: {
        type: 'compaction_end',
        reason: 'threshold',
        result: {
          summary: '摘要',
          firstKeptEntryId: 'entry-1',
          tokensBefore: 100,
          estimatedTokensAfter: 20,
        },
        aborted: false,
        willRetry: false,
      },
    });
    expect(state.compaction).toEqual({ status: 'success', reason: 'threshold' });
  });

  it('中止的回复保留 aborted 结构化消息', () => {
    const message = assistantMessage('部分内容', 2, 'aborted');
    const state = chatReducer(initialState, {
      type: 'pi_event',
      event: { type: 'message_end', message },
    });
    expect(state.messages[0]).toMatchObject({ stopReason: 'aborted' });
  });

  it('Pi 原生增量转换不会把累计 partial 带入客户端事件', () => {
    const message = assistantMessage('', 2);
    const update = {
      type: 'text_delta' as const,
      contentIndex: 0,
      delta: '你',
    };
    expect(applyAssistantUpdate(message, update).content).toEqual([{ type: 'text', text: '你' }]);
  });
});

describe('useChatSession', () => {
  it('历史和状态加载后再订阅 Pi SSE', async () => {
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(captured.onEvent).not.toBeNull());
    expect(result.current.state.loading).toBe(false);
  });

  it('发送失败后保留可重试错误', async () => {
    vi.mocked(api.prompt).mockRejectedValue(new Error('请求失败'));
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(captured.onEvent).not.toBeNull());
    await act(async () => result.current.send('你好'));
    expect(result.current.state.error).toEqual({ message: '请求失败', retryable: true });
  });

  it('运行中发送默认排队，模型设置仍锁定且 stop 调用 Pi abort', async () => {
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(captured.onEvent).not.toBeNull());
    act(() => captured.onEvent!({ type: 'agent_start' }));
    await act(async () => result.current.send('插队消息'));
    expect(api.prompt).toHaveBeenCalledWith('session-a', '插队消息');
    await act(async () => result.current.setThinkingLevel('high'));
    await act(async () => result.current.setModel({ provider: 'openai', id: 'gpt-a' }));
    expect(api.setThinkingLevel).not.toHaveBeenCalled();
    expect(api.setSessionModel).not.toHaveBeenCalled();
    await act(async () => result.current.abort());
    expect(api.abortSession).toHaveBeenCalledWith('session-a');
  });

  it('自动压缩完成后重新读取包含摘要的展示历史', async () => {
    const summary: ChatMessage = {
      role: 'compactionSummary',
      summary: '压缩摘要',
      tokensBefore: 100,
      timestamp: 2,
    };
    vi.mocked(api.getMessages).mockResolvedValueOnce([]).mockResolvedValueOnce([summary]);
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(captured.onEvent).not.toBeNull());

    act(() => {
      captured.onEvent!({ type: 'compaction_start', reason: 'threshold' });
      captured.onEvent!({
        type: 'compaction_end',
        reason: 'threshold',
        result: {
          summary: '压缩摘要',
          firstKeptEntryId: 'entry-1',
          tokensBefore: 100,
          estimatedTokensAfter: 20,
        },
        aborted: false,
        willRetry: false,
      });
    });

    await waitFor(() => expect(result.current.state.messages).toEqual([summary]));
    expect(result.current.state.compaction).toBeNull();
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it('重试最后一条用户消息，并按会话设置思考等级', async () => {
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(captured.onEvent).not.toBeNull());
    const message: ChatMessage = { role: 'user', content: '你好', timestamp: 1 };
    act(() => captured.onEvent!({ type: 'message_end', message }));
    act(() => result.current.retry());
    await waitFor(() => expect(api.prompt).toHaveBeenCalledWith('session-a', '你好'));
    await act(async () => result.current.setThinkingLevel('high'));
    expect(api.setThinkingLevel).toHaveBeenCalledWith('session-a', 'high');
  });

  it('切换会话模型并接受其他客户端广播的模型状态', async () => {
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(captured.onEvent).not.toBeNull());

    await act(async () => result.current.setModel({ provider: 'openai', id: 'gpt-a' }));
    expect(api.setSessionModel).toHaveBeenCalledWith('session-a', {
      provider: 'openai',
      id: 'gpt-a',
    });
    expect(result.current.state.session?.model.id).toBe('gpt-a');

    act(() =>
      captured.onEvent!({
        type: 'session_model_changed',
        state: stateCopy({ model: sessionState.availableModels[0]! }),
      })
    );
    expect(result.current.state.session?.model.id).toBe('claude-a');
  });
});
