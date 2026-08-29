import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  PRODUCT_HISTORY_SCHEMA_VERSION,
  type ProductSessionHistory,
} from '@lvdagun/protocol';

import { ChatTranscript } from '@/components/chat/chat-transcript';

/** @param text - 当前助手流式文本 @returns 最小产品会话历史 */
function streamingHistory(text: string): ProductSessionHistory {
  return {
    schemaVersion: PRODUCT_HISTORY_SCHEMA_VERSION,
    sessionId: 'session-a',
    branchId: 'branch-a',
    revision: 1,
    runs: [
      {
        runId: 'run-a',
        status: 'running',
        acceptedAt: 1,
        startedAt: 1,
        settledAt: null,
        items: [],
      },
    ],
    draft: {
      runId: 'run-a',
      activeSegment: {
        type: 'assistant_segment',
        itemId: 'segment-a',
        runId: 'run-a',
        createdAt: 1,
        status: 'streaming',
        content: [{ type: 'text', text }],
      },
      tools: [],
      retryDeadlineAt: null,
    },
    blobs: {},
    executionPlan: null,
  };
}

const transcriptProps = {
  loading: false,
  runMarker: null,
  editableUserItemId: null,
  editing: null,
  forkingRunId: null,
  actionsDisabled: false,
  onStartEdit: vi.fn(),
  onEditDraftChange: vi.fn(),
  onCancelEdit: vi.fn(),
  onSubmitEdit: vi.fn(),
  onFork: vi.fn(),
};

describe('ChatTranscript', () => {
  it('同一批跨段新增字符沿一条时间线依次动画', async () => {
    const { container, rerender } = render(
      <ChatTranscript {...transcriptProps} history={streamingHistory('旧段落')} />
    );
    await waitFor(() => expect(container.textContent).toContain('旧段落'));

    rerender(
      <ChatTranscript
        {...transcriptProps}
        history={streamingHistory('旧段落新增\n\n第二段新增')}
      />
    );
    await waitFor(() => expect(container.textContent).toContain('第二段新增'));

    const newCharacters = [...container.querySelectorAll<HTMLElement>('[data-sd-animate]')]
      .filter((span) => span.style.getPropertyValue('--sd-duration') === '120ms')
      .map((span) => ({
        text: span.textContent,
        delay: span.style.getPropertyValue('--sd-delay') || '0ms',
      }));

    expect(newCharacters).toEqual([
      { text: '新', delay: '0ms' },
      { text: '增', delay: '15ms' },
      { text: '第', delay: '30ms' },
      { text: '二', delay: '45ms' },
      { text: '段', delay: '60ms' },
      { text: '新', delay: '75ms' },
      { text: '增', delay: '90ms' },
    ]);
  });
});
