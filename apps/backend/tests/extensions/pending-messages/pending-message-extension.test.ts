import { describe, expect, it, vi } from 'vitest';

import type { AgentEndEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent';

import {
  AgentNotRunningError,
  createPendingMessageExtension,
  PendingMessageNotFoundError,
} from '../../../src/extensions/pending-messages/pending-message-extension';

type ExtensionEventName = 'agent_end' | 'session_shutdown';
type ExtensionEventHandler = (
  event: AgentEndEvent | { type: 'session_shutdown' }
) => Promise<void> | void;

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

/** @param isIdle - Agent 是否空闲 @returns 可观测的最小 Pi 会话 */
function createSession(isIdle = false) {
  return {
    isIdle,
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    clearQueue: vi.fn(() => ({ steering: [] as string[], followUp: [] as string[] })),
    abortCompaction: vi.fn(),
    abort: vi.fn(async () => {}),
  };
}

/** 创建从完整 Extension interface 驱动事件的测试环境。 */
async function createHarness(ids: string[] = ['pending-a', 'pending-b', 'pending-c']) {
  const pendingMessages = createPendingMessageExtension({ createId: () => ids.shift()! });
  const handlers = new Map<ExtensionEventName, ExtensionEventHandler>();
  const api = {
    on: (event: ExtensionEventName, handler: ExtensionEventHandler) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  await pendingMessages.extension.factory(api);

  return {
    pendingMessages,
    emit: async (
      event: ExtensionEventName,
      payload: AgentEndEvent | { type: 'session_shutdown' }
    ): Promise<void> => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`Extension 未注册事件:${event}`);
      await handler(payload);
    },
  };
}

