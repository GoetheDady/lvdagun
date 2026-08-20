import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ProductSessionHistory } from '@lvdagun/protocol';

import { useChatSession } from '@/hooks/use-chat-session';
import { chatReducer, initialState } from '@/state/chat-session-state';

const captured = vi.hoisted(() => ({
  onEvent: null as null | ((event: AgentStreamEvent) => void),
}));

vi.mock('@/services/session-events', () => ({
  subscribeEvents: vi.fn((_id: string, onEvent: (event: AgentStreamEvent) => void) => {
    captured.onEvent = onEvent;
    queueMicrotask(() => onEvent(snapshot()));
    return () => {
      captured.onEvent = null;
    };
  }),
}));

vi.mock('@/services/api-client', () => ({
  api: {
    getMessages: vi.fn(),
    prompt: vi.fn(),
    forkSession: vi.fn(),
    editAndResend: vi.fn(),
    abortSession: vi.fn(),
    steerPendingMessage: vi.fn(),
    removePendingMessage: vi.fn(),
    takePendingMessages: vi.fn(),
    discardPendingMessages: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionModel: vi.fn(),
  },
}));

import { api } from '@/services/api-client';

const state: AgentSessionState = {
  sessionName: null,
  executionAvailable: true,
  isRunning: false,
  activeCompaction: null,
  pendingMessages: [],
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'medium', 'high'],
  model: { provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' },
  availableModels: [{ provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' }],
  modelWarning: null,
};

/** @param revision - 历史 revision @returns 空产品历史 */
function history(revision = 0): ProductSessionHistory {
  return {
    schemaVersion: 1,
    sessionId: 'session-a',
    branchId: 'branch-a',
    revision,
    runs: [],
    draft: null,
    blobs: {},
  };
}

/** @returns 会话快照 */
function snapshot(): AgentStreamEvent {
  return { type: 'session_snapshot', history: history(), state };
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.onEvent = null;
  vi.mocked(api.getMessages).mockResolvedValue(history());
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.forkSession).mockResolvedValue({ sessionId: 'fork-a' });
  vi.mocked(api.editAndResend).mockResolvedValue({ history: history(2) });
  vi.mocked(api.abortSession).mockResolvedValue({ restoredTexts: [] });
  vi.mocked(api.takePendingMessages).mockResolvedValue({ texts: [] });
});

describe('chatReducer', () => {
  it('用产品快照原子恢复历史与状态', () => {
    const next = chatReducer(initialState, { type: 'product_event', event: snapshot() });
    expect(next.history).toEqual(history());
    expect(next.session).toEqual(state);
    expect(next.synchronized).toBe(true);
  });

  it('只在 revision 一致时应用瞬时草稿', () => {
    const current = { ...initialState, history: history(2) };
    const stale = chatReducer(current, {
      type: 'product_event',
      event: { type: 'session_draft_changed', revision: 1, draft: null },
    });
    expect(stale).toBe(current);
  });

  it('归档事件清除产品历史', () => {
    const next = chatReducer(
      { ...initialState, history: history(), session: state },
      { type: 'product_event', event: { type: 'session_archived', sessionId: 'session-a' } }
    );
    expect(next.history).toBeNull();
    expect(next.unavailableReason).toBe('archived');
  });
});

describe('useChatSession', () => {
  it('发送、分叉和编辑使用产品标识', async () => {
    const { result } = renderHook(() => useChatSession('session-a'));
    await waitFor(() => expect(result.current.state.synchronized).toBe(true));

    await act(async () => {
      expect(await result.current.send('你好')).toBe(true);
      expect(await result.current.forkSession('run-a')).toBe('fork-a');
      expect(await result.current.editAndResend('item-a', '修改')).toBe(true);
    });

    expect(api.prompt).toHaveBeenCalledWith('session-a', '你好');
    expect(api.forkSession).toHaveBeenCalledWith('session-a', 'run-a');
    expect(api.editAndResend).toHaveBeenCalledWith('session-a', 'item-a', '修改');
  });
});
