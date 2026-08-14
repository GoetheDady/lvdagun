import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ChatMessage } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import { api } from '@/services/api-client';

const captured = vi.hoisted(() => ({
  onEvent: null as null | ((event: AgentStreamEvent) => void),
}));

vi.mock('@/services/api-client', () => ({
  api: {
    getMessages: vi.fn(),
    getSessionState: vi.fn(),
    prompt: vi.fn(),
    newSession: vi.fn(),
    abortSession: vi.fn(),
    setThinkingLevel: vi.fn(),
  },
}));

vi.mock('@/services/event-stream', () => ({
  subscribeEvents: vi.fn((onEvent: (event: AgentStreamEvent) => void) => {
    captured.onEvent = onEvent;
    return () => {
      captured.onEvent = null;
    };
  }),
}));

/** 构造页面使用的 Pi 状态。 */
const sessionState: AgentSessionState = {
  isRunning: false,
  thinkingLevel: 'medium',
  availableThinkingLevels: ['off', 'low', 'medium', 'high'],
};

/** 构造页面测试用助手消息。 */
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

function renderChatPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.onEvent = null;
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.getSessionState).mockResolvedValue(sessionState);
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.newSession).mockResolvedValue(undefined);
  vi.mocked(api.abortSession).mockResolvedValue(undefined);
  vi.mocked(api.setThinkingLevel).mockResolvedValue({ ...sessionState, thinkingLevel: 'high' });
});

describe('ChatPage', () => {
  it('渲染结构化历史和 Markdown 文本', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      { role: 'user', content: '你好', timestamp: 1 },
      assistantMessage,
    ]);
    renderChatPage();
    expect(await screen.findByText('你好')).toBeInTheDocument();
    expect(await screen.findByText('你好呀')).toBeInTheDocument();
    expect(screen.getByText(/anthropic \/ claude-a/)).toBeInTheDocument();
  });

  it('空态示例建议可填入输入框', async () => {
    renderChatPage();
    await userEvent.click(
      await screen.findByRole('button', { name: '总结今天的重要新闻' })
    );
    expect(screen.getByPlaceholderText('输入消息')).toHaveValue('总结今天的重要新闻');
  });

  it('发送调用 Pi prompt，停止调用 Pi abort', async () => {
    renderChatPage();
    const input = screen.getByPlaceholderText('输入消息');
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.type(input, '今天天气如何');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(api.prompt).toHaveBeenCalledWith('今天天气如何'));
    expect(input).toHaveValue('');

    act(() => captured.onEvent!({ type: 'agent_start' }));
    await userEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(api.abortSession).toHaveBeenCalledTimes(1);
  });

  it('新对话使用确认对话框，确认后只调用 Pi newSession', async () => {
    renderChatPage();
    await userEvent.click(screen.getByRole('button', { name: /新对话/ }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('开始新对话？')).toBeInTheDocument();
    expect(api.newSession).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.newSession).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await userEvent.click(screen.getByRole('button', { name: '开始新对话' }));
    await waitFor(() => expect(api.newSession).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /新对话/ })).toBeEnabled();

    act(() => captured.onEvent!({ type: 'agent_start' }));
    expect(screen.getByRole('button', { name: /新对话/ })).toBeDisabled();
  });

  it('思考等级使用 Pi 提供的可用选项', async () => {
    renderChatPage();
    const selector = await screen.findByRole('combobox', { name: '思考等级' });
    await userEvent.selectOptions(selector, 'high');
    expect(api.setThinkingLevel).toHaveBeenCalledWith('high');
  });

  it('SSE 结构化消息事件会进入对话记录', async () => {
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