describe('待处理消息 Extension', () => {
  it('提供命名的隐藏 Extension，并为消息分配稳定身份和广播快照', async () => {
    const { pendingMessages } = await createHarness();
    const listener = vi.fn();
    pendingMessages.subscribe(listener);

    pendingMessages.enqueue('第一条');
    pendingMessages.enqueue('第二条');

    expect(pendingMessages.extension).toMatchObject({
      name: 'lvdagun-pending-messages',
      hidden: true,
    });
    expect(pendingMessages.getSnapshot()).toEqual([
      { id: 'pending-a', text: '第一条' },
      { id: 'pending-b', text: '第二条' },
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('按稳定 ID 调整方向，Pi 拒绝时恢复原位置', async () => {
    const accepted = await createHarness();
    const acceptedSession = createSession();
    accepted.pendingMessages.bindSession(acceptedSession);
    accepted.pendingMessages.enqueue('改查另一个文件');

    await accepted.pendingMessages.steer('pending-a');
    expect(acceptedSession.steer).toHaveBeenCalledWith('改查另一个文件');
    expect(accepted.pendingMessages.getSnapshot()).toEqual([]);

    const rejected = await createHarness();
    const rejectedSession = createSession();
    rejectedSession.steer.mockRejectedValueOnce(new Error('Pi 拒绝'));
    rejected.pendingMessages.bindSession(rejectedSession);
    rejected.pendingMessages.enqueue('需要恢复');

    await expect(rejected.pendingMessages.steer('pending-a')).rejects.toThrow('Pi 拒绝');
    expect(rejected.pendingMessages.getSnapshot()).toEqual([{ id: 'pending-a', text: '需要恢复' }]);
  });

  it('Agent 已停止时拒绝调整方向并保留消息', async () => {
    const { pendingMessages } = await createHarness();
    pendingMessages.bindSession(createSession(true));
    pendingMessages.enqueue('继续检查');

    await expect(pendingMessages.steer('pending-a')).rejects.toThrow(AgentNotRunningError);
    expect(pendingMessages.getSnapshot()).toEqual([{ id: 'pending-a', text: '继续检查' }]);
  });

  it('只在成功自然结束后按 FIFO 移交一条 followUp', async () => {
    const harness = await createHarness();
    const session = createSession();
    harness.pendingMessages.bindSession(session);
    harness.pendingMessages.enqueue('第一条');
    harness.pendingMessages.enqueue('第二条');

    await harness.emit('agent_end', { type: 'agent_end', messages: [] });
    expect(session.followUp).not.toHaveBeenCalled();

    await harness.emit('agent_end', successfulAgentEnd());
    expect(session.followUp).toHaveBeenCalledWith('第一条');
    expect(harness.pendingMessages.getSnapshot()).toEqual([{ id: 'pending-b', text: '第二条' }]);
  });

  it('自动移交失败时恢复原位置且不继续下一条', async () => {
    const harness = await createHarness();
    const session = createSession();
    session.followUp.mockRejectedValueOnce(new Error('Pi 队列拒绝'));
    harness.pendingMessages.bindSession(session);
    harness.pendingMessages.enqueue('第一条');
    harness.pendingMessages.enqueue('第二条');

    await expect(harness.emit('agent_end', successfulAgentEnd())).rejects.toThrow('Pi 队列拒绝');

    expect(session.followUp).toHaveBeenCalledTimes(1);
    expect(harness.pendingMessages.getSnapshot()).toEqual([
      { id: 'pending-a', text: '第一条' },
      { id: 'pending-b', text: '第二条' },
    ]);
  });

  it('支持删除、全部取回和不存在的稳定 ID 错误', async () => {
    const { pendingMessages } = await createHarness();
    pendingMessages.enqueue('第一条');
    pendingMessages.enqueue('第二条');

    pendingMessages.remove('pending-a');
    expect(pendingMessages.takeAll()).toEqual(['第二条']);
    expect(pendingMessages.getSnapshot()).toEqual([]);
    expect(() => pendingMessages.remove('missing')).toThrow(PendingMessageNotFoundError);
  });

  it('停止时合并 Pi 临时队列与尚未移交的消息', async () => {
    const { pendingMessages } = await createHarness();
    const session = createSession();
    session.clearQueue.mockReturnValue({
      steering: ['已移交调整方向'],
      followUp: ['已移交排队'],
    });
    pendingMessages.bindSession(session);
    pendingMessages.enqueue('仍在待处理区');

    await expect(pendingMessages.abortAndTakeAll()).resolves.toEqual([
      '已移交调整方向',
      '已移交排队',
      '仍在待处理区',
    ]);
    expect(session.abortCompaction).toHaveBeenCalledOnce();
    expect(session.abort).toHaveBeenCalledOnce();
    expect(pendingMessages.getSnapshot()).toEqual([]);
  });

  it('停止失败时恢复全部尚未处理的文本', async () => {
    const { pendingMessages } = await createHarness();
    const session = createSession();
    session.clearQueue.mockReturnValue({ steering: ['已移交'], followUp: [] });
    session.abort.mockRejectedValueOnce(new Error('停止失败'));
    pendingMessages.bindSession(session);
    pendingMessages.enqueue('仍在待处理区');

    await expect(pendingMessages.abortAndTakeAll()).rejects.toThrow('停止失败');
    expect(pendingMessages.getSnapshot().map((message) => message.text)).toEqual([
      '已移交',
      '仍在待处理区',
    ]);
  });

  it('Runtime 重绑时保留消息并只使用新 Pi 会话', async () => {
    const harness = await createHarness();
    const oldSession = createSession();
    const newSession = createSession();
    harness.pendingMessages.bindSession(oldSession);
    harness.pendingMessages.enqueue('重载后继续');

    await harness.emit('session_shutdown', { type: 'session_shutdown' });
    await expect(harness.pendingMessages.steer('pending-a')).rejects.toThrow(
      '待处理消息 Extension 尚未绑定 Pi 会话'
    );
    harness.pendingMessages.bindSession(newSession);
    await harness.pendingMessages.steer('pending-a');

    expect(oldSession.steer).not.toHaveBeenCalled();
    expect(newSession.steer).toHaveBeenCalledWith('重载后继续');
  });
});
