import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ProductSessionHistory } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import NewSessionPage from '@/pages/new-session-page';
import { api } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
  api: {
    listSessions: vi.fn(),
    createSession: vi.fn(),
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
    setSessionTitle: vi.fn(),
    getMessages: vi.fn(),
    getSessionState: vi.fn(),
    prompt: vi.fn(),
    forkSession: vi.fn(),
    editAndResend: vi.fn(),
    abortSession: vi.fn(),
    steerPendingMessage: vi.fn(),
    removePendingMessage: vi.fn(),
    takePendingMessages: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionModel: vi.fn(),
    listAvailableModels: vi.fn(),
    getConfig: vi.fn(),
  },
}));

vi.mock('@/services/session-events', () => ({
  subscribeEvents: vi.fn((sessionId: string, onEvent: (event: AgentStreamEvent) => void) => {
    queueMicrotask(async () =>
      onEvent({ type: 'session_snapshot', history: await api.getMessages(sessionId), state })
    );
    return vi.fn();
  }),
}));

const state: AgentSessionState = {
  sessionName: null,
  executionAvailable: true,
  isRunning: false,
  activeCompaction: null,
  pendingMessages: [],
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'medium'],
  model: { provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' },
  availableModels: [{ provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' }],
  modelWarning: null,
};

/** @returns 无消息的产品历史 */
function emptyHistory(sessionId: string): ProductSessionHistory {
  return {
    schemaVersion: 1,
    sessionId,
    branchId: 'branch-a',
    revision: 0,
    runs: [],
    draft: null,
    blobs: {},
    executionPlan: null,
  };
}

/** @returns 草稿页与聊天页共同挂载的路由 */
function renderPage(initialPath = '/sessions/new', chatElement = <ChatPage />): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/sessions/new" element={<NewSessionPage />} />
        <Route path="/sessions/:sessionId" element={chatElement} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listSessions).mockResolvedValue([]);
  vi.mocked(api.getMessages).mockImplementation((sessionId: string) =>
    Promise.resolve(emptyHistory(sessionId))
  );
  vi.mocked(api.getSessionState).mockResolvedValue(state);
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.listAvailableModels).mockResolvedValue([
    { provider: 'openai', providerName: 'OpenAI', id: 'gpt', name: 'GPT' },
  ]);
  vi.mocked(api.getConfig).mockResolvedValue({
    providers: [{ provider: 'openai', apiKey: 'k' }],
    defaultModel: { provider: 'openai', id: 'gpt' },
  });
});

describe('NewSessionPage 草稿态', () => {
  it('进入草稿页不调用创建接口', async () => {
    renderPage();

    await screen.findByRole('heading', { name: '新对话' });
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('提交时以默认模型创建会话、发出首条提示并跳转', async () => {
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: 'session-a' });
    renderPage();

    await screen.findByRole('heading', { name: '新对话' });
    await userEvent.type(screen.getByPlaceholderText('输入消息'), '你好');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(api.createSession).toHaveBeenCalledWith({
        model: { provider: 'openai', id: 'gpt' },
      });
      expect(api.prompt).toHaveBeenCalledWith('session-a', '你好');
    });
  });

  it('首条提示完成后等停靠动画播完再跳转', async () => {
    let resolvePrompt: (() => void) | undefined;
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: 'session-a' });
    vi.mocked(api.prompt).mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePrompt = () => resolve();
      })
    );
    const user = userEvent.setup();
    renderPage('/sessions/new', <div>chat</div>);

    await user.type(screen.getByPlaceholderText('输入消息'), '你好');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(api.prompt).toHaveBeenCalledWith('session-a', '你好'));
    expect(screen.getByPlaceholderText('输入消息')).toHaveFocus();
    // 提示未完成前绝不跳转
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
    await act(async () => {
      resolvePrompt?.();
    });
    // 停靠动画播完（350ms 余量）后路由才切换
    await screen.findByText('chat', {}, { timeout: 2000 });
  });

  it('提示发送失败时保留会话，重试只补发不重复创建', async () => {
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: 'session-a' });
    vi.mocked(api.prompt).mockRejectedValueOnce(new Error('Agent 正在运行'));
    renderPage();

    await screen.findByRole('heading', { name: '新对话' });
    await userEvent.type(screen.getByPlaceholderText('输入消息'), '你好');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await screen.findByText('Agent 正在运行');
    expect(screen.getByPlaceholderText('输入消息')).toHaveValue('你好');

    vi.mocked(api.prompt).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(api.prompt).toHaveBeenLastCalledWith('session-a', '你好');
    });
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });

  it('创建失败时显示错误并保留输入', async () => {
    vi.mocked(api.createSession).mockRejectedValue(new Error('Agent 正在运行'));
    renderPage();

    await screen.findByRole('heading', { name: '新对话' });
    await userEvent.type(screen.getByPlaceholderText('输入消息'), '你好');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await screen.findByText('Agent 正在运行');
    expect(screen.getByPlaceholderText('输入消息')).toHaveValue('你好');
  });
});
