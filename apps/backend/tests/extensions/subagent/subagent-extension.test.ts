import { describe, expect, it } from 'vitest';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SubagentDelegation } from '@lvdagun/protocol';

import type { SubagentRunner, SubagentTaskInput } from '../../../src/extensions/subagent/subagent-runner';
import { createSubagentExtension } from '../../../src/extensions/subagent/subagent-extension';

interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { tasks: Array<{ agent: string; task: string }> },
    signal: AbortSignal,
    onUpdate: ((partial: { details?: { delegations: SubagentDelegation[] } }) => void) | undefined,
    ctx: unknown
  ) => Promise<{ content: Array<{ text: string }>; details?: { delegations: SubagentDelegation[] } }>;
}

/** @returns 捕获 delegate 工具的已注册工具列表容器 */
function createToolCapture(): { tools: RegisteredTool[]; stub: object } {
  const tools: RegisteredTool[] = [];
  return { tools, stub: { registerTool: (tool: RegisteredTool) => tools.push(tool) } };
}

/** @param overrides - 委派结果覆盖 @returns 按输入回显的运行器桩 */
function createRunnerStub(
  overrides: Partial<SubagentDelegation> = {},
  options: { delay?: number; onRun?: (input: SubagentTaskInput) => void } = {}
): SubagentRunner {
  return {
    run: async (input) => {
      options.onRun?.(input);
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      return {
        id: 'child-1',
        agent: input.agent.name,
        task: input.task,
        status: 'success',
        childSessionId: 'child-1',
        result: `结果:${input.task}`,
        usage: { turns: 1, inputTokens: 10, outputTokens: 5, cost: 0.01 },
        error: null,
        steps: 2,
        activity: null,
        startedAt: Date.now(),
        endedAt: Date.now(),
        ...overrides,
      };
    },
  };
}

/** @param extension - 委派 Extension @returns 已注册的 delegate 工具 */
async function loadDelegateTool(extension: {
  factory: (pi: ExtensionAPI) => void;
}): Promise<RegisteredTool> {
  const capture = createToolCapture();
  await extension.factory(capture.stub as ExtensionAPI);
  return capture.tools[0]!;
}

