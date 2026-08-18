import { describe, expect, it, vi } from 'vitest';

import type { AgentEndEvent } from '@earendil-works/pi-coding-agent';

import {
  PendingMessageController,
  PendingMessageNotFoundError,
  type PendingMessageSession,
} from '../../../src/extensions/pending-messages/pending-message-controller';

/** @returns 成功自然结束的 Pi Extension 事件 */
function successfulAgentEnd(): AgentEndEvent {
  return {
    type: 'agent_end',
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '完成' }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-a',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 1,
      },
    ],
  };
}

/** @returns 可观测的最小 Pi 队列接口 */
function createSession(): PendingMessageSession {
  return {
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    abortCompaction: vi.fn(),
    abort: vi.fn(async () => {}),
  };
}

describe('PendingMessageController', () => {
  it('为消息分配稳定身份并广播防御性快照', () => {
    const ids = ['pending-a', 'pending-b'];
    const controller = new PendingMessageController(() => ids.shift()!);
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.enqueue('第一条');
    controller.enqueue('第二条');

    expect(controller.getSnapshot()).toEqual([
      { id: 'pending-a', text: '第一条' },
      { id: 'pending-b', text: '第二条' },
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('按稳定 ID 调整方向，Pi 拒绝时恢复原位置', async () => {
    const controller = new PendingMessageController(() => 'pending-a');
    const session = createSession();
    controller.bindSession(session);
    controller.enqueue('改查另一个文件');

    await controller.steer('pending-a');
    expect(session.steer).toHaveBeenCalledWith('改查另一个文件');
    expect(controller.getSnapshot()).toEqual([]);

    const failed = new PendingMessageController(() => 'pending-b');
    const failedSession = createSession();
    vi.mocked(failedSession.steer).mockRejectedValueOnce(new Error('Pi 拒绝'));
    failed.bindSession(failedSession);
    failed.enqueue('需要恢复');
    await expect(failed.steer('pending-b')).rejects.toThrow('Pi 拒绝');
    expect(failed.getSnapshot()).toEqual([{ id: 'pending-b', text: '需要恢复' }]);
  });

  it('只在成功自然结束后按 FIFO 移交一条 followUp', async () => {
    const ids = ['pending-a', 'pending-b'];
    const controller = new PendingMessageController(() => ids.shift()!);
    const session = createSession();
    controller.bindSession(session);
    controller.enqueue('第一条');
    controller.enqueue('第二条');

    await controller.handleAgentEnd({ type: 'agent_end', messages: [] });
    expect(session.followUp).not.toHaveBeenCalled();

    await controller.handleAgentEnd(successfulAgentEnd());
    expect(session.followUp).toHaveBeenCalledWith('第一条');
    expect(controller.getSnapshot()).toEqual([{ id: 'pending-b', text: '第二条' }]);
  });

  it('停止时合并 Pi 临时队列与尚未移交的消息', async () => {
    const controller = new PendingMessageController(() => 'pending-a');
    const session = createSession();
    vi.mocked(session.clearQueue).mockReturnValue({
      steering: ['已移交调整方向'],
      followUp: ['已移交排队'],
    });
    controller.bindSession(session);
    controller.enqueue('仍在待处理区');

    await expect(controller.abortAndTakeAll()).resolves.toEqual([
      '已移交调整方向',
      '已移交排队',
      '仍在待处理区',
    ]);
    expect(session.abortCompaction).toHaveBeenCalledOnce();
    expect(session.abort).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual([]);
  });

  it('不存在的稳定 ID 返回明确错误', () => {
    const controller = new PendingMessageController();
    expect(() => controller.remove('missing')).toThrow(PendingMessageNotFoundError);
  });

  it('停止失败时恢复尚未移交的待处理消息', async () => {
    const controller = new PendingMessageController(() => 'pending-a');
    const session = createSession();
    vi.mocked(session.abort).mockRejectedValueOnce(new Error('停止失败'));
    controller.bindSession(session);
    controller.enqueue('不能丢失');

    await expect(controller.abortAndTakeAll()).rejects.toThrow('停止失败');
    expect(controller.getSnapshot()).toEqual([{ id: 'pending-a', text: '不能丢失' }]);
  });
});
