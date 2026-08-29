import { describe, expect, it, vi } from 'vitest';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { loadTodoExtension } from '../../../src/extensions/todo/todo-extension';

describe('loadTodoExtension', () => {
  it('从固定上游包加载内置 Extension', async () => {
    const tools: string[] = [];
    const extension = await loadTodoExtension();
    await extension?.factory({
      registerTool: (tool: { name: string }) => tools.push(tool.name),
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      on: () => undefined,
    } as never);

    expect(extension).toMatchObject({
      name: 'lvdagun-session-execution-plan',
      hidden: true,
    });
    expect(tools).toContain('todo');
  });

  it('包装上游 factory 并追加中文计划约束', async () => {
    const handlers = new Map<string, (event: { systemPrompt: string }) => unknown>();
    const upstream = vi.fn<ExtensionFactory>((pi) => {
      pi.on('agent_start', () => undefined);
    });
    const extension = await loadTodoExtension(async () => ({ default: upstream }));
    const pi = {
      on: (name: string, handler: (event: { systemPrompt: string }) => unknown) => {
        handlers.set(name, handler);
      },
    };

    await extension?.factory(pi as never);

    expect(upstream).toHaveBeenCalledOnce();
    expect(extension).toMatchObject({
      name: 'lvdagun-session-execution-plan',
      hidden: true,
    });
    expect(handlers.get('before_agent_start')?.({ systemPrompt: '基础提示' })).toMatchObject({
      systemPrompt: expect.stringContaining('subject、activeForm 和 description 必须使用中文'),
    });
  });

  it('上游加载失败时静默降级', async () => {
    const error = new Error('package missing');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(loadTodoExtension(async () => Promise.reject(error))).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      '会话执行计划 Extension 加载失败，已静默降级:',
      error
    );
    consoleError.mockRestore();
  });
});
