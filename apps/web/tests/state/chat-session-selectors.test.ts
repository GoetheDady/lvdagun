import { describe, expect, it } from 'vitest';

import type {
  ProductAssistantBlock,
  ProductTimelineItem,
  ProductToolDraft,
} from '@lvdagun/protocol';

import { selectRunMarker } from '../../src/state/chat-session-selectors';
import { initialState, type ChatSessionState } from '../../src/state/chat-session-state';

/**
 * 构造一个正在执行的最小会话状态。
 *
 * @param options - 运行时间线、流式内容和工具草稿
 * @returns 可供 selector 消费的会话状态
 */
function runningState(options?: {
  items?: ProductTimelineItem[];
  content?: ProductAssistantBlock[];
  tools?: ProductToolDraft[];
  accepted?: boolean;
  aborting?: boolean;
}): ChatSessionState {
  const accepted = options?.accepted ?? false;
  return {
    ...initialState,
    isRunning: true,
    aborting: options?.aborting ?? false,
    history: {
      schemaVersion: 1,
      sessionId: 'session-a',
      branchId: 'branch-a',
      revision: 1,
      blobs: {},
      executionPlan: null,
      runs: [
        {
          runId: 'run-a',
          status: accepted ? 'accepted' : 'running',
          acceptedAt: 1,
          startedAt: accepted ? null : 2,
          settledAt: null,
          items: options?.items ?? [],
        },
      ],
      draft: {
        runId: 'run-a',
        activeSegment: options?.content
          ? {
              type: 'assistant_segment',
              itemId: 'segment-a',
              runId: 'run-a',
              createdAt: 2,
              status: 'streaming',
              content: options.content,
            }
          : null,
        tools: options?.tools ?? [],
        retryDeadlineAt: null,
      },
    },
  };
}

describe('selectRunMarker', () => {
  it.each([
    ['正在准备回复', runningState({ accepted: true })],
    ['正在处理', runningState()],
    ['正在思考', runningState({ content: [{ type: 'thinking', text: '推理中' }] })],
    ['正在生成回复', runningState({ content: [{ type: 'text', text: '回复中' }] })],
    [
      '正在使用工具',
      runningState({
        tools: [
          {
            runId: 'run-a',
            toolCallId: 'bash-a',
            toolName: 'bash',
            args: {},
            status: 'running',
            isError: false,
          },
        ],
      }),
    ],
    [
      '正在更新执行计划',
      runningState({
        tools: [
          {
            runId: 'run-a',
            toolCallId: 'todo-a',
            toolName: 'todo',
            args: {},
            status: 'running',
            isError: false,
          },
        ],
      }),
    ],
    [
      '正在压缩上下文',
      runningState({
        items: [
          {
            type: 'compaction',
            itemId: 'compaction-a',
            runId: 'run-a',
            createdAt: 3,
            reason: 'threshold',
            status: 'running',
          },
        ],
      }),
    ],
    [
      '正在重试',
      runningState({
        items: [
          {
            type: 'retry',
            itemId: 'retry-a',
            runId: 'run-a',
            createdAt: 3,
            kind: 'model',
            attempt: 1,
            maxAttempts: 3,
            errorMessage: '网络中断',
            status: 'waiting',
          },
        ],
      }),
    ],
    ['正在停止', runningState({ aborting: true })],
  ])('返回阶段文案 %s', (text, state) => {
    expect(selectRunMarker(state)).toEqual({ runId: 'run-a', text });
  });

  it('按停止、重试、压缩和 Todo 的顺序选择最高优先级', () => {
    const state = runningState({
      aborting: true,
      items: [
        {
          type: 'retry',
          itemId: 'retry-a',
          runId: 'run-a',
          createdAt: 3,
          kind: 'model',
          attempt: 1,
          maxAttempts: 3,
          errorMessage: '网络中断',
          status: 'retrying',
        },
        {
          type: 'compaction',
          itemId: 'compaction-a',
          runId: 'run-a',
          createdAt: 4,
          reason: 'threshold',
          status: 'running',
        },
      ],
      tools: [
        {
          runId: 'run-a',
          toolCallId: 'todo-a',
          toolName: 'todo',
          args: {},
          status: 'running',
          isError: false,
        },
      ],
    });

    expect(selectRunMarker(state)?.text).toBe('正在停止');
    expect(selectRunMarker({ ...state, aborting: false })?.text).toBe('正在重试');
  });

  it('在运行记录尚未到达时提供发送与恢复兜底', () => {
    expect(selectRunMarker({ ...initialState, sending: true })).toEqual({
      runId: null,
      text: '正在准备回复',
    });
    expect(selectRunMarker({ ...initialState, isRunning: true })).toEqual({
      runId: null,
      text: '正在处理',
    });
    expect(selectRunMarker(initialState)).toBeNull();
  });
});
