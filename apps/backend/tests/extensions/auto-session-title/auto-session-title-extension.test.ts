import { describe, expect, it, vi } from 'vitest';

import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRuntime,
  SessionEntry,
} from '@earendil-works/pi-coding-agent';
import type { ChatMessage } from '@lvdagun/protocol';

import { createAutoSessionTitleExtension } from '../../../src/extensions/auto-session-title/auto-session-title-extension';

type ExtensionEventName = 'agent_start' | 'agent_end' | 'agent_settled' | 'session_shutdown';
type ExtensionEventHandler = (event: unknown, context: ExtensionContext) => Promise<void> | void;

/** @param text - 助手文本 @param stopReason - 结束原因 @returns 完整助手消息 */
function assistantMessage(
  text: string,
  stopReason: Extract<ChatMessage, { role: 'assistant' }>['stopReason'] = 'stop'
): Extract<ChatMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
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
    stopReason,
    timestamp: 2,
  };
}

/** @param message - Pi 消息 @param id - 条目标识 @param parentId - 父条目标识 @returns 会话消息条目 */
function messageEntry(
  message: ChatMessage,
  id: string,
  parentId: string | null
): Extract<SessionEntry, { type: 'message' }> {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: new Date(message.timestamp).toISOString(),
    message,
  };
}

/** 创建并驱动一个只暴露 Pi Extension interface 的测试环境。 */
async function createHarness(
  result: ChatMessage | Promise<ChatMessage> = assistantMessage('整理会话恢复执行线路')
) {
  const entries: SessionEntry[] = [
    messageEntry({ role: 'user', content: '整理会话架构', timestamp: 1 }, 'user-1', null),
    messageEntry(assistantMessage('已经完成会话架构整理。'), 'assistant-1', 'user-1'),
  ];
  const handlers = new Map<ExtensionEventName, ExtensionEventHandler>();
  let sessionName: string | undefined;
  const appendEntry = vi.fn((customType: string, data?: unknown) => {
    entries.push({
      type: 'custom',
      id: `custom-${entries.length}`,
      parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(),
      customType,
      data,
    });
  });
  const setSessionName = vi.fn((name: string) => {
    sessionName = name;
  });
  const streamSimple = vi.fn((...args: [unknown, unknown, { signal?: AbortSignal }?]) => {
    void args;
    return { result: () => Promise.resolve(result) };
  });
  const api = {
    on: (event: ExtensionEventName, handler: ExtensionEventHandler) => {
      handlers.set(event, handler);
    },
    appendEntry,
    getSessionName: () => sessionName,
    setSessionName,
  } as unknown as ExtensionAPI;
  const context = {
    sessionManager: {
      getBranch: () => entries,
      getEntries: () => entries,
    },
    model: { provider: 'anthropic', id: 'claude-a' },
  } as unknown as ExtensionContext;
  const extension = createAutoSessionTitleExtension({
    streamSimple,
  } as unknown as Pick<ModelRuntime, 'streamSimple'>);
  await extension.factory(api);

  return {
    entries,
    appendEntry,
    setSessionName,
    streamSimple,
    setManualTitle: (title: string) => {
      sessionName = title;
    },
    emit: async (event: ExtensionEventName, payload: unknown): Promise<void> => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`Extension 未注册事件:${event}`);
      await handler(payload, context);
    },
  };
}

/** @param harness - Extension 测试环境 @param answer - 本次 Agent 运行的最终消息 */
async function settleSuccessfulRun(
  harness: Awaited<ReturnType<typeof createHarness>>,
  answer = assistantMessage('已经完成会话架构整理。')
): Promise<void> {
  await harness.emit('agent_start', { type: 'agent_start' });
  await harness.emit('agent_end', { type: 'agent_end', messages: [answer] });
  await harness.emit('agent_settled', { type: 'agent_settled' });
}

