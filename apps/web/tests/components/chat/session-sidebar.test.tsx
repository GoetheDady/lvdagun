import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionSidebar } from '@/components/chat/session-sidebar';

describe('SessionSidebar', () => {
  it('在会话项内垂直居中更多操作按钮', () => {
    render(
      <SessionSidebar
        sessions={[
          {
            id: 'session-a',
            title: '两个文本行会使会话项变高',
            createdAt: 0,
            updatedAt: 0,
            messageCount: 1,
            isRunning: false,
          },
        ]}
        activeSessionId="session-a"
        loading={false}
        mutatingSessionId={null}
        error={null}
        hubConnectionStatus="connected"
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn().mockResolvedValue(true)}
        onReconnect={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '更多操作：两个文本行会使会话项变高' })).toHaveClass(
      'top-1/2',
      '-translate-y-1/2'
    );
  });

  it('连接失败时圆点可点击重连', async () => {
    const onReconnect = vi.fn();
    render(
      <SessionSidebar
        sessions={[]}
        activeSessionId="session-a"
        loading={false}
        mutatingSessionId={null}
        error={null}
        hubConnectionStatus="failed"
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn().mockResolvedValue(true)}
        onReconnect={onReconnect}
        onSettings={vi.fn()}
      />
    );

    await screen.findByRole('button', { name: 'Hub 连接失败，点击重连' }).then((button) => {
      button.click();
    });
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});
