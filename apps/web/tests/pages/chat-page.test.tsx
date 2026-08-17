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
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
    setSessionTitle: vi.fn(),
    getMessages: vi.fn(),
    getSessionState: vi.fn(),
    prompt: vi.fn(),
    abortSession: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionModel: vi.fn(),
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
  sessionName: null,
  isRunning: false,
  activeCompaction: null,
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
  vi.mocked(api.archiveSession).mockResolvedValue(undefined);
  vi.mocked(api.deleteSession).mockResolvedValue(undefined);
  vi.mocked(api.setSessionTitle).mockResolvedValue(undefined);
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.getSessionState).mockResolvedValue(sessionState);
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.abortSession).mockResolvedValue(undefined);
  vi.mocked(api.setThinkingLevel).mockResolvedValue({ ...sessionState, thinkingLevel: 'high' });
  vi.mocked(api.setSessionModel).mockResolvedValue({
    ...sessionState,
    model: sessionState.availableModels[1]!,
  });
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

  it('把历史压缩摘要渲染为有名称的会话分隔线', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      { role: 'user', content: '压缩前', timestamp: 1 },
      { role: 'compactionSummary', summary: '此前对话摘要', tokensBefore: 100, timestamp: 2 },
      { role: 'user', content: '压缩后', timestamp: 3 },
    ]);
    renderChatPage();

    const separator = await screen.findByRole('separator', { name: '压缩成功' });
    expect(separator).toHaveTextContent('压缩成功');
    expect(separator.querySelectorAll('.h-px.bg-border')).toHaveLength(2);
  });

  it('当前轮压缩成功后显示会话分隔线', async () => {
    renderChatPage();
    await waitFor(() => expect(captured.onEvent).not.toBeNull());

    act(() => {
      captured.onEvent!({ type: 'compaction_start', reason: 'threshold' });
      captured.onEvent!({
        type: 'compaction_end',
        reason: 'threshold',
        result: {
          summary: '当前轮摘要',
          tokensBefore: 100,
          firstKeptEntryId: 'entry-a',
        },
        aborted: false,
        willRetry: true,
      });
    });

    expect(screen.getByRole('separator', { name: '压缩成功' })).toBeInTheDocument();
  });

  it('空态示例建议可填入输入框', async () => {
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '总结今天的重要新闻' }));
    expect(screen.getByPlaceholderText('输入消息')).toHaveValue('总结今天的重要新闻');
  });

  it('在统一输入区搜索并切换会话模型且保留草稿', async () => {
    renderChatPage();
    const composer = await screen.findByRole('group', { name: '消息输入区' });
    const input = within(composer).getByPlaceholderText('输入消息');
    await userEvent.type(input, '保留这段草稿');

    await userEvent.click(within(composer).getByRole('button', { name: /模型.*Claude A/ }));
    await userEvent.type(screen.getByPlaceholderText('搜索模型'), 'gpt');
    await userEvent.click(screen.getByRole('option', { name: /GPT A.*gpt-a/ }));

    expect(api.setSessionModel).toHaveBeenCalledWith('session-a', {
      provider: 'openai',
      id: 'gpt-a',
    });
    expect(input).toHaveValue('保留这段草稿');
    expect(within(composer).getByRole('slider', { name: '思考等级' })).toBeInTheDocument();
    expect(within(composer).getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('通过离散滑块提交当前模型支持的思考等级', async () => {
    renderChatPage();

    const slider = await screen.findByRole('slider', { name: '思考等级' });
    expect(slider).toHaveAttribute('aria-valuetext', '中');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(api.setThinkingLevel).toHaveBeenCalledTimes(1);
    expect(api.setThinkingLevel).toHaveBeenCalledWith('session-a', 'high');
  });

  it('提交思考等级期间保留预览并禁用滑块', async () => {
    let resolveThinkingLevel!: (state: AgentSessionState) => void;
    vi.mocked(api.setThinkingLevel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveThinkingLevel = resolve;
        })
    );
    renderChatPage();

    const slider = await screen.findByRole('slider', { name: '思考等级' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');

    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'true'));
    expect(slider).toHaveAttribute('aria-valuetext', '高');

    act(() => resolveThinkingLevel({ ...sessionState, thinkingLevel: 'high' }));
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'));
    expect(slider).toHaveAttribute('aria-valuetext', '高');
  });

  it('思考等级提交失败后回退到服务端权威状态', async () => {
    vi.mocked(api.setThinkingLevel).mockRejectedValueOnce(new Error('思考等级更新失败'));
    renderChatPage();

    const slider = await screen.findByRole('slider', { name: '思考等级' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(await screen.findByText('思考等级更新失败')).toBeInTheDocument();
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuetext', '中'));
    expect(slider).toHaveAttribute('aria-disabled', 'false');
  });

  it('通过 SSE 同步其他客户端修改的思考等级', async () => {
    renderChatPage();
    const slider = await screen.findByRole('slider', { name: '思考等级' });
    await waitFor(() => expect(captured.onEvent).not.toBeNull());

    act(() => captured.onEvent!({ type: 'thinking_level_changed', level: 'high' }));

    expect(slider).toHaveAttribute('aria-valuetext', '高');
    expect(api.setThinkingLevel).not.toHaveBeenCalled();
  });

  it('通过 Pi 名称事件即时更新页面标题', async () => {
    renderChatPage();
    await waitFor(() => expect(captured.onEvent).not.toBeNull());

    act(() => captured.onEvent!({ type: 'session_info_changed', name: '自动生成的会话标题' }));

    expect(screen.getByRole('heading', { name: '自动生成的会话标题' })).toBeInTheDocument();
    expect(document.title).toBe('自动生成的会话标题 - 驴打滚');
  });

  it('模型 SSE 更新会清除旧模型的思考等级预览', async () => {
    let resolveThinkingLevel!: (state: AgentSessionState) => void;
    vi.mocked(api.setThinkingLevel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveThinkingLevel = resolve;
        })
    );
    renderChatPage();

    const slider = await screen.findByRole('slider', { name: '思考等级' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuetext', '高');

    const changedSession = {
      ...sessionState,
      model: sessionState.availableModels[1]!,
    };
    act(() => captured.onEvent!({ type: 'session_model_changed', state: changedSession }));

    const updatedSlider = screen.getByRole('slider', { name: '思考等级' });
    expect(updatedSlider).toHaveAttribute('aria-valuetext', '中');

    act(() => resolveThinkingLevel(changedSession));
    await waitFor(() => expect(updatedSlider).toHaveAttribute('aria-disabled', 'false'));
  });

  it('只有关闭等级时保留并禁用思考等级滑块', async () => {
    vi.mocked(api.getSessionState).mockResolvedValue({
      ...sessionState,
      thinkingLevel: 'off',
      availableThinkingLevels: ['off'],
    });
    renderChatPage();

    const slider = await screen.findByRole('slider', { name: '思考等级' });
    expect(slider).toHaveAttribute('aria-valuetext', '关闭');
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('关闭')).toBeInTheDocument();
  });

  it('发送和中止操作都携带当前 session id', async () => {
    renderChatPage();
    const input = screen.getByPlaceholderText('输入消息');
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.type(input, '今天天气如何');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(api.prompt).toHaveBeenCalledWith('session-a', '今天天气如何'));

    act(() => captured.onEvent!({ type: 'agent_start' }));
    await userEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(api.abortSession).toHaveBeenCalledWith('session-a');
  });

  it('刷新时恢复自动压缩状态并允许停止压缩', async () => {
    vi.mocked(api.getSessionState).mockResolvedValue({
      ...sessionState,
      isRunning: true,
      activeCompaction: { reason: 'threshold' },
    });
    renderChatPage();

    expect(await screen.findByText('压缩中')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('正在压缩上下文')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '思考等级' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: '停止压缩' }));
    expect(api.abortSession).toHaveBeenCalledWith('session-a');
  });

  it('新对话直接创建持久化会话并导航', async () => {
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '新对话' }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith('session-b'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('从会话菜单手动重命名并立即更新侧栏', async () => {
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：新对话' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '会话标题' });
    await userEvent.clear(input);
    await userEvent.type(input, '手动设置的标题');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(api.setSessionTitle).toHaveBeenCalledWith('session-a', '手动设置的标题')
    );
    expect(await screen.findByRole('button', { name: '打开会话：手动设置的标题' })).toBeVisible();
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
    await waitFor(() =>
      expect(within(navigation).getAllByRole('button', { name: /打开会话：新对话/ })).toHaveLength(
        2
      )
    );
    vi.mocked(api.listSessions).mockImplementation(() => new Promise(() => {}));

    await userEvent.click(
      within(navigation).getAllByRole('button', { name: /打开会话：新对话/ })[1]!
    );
    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith('session-b'));

    const currentNavigation = screen.getByRole('navigation', { name: '会话列表' });
    const sessionButtons = within(currentNavigation).getAllByRole('button', {
      name: /打开会话：新对话/,
    });
    expect(sessionButtons).toHaveLength(2);
    expect(sessionButtons[1]).toHaveAttribute('aria-current', 'page');
    expect(currentNavigation.querySelector('.animate-spin')).toBeNull();
  });

  it('通过会话三点菜单直接归档并显示归档空状态', async () => {
    vi.mocked(api.archiveSession).mockImplementation(async () => {
      vi.mocked(api.listSessions).mockResolvedValue([]);
    });
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：新对话' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '归档' }));

    await waitFor(() => expect(api.archiveSession).toHaveBeenCalledWith('session-a'));
    act(() => captured.onEvent?.({ type: 'session_archived', sessionId: 'session-a' }));
    expect(await screen.findByRole('heading', { name: '当前会话已归档' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole('navigation', { name: '会话列表' })).queryByRole('button', {
          name: /打开会话：新对话/,
        })
      ).not.toBeInTheDocument()
    );
  });

  it('删除会话前二次确认，确认后显示不可用空状态', async () => {
    vi.mocked(api.deleteSession).mockImplementation(async () => {
      vi.mocked(api.listSessions).mockResolvedValue([]);
    });
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：新对话' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '删除' }));

    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText('此操作将永久删除会话及其全部消息，无法撤销。')
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith('session-a'));
    act(() => captured.onEvent?.({ type: 'session_deleted', sessionId: 'session-a' }));
    expect(
      await screen.findByRole('heading', { name: '当前会话不存在或不可显示' })
    ).toBeInTheDocument();
  });

  it('运行中的会话禁用归档和删除', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: 'session-a',
        title: '新对话',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 0,
        isRunning: true,
      },
    ]);
    renderChatPage();
    await userEvent.click(await screen.findByRole('button', { name: '更多操作：新对话' }));

    expect(screen.getByRole('menuitem', { name: '归档' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveAttribute('aria-disabled', 'true');
  });

  it.each([
    [410, '当前会话已归档'],
    [404, '当前会话不存在或不可显示'],
  ])('初始化返回 %s 时显示对应不可用状态', async (status, heading) => {
    vi.mocked(api.getMessages).mockRejectedValueOnce(
      Object.assign(new Error('会话不可用'), { status })
    );
    renderChatPage();

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
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
