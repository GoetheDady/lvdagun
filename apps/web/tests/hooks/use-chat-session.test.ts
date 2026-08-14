import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, HubEvent } from '@lvdagun/protocol';

import { chatReducer, initialState, useChatSession } from '@/hooks/use-chat-session';

vi.mock('@/services/api-client', () => ({
  api: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    testConnection: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
    getMessages: vi.fn(),
    prompt: vi.fn(),
    clearSession: vi.fn(),
  },
}));

vi.mock('@/services/event-stream', () => ({
  subscribeEvents: vi.fn((onEvent: (event: HubEvent) => void, onError?: (error: Error) => void) => {
    captured.onEvent = onEvent;
    captured.onError = onError ?? null;
    return () => {
      captured.onEvent = null;
      captured.onError = null;
    };
  }),
}));

const captured = vi.hoisted(() => ({
  onEvent: null as null | ((event: HubEvent) => void),
  onError: null as null | ((error: Error) => void),
}));

import { api } from '@/services/api-client';

const userMessage = (id: string, text: string): ChatMessage => ({ id, role: 'user', text });
const assistantMessage = (id: string, text: string): ChatMessage => ({
  id,
  role: 'assistant',
  text,
});

beforeEach(() => {
  vi.clearAllMocks();
  captured.onEvent = null;
  captured.onError = null;
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.clearSession).mockResolvedValue(undefined);
});

describe('chatReducer', () => {
  it('初始状态:空列表、无流式、无错误', () => {
    expect(initialState).toEqual({
      messages: [],
      pending: '',
      streaming: false,
      error: null,
      sending: false,
    });
  });

  it('history_loaded 装载历史消息', () => {
    const history = [userMessage('u1', '旧消息')];
    expect(
      chatReducer(initialState, { type: 'history_loaded', messages: history }).messages
    ).toEqual(history);
  });

  it('hub_event:user_message 追加到列表', () => {
    const state = chatReducer(initialState, {
      type: 'hub_event',
      event: { type: 'user_message', message: userMessage('u1', '你好') },
    });
    expect(state.messages).toEqual([userMessage('u1', '你好')]);
  });

  it('hub_event:流式三连 — start 清空占位、delta 累积、end 定稿', () => {
    let state = chatReducer(
      { ...initialState, error: { message: '旧错误', retryable: true } },
      { type: 'hub_event', event: { type: 'assistant_message_start', messageId: 'a1' } }
    );
    expect(state.streaming).toBe(true);
    expect(state.pending).toBe('');
    // start 清掉旧错误
    expect(state.error).toBeNull();

    state = chatReducer(state, {
      type: 'hub_event',
      event: { type: 'assistant_text_delta', messageId: 'a1', delta: '你' },
    });
    state = chatReducer(state, {
      type: 'hub_event',
      event: { type: 'assistant_text_delta', messageId: 'a1', delta: '好' },
    });
    expect(state.pending).toBe('你好');

    state = chatReducer(state, {
      type: 'hub_event',
      event: { type: 'assistant_message_end', message: assistantMessage('a1', '你好') },
    });
    expect(state.streaming).toBe(false);
    expect(state.pending).toBe('');
    expect(state.messages).toEqual([assistantMessage('a1', '你好')]);
  });

  it('hub_event:session_cleared 清空消息并复位流式', () => {
    const before = chatReducer(initialState, {
      type: 'hub_event',
      event: { type: 'assistant_message_start', messageId: 'a1' },
    });
    const state = chatReducer(
      { ...before, messages: [userMessage('u1', '你好')], pending: '你' },
      { type: 'hub_event', event: { type: 'session_cleared' } }
    );
    expect(state.messages).toEqual([]);
    expect(state.streaming).toBe(false);
    expect(state.pending).toBe('');
  });

  it('hub_event:error 记录错误与可重试标记', () => {
    const state = chatReducer(initialState, {
      type: 'hub_event',
      event: { type: 'error', message: '模型响应失败', retryable: true },
    });
    expect(state.error).toEqual({ message: '模型响应失败', retryable: true });
  });

  it('send_started 置发送中并清错误;send_finished 复位', () => {
    const withError = chatReducer(initialState, {
      type: 'hub_event',
      event: { type: 'error', message: 'x', retryable: true },
    });
    const started = chatReducer(withError, { type: 'send_started' });
    expect(started.sending).toBe(true);
    expect(started.error).toBeNull();

    const finished = chatReducer(started, { type: 'send_finished' });
    expect(finished.sending).toBe(false);
  });

  it('send_failed 复位发送中并记录可重试错误', () => {
    const state = chatReducer(
      { ...initialState, sending: true },
      { type: 'send_failed', message: '请求失败' }
    );
    expect(state.sending).toBe(false);
    expect(state.error).toEqual({ message: '请求失败', retryable: true });
  });
});

describe('useChatSession', () => {
  it('先拉历史、后订阅事件(事件订阅在历史落地之后)', async () => {
    let resolveHistory!: (messages: ChatMessage[]) => void;
    vi.mocked(api.getMessages).mockReturnValue(
      new Promise((resolve) => (resolveHistory = resolve))
    );

    renderHook(() => useChatSession());

    // 历史未返回时不允许订阅:否则 history_loaded 会覆盖已到事件
    expect(captured.onEvent).toBeNull();

    await act(async () => {
      resolveHistory([userMessage('u1', '旧消息')]);
    });
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
  });

  it('历史加载失败按空历史处理,事件流照常工作', async () => {
    vi.mocked(api.getMessages).mockRejectedValue(new Error('服务不可用'));
    renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
  });

  it('send 调用 api.prompt', async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    await act(async () => {
      await result.current.send('你好');
    });
    expect(api.prompt).toHaveBeenCalledWith('你好');
  });

  it('send 失败后 error 可重试', async () => {
    vi.mocked(api.prompt).mockRejectedValue(new Error('请求失败'));
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    await act(async () => {
      await result.current.send('你好');
    });
    expect(result.current.error).toEqual({ message: '请求失败', retryable: true });
  });

  it('流式输出中 send 直接忽略(守卫:同一时刻只允许一条在途消息)', async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    act(() => {
      captured.onEvent!({ type: 'assistant_message_start', messageId: 'a1' });
    });
    await act(async () => {
      await result.current.send('插队消息');
    });
    expect(api.prompt).not.toHaveBeenCalled();
  });

  it('retry 重发最后一条用户消息', async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    act(() => {
      captured.onEvent!({ type: 'user_message', message: userMessage('u1', '你好') });
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(api.prompt).toHaveBeenCalledWith('你好');
    });
  });

  it('事件流驱动状态:start/delta/end 完整走一遍', async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    act(() => {
      captured.onEvent!({ type: 'assistant_message_start', messageId: 'a1' });
      captured.onEvent!({ type: 'assistant_text_delta', messageId: 'a1', delta: '你' });
      captured.onEvent!({ type: 'assistant_message_end', message: assistantMessage('a1', '你') });
    });
    expect(result.current.messages).toEqual([assistantMessage('a1', '你')]);
    expect(result.current.streaming).toBe(false);
  });

  it('clear 调用 api.clearSession', async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    act(() => {
      result.current.clear();
    });
    expect(api.clearSession).toHaveBeenCalled();
  });
});
