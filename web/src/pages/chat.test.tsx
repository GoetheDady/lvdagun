import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HubEvent } from '@lvdagun/backend';

import { api } from '@/lib/api';
import ChatPage from '@/pages/chat';

function renderChatPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>
  );
}

/** 渲染并等待历史加载、事件订阅就绪(推送事件前必须调用) */
async function renderChatPageReady(): Promise<void> {
  renderChatPage();
  await waitFor(() => {
    expect(captured.onEvent).not.toBeNull();
  });
}

/** subscribeEvents 捕获的回调:测试用它模拟服务端推送事件 */
const captured = vi.hoisted(() => ({ onEvent: null as null | ((event: HubEvent) => void) }));

vi.mock('@/lib/api', () => ({
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
  initTokenFromUrl: vi.fn(),
  subscribeEvents: vi.fn((onEvent: (event: HubEvent) => void) => {
    captured.onEvent = onEvent;
    return () => {
      captured.onEvent = null;
    };
  }),
}));

function pushEvent(event: HubEvent): void {
  act(() => {
    captured.onEvent!(event);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.onEvent = null;
  vi.mocked(api.getMessages).mockResolvedValue([]);
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.clearSession).mockResolvedValue(undefined);
});

describe('ChatPage', () => {
  it('挂载后加载并显示历史消息', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      { id: 'u1', role: 'user', text: '你好' },
      { id: 'a1', role: 'assistant', text: '你好呀' },
    ]);
    renderChatPage();
    await screen.findByText('你好');
    expect(screen.getByText('你好呀')).toBeInTheDocument();
  });

  it('发送消息:调用 prompt,输入框清空', async () => {
    renderChatPage();
    const input = screen.getByPlaceholderText(/输入消息/);
    await userEvent.type(input, '今天天气如何');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(api.prompt).toHaveBeenCalledWith('今天天气如何');
    });
    expect(input).toHaveValue('');
  });

  it('SSE 事件流:用户消息进列表,AI 回复流式累积并在结束时定稿', async () => {
    await renderChatPageReady();

    pushEvent({ type: 'user_message', message: { id: 'u1', role: 'user', text: '你好' } });
    expect(screen.getByText('你好')).toBeInTheDocument();

    pushEvent({ type: 'assistant_message_start', messageId: 'a1' });
    pushEvent({ type: 'assistant_text_delta', messageId: 'a1', delta: '你' });
    pushEvent({ type: 'assistant_text_delta', messageId: 'a1', delta: '好' });
    // 流式中:用户气泡 + 流式气泡各有一份「你好」
    expect(screen.getAllByText('你好')).toHaveLength(2);

    pushEvent({ type: 'assistant_message_end', message: { id: 'a1', role: 'assistant', text: '你好' } });
    // 定稿后流式占位(带闪烁光标)消失,两条消息都在列表里
    expect(screen.getAllByText('你好')).toHaveLength(2);
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('session_cleared 清空消息列表', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      { id: 'u1', role: 'user', text: '旧消息' },
    ]);
    await renderChatPageReady();
    await screen.findByText('旧消息');

    pushEvent({ type: 'session_cleared' });
    expect(screen.queryByText('旧消息')).not.toBeInTheDocument();
  });

  it('error 事件显示错误提示', async () => {
    await renderChatPageReady();
    pushEvent({ type: 'error', message: '模型响应失败', retryable: true });
    expect(screen.getByText('模型响应失败')).toBeInTheDocument();
  });

  it('error 可重试时显示重试按钮,点击重发最后一条用户消息', async () => {
    await renderChatPageReady();
    pushEvent({ type: 'user_message', message: { id: 'u1', role: 'user', text: '你好' } });
    pushEvent({ type: 'error', message: '模型响应失败', retryable: true });

    await userEvent.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => {
      expect(api.prompt).toHaveBeenCalledWith('你好');
    });
  });

  it('AI 消息中的 ``` 代码块渲染为深色等宽块', async () => {
    await renderChatPageReady();
    pushEvent({
      type: 'assistant_message_start',
      messageId: 'a1',
    });
    pushEvent({
      type: 'assistant_message_end',
      message: { id: 'a1', role: 'assistant', text: '如下:\n```\nconsole.log(1)\n```' },
    });
    const code = screen.getByText('console.log(1)');
    expect(code.tagName).toBe('PRE');
    expect(code.className).toContain('font-mono');
  });

  it('空状态展示示例建议,点击填入输入框', async () => {
    renderChatPage();
    const suggestion = screen.getByRole('button', { name: '帮我写一个快速排序' });
    await userEvent.click(suggestion);
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue('帮我写一个快速排序');
  });

  it('清空会话:确认后调用 clearSession,取消则不调用', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderChatPage();
    await userEvent.click(screen.getByRole('button', { name: /清空会话/ }));
    await waitFor(() => {
      expect(api.clearSession).toHaveBeenCalled();
    });

    vi.mocked(window.confirm).mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /清空会话/ }));
    expect(api.clearSession).toHaveBeenCalledTimes(1);
  });
});
