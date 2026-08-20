import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ProductSessionHistory } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import { api } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
  api: {
    listSessions: vi.fn(), createSession: vi.fn(), archiveSession: vi.fn(), deleteSession: vi.fn(),
    setSessionTitle: vi.fn(), getMessages: vi.fn(), prompt: vi.fn(), forkSession: vi.fn(),
    editAndResend: vi.fn(), abortSession: vi.fn(), steerPendingMessage: vi.fn(),
    removePendingMessage: vi.fn(), takePendingMessages: vi.fn(), discardPendingMessages: vi.fn(),
    setThinkingLevel: vi.fn(), setSessionModel: vi.fn(),
  },
}));

vi.mock('@/services/session-events', () => ({
  subscribeEvents: vi.fn((sessionId: string, onEvent: (event: AgentStreamEvent) => void) => {
    queueMicrotask(async () => onEvent({ type: 'session_snapshot', history: await api.getMessages(sessionId), state }));
    return vi.fn();
  }),
}));

const state: AgentSessionState = {
  sessionName: null, executionAvailable: true, isRunning: false, activeCompaction: null, pendingMessages: [],
  thinkingLevel: 'medium', availableThinkingLevels: ['off', 'medium'],
  model: { provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' },
  availableModels: [{ provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' }],
  modelWarning: null,
};

/** @returns 含重试和多个模型片段的产品历史 */
function history(): ProductSessionHistory {
  return {
    schemaVersion: 1, sessionId: 'session-a', branchId: 'branch-a', revision: 5, blobs: {}, draft: null,
    runs: [{
      runId: 'run-a', status: 'completed', acceptedAt: 1, startedAt: 2, settledAt: 10,
      items: [
        { type: 'user_message', itemId: 'user-a', runId: 'run-a', createdAt: 1, text: '帮我检查' },
        { type: 'assistant_segment', itemId: 'segment-a', runId: 'run-a', createdAt: 2, status: 'completed', content: [{ type: 'text', text: '这是已经生成的第一段。' }] },
        { type: 'assistant_segment', itemId: 'segment-hidden', runId: 'run-a', createdAt: 3, status: 'superseded', content: [{ type: 'text', text: '这段不应该显示' }] },
        { type: 'retry', itemId: 'retry-a', runId: 'run-a', createdAt: 4, kind: 'model', attempt: 1, maxAttempts: 3, errorMessage: '连接中断', status: 'success' },
        { type: 'assistant_segment', itemId: 'segment-b', runId: 'run-a', createdAt: 5, status: 'completed', content: [{ type: 'text', text: '接着上面已经生成的继续生成' }] },
      ],
    }],
  };
}

/** @returns 页面渲染结果 */
function renderPage() {
  return render(<MemoryRouter initialEntries={['/sessions/session-a']}><Routes><Route path="/sessions/:sessionId" element={<ChatPage />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn() } });
  vi.mocked(api.listSessions).mockResolvedValue([{ id: 'session-a', title: '检查', createdAt: 1, updatedAt: 10, messageCount: 3, isRunning: false }]);
  vi.mocked(api.getMessages).mockResolvedValue(history());
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.forkSession).mockResolvedValue({ sessionId: 'fork-a' });
  vi.mocked(api.editAndResend).mockResolvedValue({ history: history() });
  vi.mocked(api.abortSession).mockResolvedValue({ restoredTexts: [] });
  vi.mocked(api.takePendingMessages).mockResolvedValue({ texts: [] });
});

describe('ChatPage 产品历史投影', () => {
  it('按原位置显示重试并隐藏被取代片段', async () => {
    renderPage();
    expect(await screen.findByText('这是已经生成的第一段。')).toBeInTheDocument();
    expect(screen.getByText('第 1 次重试成功')).toBeInTheDocument();
    expect(screen.getByText('接着上面已经生成的继续生成')).toBeInTheDocument();
    expect(screen.queryByText('这段不应该显示')).not.toBeInTheDocument();
  });

  it('整条助手回复只显示一组复制和分叉操作', async () => {
    renderPage();
    await screen.findByText('接着上面已经生成的继续生成');
    expect(screen.getAllByTitle('复制回复')).toHaveLength(1);
    expect(screen.getAllByTitle('分叉为新会话')).toHaveLength(1);
  });

  it('编辑用户消息使用产品 itemId', async () => {
    const user = userEvent.setup();
    renderPage();
    const edit = await screen.findByTitle('编辑并重发');
    await user.click(edit);
    const textarea = screen.getByRole('textbox', { name: '编辑用户消息' });
    await user.clear(textarea);
    await user.type(textarea, '修改后的问题');
    await user.click(screen.getByTitle('发送编辑后的消息'));
    expect(api.editAndResend).toHaveBeenCalledWith('session-a', 'user-a', '修改后的问题');
  });
});
