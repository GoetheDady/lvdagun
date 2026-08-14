import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HubEvent } from '@lvdagun/backend';

import { api } from '@/lib/api';
import ChatPage from '@/pages/chat';

/**
 * DOM 冒烟:只测 UI 专属行为(渲染、输入交互、确认弹窗)。
 * 会话语义(事件翻译、发送/重试/清空、竞态)全部在 tests/chat-session.test.ts 直测。
 */
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
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.clearSession).mockResolvedValue(undefined);
});

describe('ChatPage DOM 冒烟', () => {
  it('渲染:历史气泡、代码块、空态示例建议点击填入', async () => {
    vi.mocked(api.getMessages).mockResolvedValue([
      { id: 'u1', role: 'user', text: '你好' },
      { id: 'a1', role: 'assistant', text: '如下:\n```\nconsole.log(1)\n```' },
    ]);
    renderChatPage();

    // 历史气泡
    await screen.findByText('你好');
    // 代码块:深色等宽块
    const code = screen.getByText('console.log(1)');
    expect(code.tagName).toBe('PRE');
    expect(code.className).toContain('font-mono');
  });

  it('渲染:空态示例建议点击填入输入框', async () => {
    renderChatPage();
    const suggestion = screen.getByRole('button', { name: '帮我写一个快速排序' });
    await userEvent.click(suggestion);
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue('帮我写一个快速排序');
  });

  it('发消息:调用 prompt,输入框清空', async () => {
    renderChatPage();
    const input = screen.getByPlaceholderText(/输入消息/);
    await userEvent.type(input, '今天天气如何');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(api.prompt).toHaveBeenCalledWith('今天天气如何');
    });
    expect(input).toHaveValue('');
  });

  it('清空会话:确认弹窗放行才调用 clearSession', async () => {
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

  it('SSE 事件渲染:用户消息与流式文本经事件流呈现', async () => {
    renderChatPage();
    await waitFor(() => {
      expect(captured.onEvent).not.toBeNull();
    });
    act(() => {
      captured.onEvent!({ type: 'user_message', message: { id: 'u1', role: 'user', text: '你好' } });
      captured.onEvent!({ type: 'assistant_message_start', messageId: 'a1' });
      captured.onEvent!({ type: 'assistant_text_delta', messageId: 'a1', delta: '嗨' });
    });
    expect(screen.getAllByText('你好')).toHaveLength(1);
    expect(screen.getByText('嗨')).toBeInTheDocument();
  });
});
