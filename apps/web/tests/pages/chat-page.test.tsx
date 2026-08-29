import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSessionState, AgentStreamEvent, ProductSessionHistory } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import { api } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
  api: {
    listSessions: vi.fn(),
    createSession: vi.fn(),
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
    setSessionTitle: vi.fn(),
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

/** @returns 含重试和多个模型片段的产品历史 */
function history(): ProductSessionHistory {
  return {
    schemaVersion: 1,
    sessionId: 'session-a',
    branchId: 'branch-a',
    revision: 5,
    blobs: {},
    draft: null,
    executionPlan: null,
    runs: [
      {
        runId: 'run-a',
        status: 'completed',
        acceptedAt: 1,
        startedAt: 2,
        settledAt: 10,
        items: [
          {
            type: 'user_message',
            itemId: 'user-a',
            runId: 'run-a',
            createdAt: 1,
            text: '帮我检查',
          },
          {
            type: 'assistant_segment',
            itemId: 'segment-a',
            runId: 'run-a',
            createdAt: 2,
            status: 'completed',
            content: [{ type: 'text', text: '这是已经生成的第一段。' }],
          },
          {
            type: 'assistant_segment',
            itemId: 'segment-hidden',
            runId: 'run-a',
            createdAt: 3,
            status: 'superseded',
            content: [{ type: 'text', text: '这段不应该显示' }],
          },
          {
            type: 'retry',
            itemId: 'retry-a',
            runId: 'run-a',
            createdAt: 4,
            kind: 'model',
            attempt: 1,
            maxAttempts: 3,
            errorMessage: '连接中断',
            status: 'success',
          },
          {
            type: 'assistant_segment',
            itemId: 'segment-b',
            runId: 'run-a',
            createdAt: 5,
            status: 'completed',
            content: [
              { type: 'text', text: '接着上面已经生成的继续生成' },
              {
                type: 'tool_call',
                toolCallId: 'todo-history',
                toolName: 'todo',
                args: { action: 'update', subject: '历史计划' },
              },
              {
                type: 'tool_call',
                toolCallId: 'tool-a',
                toolName: 'bash',
                args: { command: 'cat /Users/gdsw/example/SKILL.md' },
              },
            ],
          },
          {
            type: 'tool_result',
            itemId: 'todo-result-history',
            runId: 'run-a',
            createdAt: 6,
            toolCallId: 'todo-history',
            toolName: 'todo',
            args: { action: 'update', subject: '历史计划' },
            content: [{ type: 'text', text: '历史 Todo 已更新' }],
            isError: false,
          },
          {
            type: 'tool_result',
            itemId: 'result-a',
            runId: 'run-a',
            createdAt: 6,
            toolCallId: 'tool-a',
            toolName: 'bash',
            args: { command: 'cat /Users/gdsw/example/SKILL.md' },
            content: [{ type: 'text', text: '文件内容' }],
            isError: false,
          },
        ],
      },
    ],
  };
}

/** @param draft - 当前运行草稿 @returns 带运行中助手回复的产品历史 */
function runningHistory(draft: NonNullable<ProductSessionHistory['draft']>): ProductSessionHistory {
  const current = history();
  return {
    ...current,
    draft,
    runs: current.runs.map((run) => ({
      ...run,
      status: 'running',
      settledAt: null,
    })),
  };
}

/** @returns 页面渲染结果 */
function renderPage() {
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
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  vi.mocked(api.listSessions).mockResolvedValue([
    {
      id: 'session-a',
      title: '检查',
      createdAt: 1,
      updatedAt: 10,
      messageCount: 3,
      isRunning: false,
    },
  ]);
  vi.mocked(api.getMessages).mockResolvedValue(history());
  vi.mocked(api.prompt).mockResolvedValue(undefined);
  vi.mocked(api.forkSession).mockResolvedValue({ sessionId: 'fork-a' });
  vi.mocked(api.editAndResend).mockResolvedValue({ history: history() });
  vi.mocked(api.abortSession).mockResolvedValue({ restoredTexts: [] });
  vi.mocked(api.takePendingMessages).mockResolvedValue({ texts: [] });
});

