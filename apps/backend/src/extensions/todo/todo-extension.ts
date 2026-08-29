import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

const TODO_PACKAGE_NAME = '@juicesharp/rpiv-todo';
const TODO_GUIDANCE = `
会话执行计划规则:
- 仅为包含多个可独立推进步骤、需要持续跟踪进度的复杂目标使用 todo 工具;简单工作和普通对话不要使用。
- subject、activeForm 和 description 必须使用中文。
- 由你创建并维护计划状态;用户只查看计划,通过消息调整目标。`;

interface TodoModule {
  default: ExtensionFactory;
}

type TodoImporter = () => Promise<Partial<TodoModule>>;

/**
 * 加载并包装上游 Todo Extension。
 *
 * 包缺失或初始化入口不合法时静默降级，只留下内部诊断，不能阻断会话创建。
 *
 * @returns 可显式装配的内置 Extension；加载失败返回 null
 */
export async function loadTodoExtension(
  importTodo: TodoImporter = async () => (await import(TODO_PACKAGE_NAME)) as Partial<TodoModule>
): Promise<{ name: string; hidden: true; factory: ExtensionFactory } | null> {
  try {
    const module = await importTodo();
    if (typeof module.default !== 'function') throw new Error('上游包没有默认 Extension factory');
    const upstreamFactory = module.default;
    return {
      name: 'lvdagun-session-execution-plan',
      hidden: true,
      factory: async (pi) => {
        await upstreamFactory(pi);
        pi.on('before_agent_start', (event) => ({
          systemPrompt: `${event.systemPrompt}\n\n${TODO_GUIDANCE}`,
        }));
      },
    };
  } catch (error) {
    console.error('会话执行计划 Extension 加载失败，已静默降级:', error);
    return null;
  }
}
