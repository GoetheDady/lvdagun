import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ProductHistoryDraft } from '@lvdagun/protocol';
import { describe, expect, it, vi } from 'vitest';

import { ProductHistory } from '../../src/history/product-history';
import { ProductHistoryRecorder } from '../../src/history/product-history-recorder';
import { FakeSession } from '../http/test-server';
import { MemoryHistoryRepository } from './memory-history-repository';

/** @returns 已创建会话的内存产品历史 */
function makeHistory(): ProductHistory {
  const history = new ProductHistory(new MemoryHistoryRepository());
  expect(history.initialize()).toBe(true);
  history.beginCreate('session-a', 1);
  history.completeCreate('session-a', 'pi-a');
  return history;
}

/** @param text - 文本 @param stopReason - Pi 结束原因 @returns 助手消息 */
function assistant(
  text: string,
  stopReason: 'stop' | 'error' = 'stop'
): Extract<AgentMessage, { role: 'assistant' }> {
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
    ...(stopReason === 'error' ? { errorMessage: '连接中断' } : {}),
    timestamp: Date.now(),
  };
}

/** @param toolCallId - Pi 工具调用标识 @returns 含工具调用的助手消息 */
function assistantToolCall(toolCallId: string): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    ...assistant(''),
    content: [{ type: 'toolCall', id: toolCallId, name: 'read', arguments: { path: 'a.ts' } }],
    stopReason: 'toolUse',
  };
}

