import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PRODUCT_HISTORY_SCHEMA_VERSION, type ProductSessionHistory } from '@lvdagun/protocol';

import { ChatTranscript } from '@/components/chat/chat-transcript';

/** @param items - 运行内条目 @returns 最小产品会话历史 */
function historyWithItems(
  items: ProductSessionHistory['runs'][number]['items']
): ProductSessionHistory {
  return {
    schemaVersion: PRODUCT_HISTORY_SCHEMA_VERSION,
    sessionId: 'session-a',
    branchId: 'branch-a',
    revision: 1,
    runs: [
      { runId: 'run-a', status: 'completed', acceptedAt: 1, startedAt: 1, settledAt: 2, items },
    ],
    draft: null,
    blobs: {},
    executionPlan: null,
  };
}

const toolCall = {
  type: 'tool_call' as const,
  toolCallId: 'call-a',
  toolName: 'delegate',
  args: { tasks: [{ agent: 'scout', task: '调查登录问题' }] },
};

describe('子 Agent 委派卡片', () => {
  it('持久化的委派结果渲染为消息流内联卡片', () => {
    const history = historyWithItems([
      {
        type: 'assistant_segment',
        itemId: 'seg-a',
        runId: 'run-a',
        createdAt: 1,
        status: 'completed',
        content: [toolCall],
      },
      {
        type: 'tool_result',
        itemId: 'item-a',
        runId: 'run-a',
        createdAt: 2,
        toolCallId: 'call-a',
        toolName: 'delegate',
        args: toolCall.args,
        content: [{ type: 'text', text: '' }],
        isError: false,
        delegations: [
          {
            id: 'child-1',
            agent: 'scout',
            task: '调查登录问题',
            status: 'success',
            childSessionId: 'child-1',
            result: '发现登录逻辑位于 auth.ts',
            usage: { turns: 2, inputTokens: 120, outputTokens: 40, cost: 0.01 },
            error: null,
            steps: 3,
            activity: null,
            startedAt: 1,
            endedAt: 2,
          },
        ],
      },
    ]);
    render(<ChatTranscript {...baseProps} history={history} />);
    expect(screen.getByText('侦察')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('发现登录逻辑位于 auth.ts')).toBeTruthy();
    expect(screen.getByText('调查登录问题')).toBeTruthy();
  });

  it('失败的委派卡片显示错误信息', () => {
    const history = historyWithItems([
      {
        type: 'assistant_segment',
        itemId: 'seg-a',
        runId: 'run-a',
        createdAt: 1,
        status: 'completed',
        content: [toolCall],
      },
      {
        type: 'tool_result',
        itemId: 'item-a',
        runId: 'run-a',
        createdAt: 2,
        toolCallId: 'call-a',
        toolName: 'delegate',
        args: toolCall.args,
        content: [{ type: 'text', text: '' }],
        isError: false,
        delegations: [
          {
            id: 'child-2',
            agent: 'worker',
            task: '执行修复',
            status: 'error',
            childSessionId: 'child-2',
            result: null,
            usage: null,
            error: '模型调用失败',
            steps: 1,
            activity: null,
            startedAt: 1,
            endedAt: 2,
          },
        ],
      },
    ]);
    render(<ChatTranscript {...baseProps} history={history} />);
    expect(screen.getByText('执行')).toBeTruthy();
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('模型调用失败')).toBeTruthy();
  });
});

const baseProps = {
  loading: false,
  runMarker: null,
  editableUserItemId: null,
  editing: null,
  forkingRunId: null,
  actionsDisabled: false,
  onStartEdit: () => undefined,
  onEditDraftChange: () => undefined,
  onCancelEdit: () => undefined,
  onSubmitEdit: () => undefined,
  onFork: () => undefined,
};