describe('createSubagentExtension', () => {
  it('注册 delegate 工具', async () => {
    const extension = createSubagentExtension({ runner: createRunnerStub() });
    expect(extension).toMatchObject({ name: 'lvdagun-subagent', hidden: true });
    const tool = await loadDelegateTool(extension);
    expect(tool.name).toBe('delegate');
  });

  it('并行执行全部委派并返回结果汇总', async () => {
    const extension = createSubagentExtension({ runner: createRunnerStub() });
    const tool = await loadDelegateTool(extension);
    const result = await tool.execute(
      'call-1',
      { tasks: [{ agent: 'scout', task: '调查' }, { agent: 'worker', task: '执行' }] },
      new AbortController().signal,
      undefined,
      { cwd: '/tmp', model: { provider: 'anthropic', id: 'm' }, thinkingLevel: 'off' }
    );
    expect(result.content[0]!.text).toContain('scout(成功)');
    expect(result.content[0]!.text).toContain('worker(成功)');
    expect(result.content[0]!.text).toContain('结果:调查');
    expect(result.details?.delegations).toHaveLength(2);
    expect(result.details?.delegations.every((item) => item.status === 'success')).toBe(true);
  });

  it('单个子 Agent 失败不阻断其余结果', async () => {
    const runner: SubagentRunner = {
      run: async (input) => {
        if (input.agent.name === 'reviewer') {
          throw new Error('boom');
        }
        return createRunnerStub().run(input);
      },
    };
    const extension = createSubagentExtension({ runner });
    const tool = await loadDelegateTool(extension);
    const result = await tool.execute(
      'call-1',
      { tasks: [{ agent: 'reviewer', task: '审查' }, { agent: 'worker', task: '执行' }] },
      new AbortController().signal,
      undefined,
      { cwd: '/tmp', model: { provider: 'anthropic', id: 'm' }, thinkingLevel: 'off' }
    );
    const delegations = result.details?.delegations ?? [];
    expect(delegations.find((item) => item.agent === 'reviewer')?.status).toBe('error');
    expect(delegations.find((item) => item.agent === 'reviewer')?.error).toBe('boom');
    expect(delegations.find((item) => item.agent === 'worker')?.status).toBe('success');
    expect(result.content[0]!.text).toContain('reviewer(失败)');
    expect(result.content[0]!.text).toContain('worker(成功)');
  });

  it('通过 onUpdate 流式上报委派进展', async () => {
    const extension = createSubagentExtension({
      runner: createRunnerStub({}, { delay: 20 }),
    });
    const tool = await loadDelegateTool(extension);
    const updates: Array<SubagentDelegation[] | undefined> = [];
    const promise = tool.execute(
      'call-1',
      { tasks: [{ agent: 'scout', task: '调查' }] },
      new AbortController().signal,
      (partial) => updates.push(partial.details?.delegations),
      { cwd: '/tmp', model: { provider: 'anthropic', id: 'm' }, thinkingLevel: 'off' }
    );
    await promise;
    // 初始 + 每次 onProgress + 结束,至少三轮快照;最后一轮为完成态。
    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates[0]?.[0]?.status).toBe('running');
    expect(updates.at(-1)?.[0]?.status).toBe('success');
  });

  it('runner 抛错时把委派标记为失败', async () => {
    const runner: SubagentRunner = {
      run: async () => {
        throw new Error('model gone');
      },
    };
    const extension = createSubagentExtension({ runner });
    const tool = await loadDelegateTool(extension);
    const result = await tool.execute(
      'call-1',
      { tasks: [{ agent: 'scout', task: '调查' }] },
      new AbortController().signal,
      undefined,
      { cwd: '/tmp', model: { provider: 'anthropic', id: 'm' }, thinkingLevel: 'off' }
    );
    expect(result.details?.delegations?.[0]).toMatchObject({
      status: 'error',
      error: 'model gone',
    });
  });

  it('活跃计数归零后可以继续委派', async () => {
    const extension = createSubagentExtension({ runner: createRunnerStub() });
    const tool = await loadDelegateTool(extension);
    const ctx = { cwd: '/tmp', model: { provider: 'anthropic', id: 'm' }, thinkingLevel: 'off' };
    await tool.execute(
      'call-1',
      { tasks: [{ agent: 'scout', task: '第一批' }] },
      new AbortController().signal,
      undefined,
      ctx
    );
    const second = await tool.execute(
      'call-2',
      { tasks: [{ agent: 'worker', task: '第二批' }] },
      new AbortController().signal,
      undefined,
      ctx
    );
    expect(second.details?.delegations?.[0]?.status).toBe('success');
  });

  it('同时运行数超限时抛错且不计入结果', async () => {
    // 4 个子 Agent 长时间运行占满上限,第 5 个委派必须被拒绝。
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const releaseGate = () => (release as (() => void) | null)?.();
    const runner: SubagentRunner = {
      run: async (input) => {
        await gate;
        return createRunnerStub().run(input);
      },
    };
    const extension = createSubagentExtension({ runner });
    const tool = await loadDelegateTool(extension);
    const ctx = { cwd: '/tmp', model: { provider: 'anthropic', id: 'm' }, thinkingLevel: 'off' };
    void tool
      .execute(
        'call-1',
        {
          tasks: [
            { agent: 'scout', task: '1' },
            { agent: 'planner', task: '2' },
            { agent: 'reviewer', task: '3' },
            { agent: 'worker', task: '4' },
          ],
        },
        new AbortController().signal,
        undefined,
        ctx
      )
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(
      tool.execute('call-2', { tasks: [{ agent: 'scout', task: '5' }] }, new AbortController().signal, undefined, ctx)
    ).rejects.toThrow('最多同时 4 个');
    releaseGate();
  });
});