describe('ProductHistory', () => {
  it('SQLite 重开后恢复完整产品历史并中断未结算运行', () => {
    const repository = new MemoryHistoryRepository();
    const history = new ProductHistory(repository);
    history.initialize();
    history.beginCreate('session-a', 1);
    history.completeCreate('session-a', 'pi-a');
    history.acceptPrompt('session-a', '问题');

    const second = new ProductHistory(repository);
    expect(second.initialize()).toBe(false);
    expect(second.getSnapshot('session-a').runs[0]).toMatchObject({
      status: 'interrupted',
      items: [{ type: 'user_message', text: '问题' }],
    });
  });

  it('产品分支共享不可变前缀并使用新的产品标识', () => {
    const history = makeHistory();
    const firstRunId = history.acceptPrompt('session-a', '原问题');
    history.mutate('session-a', (session) => {
      const run = session.branches[0]!.runs[0]!;
      run.status = 'completed';
      run.items.push({
        type: 'assistant_segment',
        itemId: 'assistant-a',
        runId: firstRunId,
        createdAt: 2,
        status: 'completed',
        content: [{ type: 'text', text: '原回答' }],
      });
    });
    const userItem = history.getSnapshot('session-a').runs[0]!.items[0]!;
    history.savePiEntryReference('session-a', userItem.itemId, 'pi-entry-a');

    history.beginEditResend('session-a', userItem.itemId, '新问题');
    const snapshot = history.getSnapshot('session-a');
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]!.items[0]).toMatchObject({ type: 'user_message', text: '新问题' });
    expect(snapshot.runs[0]!.runId).not.toBe(firstRunId);
  });

  it('恢复跨存储生命周期意图并清理悬空 Pi 会话', async () => {
    const repository = new MemoryHistoryRepository();
    const history = new ProductHistory(repository);
    history.initialize();
    history.beginCreate('creating');
    history.beginCreate('forking');
    history.completeCreate('forking', 'pi-forking');
    history.setLifecycle('forking', 'forking');
    history.beginCreate('archiving');
    history.completeCreate('archiving', 'pi-archiving');
    history.setLifecycle('archiving', 'archiving');
    history.beginCreate('deleting');
    history.completeCreate('deleting', 'pi-deleting');
    history.setLifecycle('deleting', 'deleting');
    const deletePiSession = vi.fn(async () => {});

    await history.recoverLifecycleIntents(
      new Set(['pi-forking', 'pi-deleting', 'pi-orphan']),
      deletePiSession
    );

    expect(deletePiSession.mock.calls).toEqual([['pi-forking'], ['pi-deleting'], ['pi-orphan']]);
    expect(repository.loadSession('creating')).toBeNull();
    expect(repository.loadSession('forking')).toBeNull();
    expect(repository.loadSession('deleting')).toBeNull();
    expect(repository.loadSession('archiving')).toMatchObject({
      status: 'archived',
      lifecycleState: 'archived',
    });
  });

  it('旧会话清理标记只有显式完成后才生效', () => {
    const history = new ProductHistory(new MemoryHistoryRepository());
    history.initialize();
    expect(history.needsLegacySessionCutover()).toBe(true);
    history.completeLegacySessionCutover();
    expect(history.needsLegacySessionCutover()).toBe(false);
  });

  it('派生会话为工具关联分配新的产品标识', () => {
    const history = makeHistory();
    const runId = history.acceptPrompt('session-a', '读取文件');
    history.mutate('session-a', (session) => {
      const run = session.branches[0]!.runs[0]!;
      run.status = 'completed';
      run.items.push(
        {
          type: 'assistant_segment',
          itemId: 'assistant-a',
          runId,
          createdAt: 2,
          status: 'completed',
          content: [
            {
              type: 'tool_call',
              toolCallId: 'product-tool-a',
              toolName: 'read',
              args: { path: 'a.ts' },
            },
          ],
        },
        {
          type: 'tool_result',
          itemId: 'result-a',
          runId,
          createdAt: 3,
          toolCallId: 'product-tool-a',
          toolName: 'read',
          args: { path: 'a.ts' },
          content: [{ type: 'text', text: '内容' }],
          isError: false,
        }
      );
    });
    history.beginCreate('session-b');
    history.completeCreate('session-b', 'pi-b');

    history.copyForkHistory('session-b', 'session-a', runId);

    const items = history.getSnapshot('session-b').runs[0]!.items;
    const call = items
      .find((item) => item.type === 'assistant_segment')
      ?.content.find((block) => block.type === 'tool_call');
    const result = items.find((item) => item.type === 'tool_result');
    expect(call?.toolCallId).not.toBe('product-tool-a');
    expect(result?.type === 'tool_result' ? result.toolCallId : null).toBe(call?.toolCallId);
  });

  it('草稿事件尾随节流：合并窗口内只广播最后一次最新草稿', async () => {
    const history = makeHistory();
    const events: ProductHistoryDraft[] = [];
    history.subscribe('session-a', (event) => {
      if (event.type === 'session_draft_changed') events.push(event.draft!);
    });
    const draft = (runId: string): ProductHistoryDraft => ({
      runId,
      activeSegment: null,
      tools: [],
      retryDeadlineAt: null,
    });

    history.setDraft('session-a', draft('r1'));
    history.setDraft('session-a', draft('r2'));
    history.setDraft('session-a', draft('r3'));
    // 合并窗口内不立即广播
    expect(events).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toHaveLength(1);
    expect(events[0]!.runId).toBe('r3');
  });

  it('连续 delta 期间按合并窗口稳定广播，新 delta 不重置挂起的计时器', async () => {
    const history = makeHistory();
    const events: ProductHistoryDraft[] = [];
    history.subscribe('session-a', (event) => {
      if (event.type === 'session_draft_changed' && event.draft) events.push(event.draft);
    });
    const draft = (runId: string): ProductHistoryDraft => ({
      runId,
      activeSegment: null,
      tools: [],
      retryDeadlineAt: null,
    });

    // 模拟 Pi 逐 token 广播：15 个 delta，每 20ms 一个（间隔小于 60ms 合并窗口）
    for (let i = 0; i < 15; i++) {
      history.setDraft('session-a', draft(`r${i}`));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // 防抖会把广播无限推迟到流停顿之后；节流应在生成期间持续输出
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThanOrEqual(8);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 最后一次广播携带最新草稿
    expect(events.at(-1)?.runId).toBe('r14');
  });

  it('清空草稿立即广播并取消挂起的延迟广播', async () => {
    const history = makeHistory();
    const events: (ProductHistoryDraft | null)[] = [];
    history.subscribe('session-a', (event) => {
      if (event.type === 'session_draft_changed') events.push(event.draft);
    });
    history.setDraft('session-a', {
      runId: 'r1',
      activeSegment: null,
      tools: [],
      retryDeadlineAt: null,
    });
    history.setDraft('session-a', null);
    // null 同步广播
    expect(events).toEqual([null]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    // 挂起的延迟广播已被取消，不重复发出
    expect(events).toEqual([null]);
  });
});

