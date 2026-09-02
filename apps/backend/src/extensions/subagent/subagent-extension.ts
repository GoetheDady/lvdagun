/**
 * @file 内置子 Agent 委派 Extension。
 *
 * 注册 `delegate` 工具,让主 Agent 可以把任务委派给内置子 Agent。每个子 Agent
 * 在独立内嵌会话中运行(见 subagent-runner),同一会话最多同时运行 4 个子 Agent;
 * 工具通过 onUpdate 流式上报委派投影,最终投影随 toolResult.details 持久化。
 */
import { randomUUID } from 'node:crypto';

import { StringEnum } from '@earendil-works/pi-ai';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SubagentDelegation, SubagentName } from '@lvdagun/protocol';

import { SUBAGENT_AGENTS, formatAgentCatalog } from './subagent-agents';
import type { SubagentRunner, SubagentTaskInput } from './subagent-runner';

/** 同一会话允许同时运行的子 Agent 数上限。 */
export const MAX_PARALLEL_SUBAGENTS = 4;

/** 委派工具的参数形状。 */
interface DelegateParams {
  tasks: Array<{ agent: SubagentName; task: string }>;
}

/** 委派 Extension 模块:可被 Agent Hub 显式加载的隐藏 Extension。 */
export interface SubagentExtension {
  name: 'lvdagun-subagent';
  hidden: true;
  factory: ExtensionFactory;
}

/**
 * 创建子 Agent 委派 Extension。
 *
 * @param options.runner - 子 Agent 运行器,负责创建内嵌会话并执行任务
 * @returns 可装配进 Agent Hub 的隐藏 Extension
 */
export function createSubagentExtension(options: { runner: SubagentRunner }): SubagentExtension {
  return {
    name: 'lvdagun-subagent',
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      // 同一会话最多同时运行 4 个子 Agent;两次 delegate 调用并行发起时按活跃数合并计数。
      let activeCount = 0;
      pi.registerTool({
        name: 'delegate',
        label: '委派子 Agent',
        description: `把任务委派给专门的子 Agent,它们在隔离上下文中执行并返回最终结果。可用子 Agent:${formatAgentCatalog()}。tasks 数组一次最多 ${MAX_PARALLEL_SUBAGENTS} 个并行;适合并行的独立调查、批量审查等场景。`,
        parameters: Type.Object({
          tasks: Type.Array(
            Type.Object({
              agent: StringEnum(['scout', 'planner', 'reviewer', 'worker'] as const, {
                description: '子 Agent 名称',
              }),
              task: Type.String({ description: '交给该子 Agent 的完整任务描述' }),
            }),
            {
              minItems: 1,
              maxItems: MAX_PARALLEL_SUBAGENTS,
              description: `要并行执行的委派列表,最多 ${MAX_PARALLEL_SUBAGENTS} 项`,
            }
          ),
        }),
        async execute(
          _toolCallId: string,
          params: DelegateParams,
          signal: AbortSignal,
          onUpdate: ((partial: AgentToolResult<{ delegations: SubagentDelegation[] }>) => void) | undefined,
          ctx: ExtensionContext
        ): Promise<AgentToolResult<{ delegations: SubagentDelegation[] }>> {
          const delegations: SubagentDelegation[] = params.tasks.map((item) => ({
            id: randomUUID(),
            agent: item.agent,
            task: item.task,
            status: 'running',
            childSessionId: null,
            result: null,
            usage: null,
            error: null,
            steps: 0,
            activity: null,
            startedAt: Date.now(),
            endedAt: null,
          }));

          /**
           * 把当前委派投影流式上报给产品草稿链路。
           *
           * 每次发送条目快照而非共享数组引用:草稿与事件可能在任意时刻被下游保留,
           * 原地更新会让历史快照跟着变化。
           *
           * @param contentOverride - 结束时用于替换正文的结果文本
           */
          const emit = (contentOverride?: string): void => {
            onUpdate?.({
              content: [{ type: 'text', text: contentOverride ?? progressText(delegations) }],
              details: { delegations: delegations.map((item) => ({ ...item })) },
            });
          };
          emit();

          if (!ctx.model) {
            throw new Error('当前会话没有可用模型,无法委派子 Agent');
          }
          if (activeCount + delegations.length > MAX_PARALLEL_SUBAGENTS) {
            // Pi 约定工具错误通过 throw 上报(自动标记 isError);委派尚未开始,没有投影需要保留。
            throw new Error(
              `已有 ${activeCount} 个子 Agent 在运行,最多同时 ${MAX_PARALLEL_SUBAGENTS} 个;请先等待部分完成后再委派。`
            );
          }
          activeCount += delegations.length;
          try {
            await Promise.all(
              delegations.map(async (delegation, index) => {
                const input: SubagentTaskInput = {
                  agent: SUBAGENT_AGENTS[delegation.agent],
                  task: delegation.task,
                  cwd: ctx.cwd,
                  model: ctx.model!,
                  thinkingLevel: ctx.thinkingLevel,
                  signal,
                  onProgress: (latest) => {
                    delegations[index] = latest;
                    emit();
                  },
                };
                try {
                  delegations[index] = await options.runner.run(input);
                } catch (error) {
                  // 单个子 Agent 失败只标记该条委派,其余结果照常返回。
                  delegations[index] = {
                    ...delegation,
                    status: signal.aborted ? 'interrupted' : 'error',
                    error: error instanceof Error ? error.message : String(error),
                    activity: null,
                    endedAt: Date.now(),
                  };
                }
                emit();
              })
            );
          } finally {
            activeCount -= delegations.length;
          }

          // 单个子 Agent 失败不抛错:失败状态保存在投影里,其余结果照常返回给主 Agent。
          emit(summaryText(delegations));
          return {
            content: [{ type: 'text', text: summaryText(delegations) }],
            details: { delegations },
          };
        },
      });
    },
  };
}

/** @param delegations - 当前委派列表 @returns 运行期间的简短进度文本 */
function progressText(delegations: SubagentDelegation[]): string {
  return delegations
    .map((item) => {
      const stage = item.activity ?? '等待开始';
      return `${item.agent}: ${stage}`;
    })
    .join('\n');
}

/** @param delegations - 已结束的委派列表 @returns 返回给主 Agent 的结果汇总 */
function summaryText(delegations: SubagentDelegation[]): string {
  return delegations
    .map((item) => {
      const header = `## ${item.agent}(${
        item.status === 'success' ? '成功' : item.status === 'interrupted' ? '已中断' : '失败'
      })`;
      if (item.status !== 'success') {
        return `${header}\n${item.error ?? '没有返回结果'}`;
      }
      return `${header}\n${item.result ?? ''}`;
    })
    .join('\n\n');
}