describe('自动会话标题 Extension', () => {
  it('成功运行完全结算后使用当前模型生成一次标题', async () => {
    const harness = await createHarness();

    await settleSuccessfulRun(harness);
    await vi.waitFor(() =>
      expect(harness.setSessionName).toHaveBeenCalledWith('整理会话恢复执行线路')
    );
    await settleSuccessfulRun(harness);

    expect(harness.streamSimple).toHaveBeenCalledTimes(1);
    expect(harness.appendEntry).toHaveBeenCalledWith(
      'lvdagun.auto-session-title-attempted',
      expect.objectContaining({ attemptedAt: expect.any(Number) })
    );
  });

  it('只截取首条用户消息和首条成功回答各 2000 个字符', async () => {
    const harness = await createHarness();
    harness.entries.splice(
      0,
      harness.entries.length,
      messageEntry({ role: 'user', content: '问'.repeat(2001), timestamp: 1 }, 'user-1', null),
      messageEntry(assistantMessage('答'.repeat(2001)), 'assistant-1', 'user-1')
    );

    await settleSuccessfulRun(harness);
    await vi.waitFor(() => expect(harness.streamSimple).toHaveBeenCalledTimes(1));

    const request = harness.streamSimple.mock.calls[0]![1] as {
      messages: Array<{ content: string }>;
    };
    expect(request.messages[0]!.content).toContain('问'.repeat(2000));
    expect(request.messages[0]!.content).not.toContain('问'.repeat(2001));
    expect(request.messages[0]!.content).toContain('答'.repeat(2000));
    expect(request.messages[0]!.content).not.toContain('答'.repeat(2001));
  });

  it('失败运行或尚未完全结算时不生成标题', async () => {
    const harness = await createHarness();

    await harness.emit('agent_start', { type: 'agent_start' });
    await harness.emit('agent_end', {
      type: 'agent_end',
      messages: [assistantMessage('运行失败', 'error')],
    });
    await harness.emit('agent_settled', { type: 'agent_settled' });
    await harness.emit('agent_start', { type: 'agent_start' });
    await harness.emit('agent_end', {
      type: 'agent_end',
      messages: [assistantMessage('运行成功')],
    });

    expect(harness.streamSimple).not.toHaveBeenCalled();
    expect(harness.appendEntry).not.toHaveBeenCalled();
  });

  it('已有手动标题时不尝试，生成期间设置的手动标题也不会被覆盖', async () => {
    const beforeRun = await createHarness();
    beforeRun.setManualTitle('用户已有标题');
    await settleSuccessfulRun(beforeRun);
    expect(beforeRun.streamSimple).not.toHaveBeenCalled();

    let resolveTitle!: (message: ChatMessage) => void;
    const pendingTitle = new Promise<ChatMessage>((resolve) => {
      resolveTitle = resolve;
    });
    const duringRun = await createHarness(pendingTitle);
    await settleSuccessfulRun(duringRun);
    await vi.waitFor(() => expect(duringRun.streamSimple).toHaveBeenCalledTimes(1));
    duringRun.setManualTitle('用户运行中设置的标题');
    resolveTitle(assistantMessage('自动生成的会话标题'));

    await Promise.resolve();
    await Promise.resolve();
    expect(duringRun.setSessionName).not.toHaveBeenCalled();
  });

  it.each(['太短', 'Session title only', '泄露路径/Users/alice/token'])(
    '拒绝不合规标题：%s',
    async (title) => {
      const harness = await createHarness(assistantMessage(title));

      await settleSuccessfulRun(harness);
      await vi.waitFor(() => expect(harness.streamSimple).toHaveBeenCalledTimes(1));

      expect(harness.setSessionName).not.toHaveBeenCalled();
    }
  );

  it('模型返回错误后保留尝试标记且不重试', async () => {
    const harness = await createHarness(assistantMessage('模型调用失败', 'error'));

    await settleSuccessfulRun(harness);
    await vi.waitFor(() => expect(harness.streamSimple).toHaveBeenCalledTimes(1));
    await settleSuccessfulRun(harness);

    expect(harness.streamSimple).toHaveBeenCalledTimes(1);
    expect(harness.setSessionName).not.toHaveBeenCalled();
  });

  it('后台任务不阻塞结算，同一时刻只运行一个任务', async () => {
    let resolveTitle!: (message: ChatMessage) => void;
    const pendingTitle = new Promise<ChatMessage>((resolve) => {
      resolveTitle = resolve;
    });
    const harness = await createHarness(pendingTitle);

    await settleSuccessfulRun(harness);
    await settleSuccessfulRun(harness);

    expect(harness.streamSimple).toHaveBeenCalledTimes(1);
    resolveTitle(assistantMessage('自动生成的会话标题'));
  });

  it('会话关闭时中止后台请求并阻止迟到标题写入', async () => {
    let resolveTitle!: (message: ChatMessage) => void;
    const pendingTitle = new Promise<ChatMessage>((resolve) => {
      resolveTitle = resolve;
    });
    const harness = await createHarness(pendingTitle);
    await settleSuccessfulRun(harness);
    await vi.waitFor(() => expect(harness.streamSimple).toHaveBeenCalledTimes(1));
    const options = harness.streamSimple.mock.calls[0]![2];

    await harness.emit('session_shutdown', { type: 'session_shutdown', reason: 'quit' });
    resolveTitle(assistantMessage('自动生成的会话标题'));

    expect(options?.signal?.aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.setSessionName).not.toHaveBeenCalled();
  });
});
