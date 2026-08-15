import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ChatMessage } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import { api } from '@/services/api-client';

const captured = vi.hoisted(() => ({
  onEvent: null as null | ((event: AgentStreamEvent) => void),
}));

vi.mock('@/services/api-client', () => ({
  api: {
    listSessions: vi.fn(),
    createSession: vi.fn(),
    getMessages: vi.fn(),
    getSessionState: vi.fn(),
    prompt: vi.fn(),
    abortSession: vi.fn(),
    setThinkingLevel: vi.fn(),
  },
}));

vi.mock('@/services/event-stream', () => ({
  subscribeEvents: vi.fn((_sessionId: string, onEvent: (event: AgentStreamEvent) => void) => {
    captured.onEvent = onEvent;
    return () => {
      captured.onEvent = null;
    };
  }),
}));

const sessionState: AgentSessionState = {
  isRunning: false,
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'low', 'medium', 'high'],
};

const assistantMessage: ChatMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: '你好呀' }],
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'claude-a',
  usage: {
    input: 1,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 2,
};

/** @returns 页面渲染结果 */
function renderChatPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/sessions/session-a']}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.onEvent = null;
  vi.mocked(api.listSessions).mockResolvedValue([
    {
      id: 'session-a',
      title: '新对话',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
      isRunning: false,
    },
  ]);
  vi.mocked(api.createSession).mockResolvedValue({ sessionId: 'session-b' });
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.getSessionState).mockResolvedValue(sessionState);
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.abortSession).mockResolvedValue(undefined);
  vi.mocked(api.setThinkingLevel).mockResolvedValue({ ...sessionState, thinkingLevel: 'high' });
});

describe('ChatPage', () => {
  it('为会话侧栏提供可访问的宽度调整分隔条', async () => {
    renderChatPage();

    expect(await screen.findByRole('separator', { name: '调整侧栏宽度' })).toBeInTheDocument();
  });

  it('渲染侧边栏、结构化历史和 Markdown 文本', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      { role: 'user', content: '你好', timestamp: 1 },
      assistantMessage,
    ]);
    renderChatPage();
    expect(await screen.findByRole('navigation', { name: '会话列表' })).toBeInTheDocument();
    expect(await screen.findByText('你好')).toBeInTheDocument();
    expect(await screen.findByText('你好呀')).toBeInTheDocument();
    expect(screen.getByText(/anthropic \/ claude-a/)).toBeInTheDocument();
  });

  it('空态示例建议可填入输入框', async () => {
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '总结今天的重要新闻' }));
    expect(screen.getByPlaceholderText('输入消息')).toHaveValue('总结今天的重要新闻');
  });

  it('发送、中止和思考等级操作都携带当前 session id', async () => {
    renderChatPage();
    const input = screen.getByPlaceholderText('输入消息');
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.type(input, '今天天气如何');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(api.prompt).toHaveBeenCalledWith('session-a', '今天天气如何'));

    act(() => captured.onEvent!({ type: 'agent_start' }));
    await userEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(api.abortSession).toHaveBeenCalledWith('session-a');

    act(() => captured.onEvent!({ type: 'agent_settled' }));
    const selector = await screen.findByRole('combobox', { name: '思考等级' });
    await userEvent.selectOptions(selector, 'high');
    expect(api.setThinkingLevel).toHaveBeenCalledWith('session-a', 'high');
  });

  it('新对话直接创建持久化会话并导航', async () => {
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '新对话' }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith('session-b'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('切换会话时保留侧边栏列表且不重新显示加载状态', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: 'session-a',
        title: '新对话',
        createdAt: 2,
        updatedAt: 2,
        messageCount: 0,
        isRunning: false,
      },
      {
        id: 'session-b',
        title: '新对话',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 0,
        isRunning: false,
      },
    ]);
    renderChatPage();
    const navigation = await screen.findByRole('navigation', { name: '会话列表' });
    await waitFor(() => expect(within(navigation).getAllByRole('button')).toHaveLength(2));
    vi.mocked(api.listSessions).mockImplementation(() => new Promise(() => {}));

    await userEvent.click(within(navigation).getAllByRole('button')[1]!);
    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith('session-b'));

    const currentNavigation = screen.getByRole('navigation', { name: '会话列表' });
    const sessionButtons = within(currentNavigation).getAllByRole('button');
    expect(sessionButtons).toHaveLength(2);
    expect(sessionButtons[1]).toHaveAttribute('aria-current', 'page');
    expect(currentNavigation.querySelector('.animate-spin')).toBeNull();
  });

  it('SSE 结构化消息事件会进入当前对话记录', async () => {
    renderChatPage();
    await waitFor(() => expect(captured.onEvent).not.toBeNull());
    act(() => {
      captured.onEvent!({
        type: 'message_end',
        message: { role: 'user', content: '你好', timestamp: 1 },
      });
      captured.onEvent!({ type: 'message_start', message: { ...assistantMessage, content: [] } });
      captured.onEvent!({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
      });
      captured.onEvent!({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '嗨' },
      });
    });
    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.getByText('嗨')).toBeInTheDocument();
  });
});