describe('ChatPage 产品历史投影', () => {
  it('提交后在运行记录到达前立即显示运行标记', async () => {
    const user = userEvent.setup();
    let resolvePrompt!: () => void;
    vi.mocked(api.getMessages).mockResolvedValue({ ...history(), runs: [] });
    vi.mocked(api.prompt).mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      })
    );
    renderPage();

    const textarea = await screen.findByPlaceholderText('输入消息');
    await user.type(textarea, '帮我检查');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('正在准备回复')).toBeInTheDocument();
    await act(async () => resolvePrompt());
  });

  it('输入法确认候选文字时不提交消息', async () => {
    renderPage();
    const textarea = await screen.findByPlaceholderText('输入消息');

    fireEvent.change(textarea, { target: { value: '中文' } });
    expect(fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })).toBe(true);
    expect(api.prompt).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('中文');

    expect(fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229, which: 229 })).toBe(true);
    expect(api.prompt).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('中文');

    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false);
    expect(api.prompt).toHaveBeenCalledWith('session-a', '中文');
  });

  it('显示计划胶囊并只在鼠标悬停延迟后展开详情', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getMessages).mockResolvedValue({
      ...history(),
      executionPlan: {
        steps: [
          { id: 1, subject: '核对接口', status: 'completed' },
          { id: 2, subject: '实现后端', activeForm: '正在实现后端', status: 'in_progress' },
          { id: 3, subject: '验证界面', status: 'pending' },
        ],
      },
    });
    renderPage();
    await act(async () => Promise.resolve());

    const pill = screen.getByLabelText('会话执行计划，第 2 / 3 步');
    expect(pill).toHaveTextContent('正在实现后端');
    expect(pill.querySelector('.lucide-loader-circle')).toHaveClass('animate-spin');
    expect(screen.queryByLabelText('会话执行计划详情')).not.toBeInTheDocument();
    fireEvent.mouseEnter(pill.parentElement!);
    await act(async () => vi.advanceTimersByTimeAsync(99));
    expect(screen.queryByLabelText('会话执行计划详情')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    const details = screen.getByLabelText('会话执行计划详情');
    expect(details).toHaveTextContent('验证界面');
    expect(details.querySelector('.lucide-loader-circle')).toHaveClass('animate-spin');
    vi.useRealTimers();
  });

  it('按原位置显示重试并隐藏被取代片段', async () => {
    renderPage();
    expect(await screen.findByText('这是已经生成的第一段。')).toBeInTheDocument();
    expect(screen.queryByText('就绪')).not.toBeInTheDocument();
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

  it('bash 工具折叠时显示命令，展开时显示工具名', async () => {
    const user = userEvent.setup();
    renderPage();

    const command = 'cat /Users/gdsw/example/SKILL.md';
    const collapsedTitle = await screen.findByText(command, { selector: 'summary span' });
    const summary = collapsedTitle.closest('summary');
    expect(summary).not.toBeNull();

    await user.click(summary!);
    expect(screen.getByText('bash', { selector: 'summary span' })).toBeInTheDocument();

    await user.click(summary!);
    expect(screen.getByText(command, { selector: 'summary span' })).toBeInTheDocument();
  });

  it('不展示历史 Todo 工具运行卡片', async () => {
    renderPage();
    await screen.findByText('接着上面已经生成的继续生成');

    expect(screen.queryByText('todo', { selector: 'summary span' })).not.toBeInTheDocument();
    expect(screen.queryByText('历史 Todo 已更新')).not.toBeInTheDocument();
  });

  it('运行中的 bash 工具默认折叠', async () => {
    vi.mocked(api.getMessages).mockResolvedValue(
      runningHistory({
        runId: 'run-a',
        activeSegment: null,
        tools: [
          {
            runId: 'run-a',
            toolCallId: 'tool-a',
            toolName: 'bash',
            args: { command: 'cat /Users/gdsw/example/SKILL.md' },
            status: 'running',
            partialResult: '部分输出',
            isError: false,
          },
        ],
        retryDeadlineAt: null,
      })
    );
    renderPage();

    const summary = await screen.findByText('cat /Users/gdsw/example/SKILL.md', {
      selector: 'summary span',
    });
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('正在使用工具').closest('[role="status"]')).not.toBeNull();
  });

  it('流式 Todo 只显示运行标记', async () => {
    vi.mocked(api.getMessages).mockResolvedValue(
      runningHistory({
        runId: 'run-a',
        activeSegment: {
          type: 'assistant_segment',
          itemId: 'segment-todo',
          runId: 'run-a',
          createdAt: 7,
          status: 'streaming',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'todo-a',
              toolName: 'todo',
              args: { action: 'create', subject: '核对接口' },
            },
          ],
        },
        tools: [
          {
            runId: 'run-a',
            toolCallId: 'todo-a',
            toolName: 'todo',
            args: { action: 'create', subject: '核对接口' },
            status: 'running',
            isError: false,
          },
        ],
        retryDeadlineAt: null,
      })
    );
    renderPage();

    expect((await screen.findByText('正在更新执行计划')).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText('todo', { selector: 'summary span' })).not.toBeInTheDocument();
    expect(screen.queryByText('核对接口')).not.toBeInTheDocument();
  });
});