describe('ProductHistoryRecorder', () => {
  it('持久化最后一份合法 Todo 投影并在下次模型调用隐藏已完成计划', () => {
    const history = makeHistory();
    const session = new FakeSession('pi-a');
    history.acceptPrompt('session-a', '完成复杂工作');
    new ProductHistoryRecorder(history, 'session-a', session, vi.fn()).attach();
    session.emit({ type: 'agent_start' });
    session.emit({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'todo-a',
        toolName: 'todo',
        content: [{ type: 'text', text: 'Updated #1' }],
        details: {
          action: 'update',
          params: { id: 1, status: 'completed' },
          tasks: [{ id: 1, subject: '完成实现', status: 'completed' }],
          nextId: 2,
        },
        isError: false,
        timestamp: 3,
      },
    });
    expect(history.getSnapshot('session-a').executionPlan).toEqual({
      steps: [{ id: 1, subject: '完成实现', status: 'completed' }],
    });

    session.emit({ type: 'turn_start' });
    expect(history.getSnapshot('session-a').executionPlan).toBeNull();
  });

  it('非法 Todo 快照保留上一份合法投影', () => {
    const history = makeHistory();
    const session = new FakeSession('pi-a');
    history.acceptPrompt('session-a', '完成复杂工作');
    new ProductHistoryRecorder(history, 'session-a', session, vi.fn()).attach();
    session.emit({ type: 'agent_start' });
    const emitTodo = (details: unknown, toolCallId: string) =>
      session.emit({
        type: 'message_end',
        message: {
          role: 'toolResult',
          toolCallId,
          toolName: 'todo',
          content: [{ type: 'text', text: 'Todo' }],
          details,
          isError: false,
          timestamp: 3,
        },
      });
    emitTodo(
      {
        action: 'create',
        params: { subject: '实现功能' },
        tasks: [{ id: 1, subject: '实现功能', status: 'in_progress' }],
        nextId: 2,
      },
      'todo-a'
    );
    emitTodo({ action: 'update', params: {}, tasks: 'invalid', nextId: 2 }, 'todo-b');

    expect(history.getSnapshot('session-a').executionPlan).toEqual({
      steps: [{ id: 1, subject: '实现功能', status: 'in_progress' }],
    });
  });

  it('将 Pi 工具调用标识留在后端并向产品历史分配稳定标识', () => {
    const repository = new MemoryHistoryRepository();
    const history = new ProductHistory(repository);
    history.initialize();
    history.beginCreate('session-a');
    history.completeCreate('session-a', 'pi-a');
    history.acceptPrompt('session-a', '读取文件');
    const session = new FakeSession('pi-a');
    new ProductHistoryRecorder(history, 'session-a', session, vi.fn()).attach();
    const callMessage = assistantToolCall('pi-tool-a');
    session.emit({ type: 'agent_start' });
    session.emit({ type: 'message_start', message: callMessage });
    session.emit({ type: 'message_end', message: callMessage });
    session.emit({
      type: 'tool_execution_start',
      toolCallId: 'pi-tool-a',
      toolName: 'read',
      args: { path: 'a.ts' },
    });
    session.emit({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'pi-tool-a',
        toolName: 'read',
        content: [{ type: 'text', text: '内容' }],
        isError: false,
        timestamp: 3,
      },
    });

    const snapshot = history.getSnapshot('session-a');
    const call = snapshot.runs[0]!.items.find(
      (item) => item.type === 'assistant_segment'
    )?.content.find((block) => block.type === 'tool_call');
    const result = snapshot.runs[0]!.items.find((item) => item.type === 'tool_result');
    expect(call?.toolCallId).not.toBe('pi-tool-a');
    expect(result?.type === 'tool_result' ? result.toolCallId : null).toBe(call?.toolCallId);
    expect(repository.loadSession('session-a')?.sourceReferences).toContainEqual({
      itemId: result?.itemId,
      sourceType: 'pi_tool_call',
      sourceId: 'pi-tool-a',
    });
  });

  it('重试只隐藏失败模型片段，保留前序片段并在原位插入重试卡', () => {
    const history = makeHistory();
    const session = new FakeSession('pi-a');
    const recorder = new ProductHistoryRecorder(history, 'session-a', session, vi.fn());
    history.acceptPrompt('session-a', '问题');
    recorder.attach();
    session.emit({ type: 'agent_start' });

    const first = assistant('这是已经生成的第一段。');
    session.emit({ type: 'message_start', message: first });
    session.emit({ type: 'message_end', message: first });
    const failed = assistant('这是生成到一半的第二段……', 'error');
    session.emit({ type: 'message_start', message: failed });
    session.emit({ type: 'message_end', message: failed });
    session.emit({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: '连接中断',
    });
    const continued = assistant('接着上面已经生成的继续生成');
    session.emit({ type: 'message_start', message: continued });
    session.emit({ type: 'message_end', message: continued });
    session.emit({ type: 'auto_retry_end', success: true, attempt: 1 });
    session.emit({ type: 'agent_settled' });

    const items = history.getSnapshot('session-a').runs[0]!.items;
    expect(items.map((item) => [item.type, 'status' in item ? item.status : null])).toEqual([
      ['user_message', null],
      ['assistant_segment', 'completed'],
      ['assistant_segment', 'superseded'],
      ['retry', 'success'],
      ['assistant_segment', 'completed'],
    ]);
  });

  it('最终失败保留最后一次模型调用的半截内容', () => {
    const history = makeHistory();
    const session = new FakeSession('pi-a');
    new ProductHistoryRecorder(history, 'session-a', session, vi.fn()).attach();
    history.acceptPrompt('session-a', '问题');
    session.emit({ type: 'agent_start' });
    const partial = assistant('已经生成的半截内容', 'error');
    session.emit({ type: 'message_start', message: partial });
    session.emit({ type: 'message_end', message: partial });
    session.emit({ type: 'agent_settled' });

    expect(history.getSnapshot('session-a').runs[0]).toMatchObject({
      status: 'failed',
      items: expect.arrayContaining([
        expect.objectContaining({ type: 'assistant_segment', status: 'failed' }),
      ]),
    });
  });
});
