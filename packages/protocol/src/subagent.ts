import { z } from 'zod';

/** 驴打滚内置子 Agent 的固定标识。 */
export type SubagentName = 'scout' | 'planner' | 'reviewer' | 'worker';

/** 一次委派的生命周期状态。interrupted 表示服务重启或停止导致的中断。 */
export type SubagentStatus = 'running' | 'success' | 'error' | 'interrupted';

/** 子 Agent 一次委派的用量摘要。 */
export interface SubagentUsage {
  /** 助手回复轮次数 */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/**
 * 一次委派的展示投影:同时用于运行中的实时草稿和持久化的工具结果。
 *
 * `id` 在一次委派工具调用内稳定;`childSessionId` 指向子 Agent 的真实持久化会话,
 * 是父子会话关联的唯一凭据。
 */
export interface SubagentDelegation {
  id: string;
  agent: SubagentName;
  task: string;
  status: SubagentStatus;
  childSessionId: string | null;
  /** 最终结果文本;超长时被截断 */
  result: string | null;
  usage: SubagentUsage | null;
  error: string | null;
  /** 子 Agent 已执行的工具步数;运行中实时增长 */
  steps: number;
  /** 运行中当前动作的简述;结束后为 null */
  activity: string | null;
  startedAt: number;
  endedAt: number | null;
}

const NonNegativeInt = z.number().int().refine(Number.isFinite).refine((value) => value >= 0);

const SubagentDelegationSchema = z.object({
  id: z.string().min(1),
  agent: z.enum(['scout', 'planner', 'reviewer', 'worker']),
  task: z.string(),
  status: z.enum(['running', 'success', 'error', 'interrupted']),
  childSessionId: z.string().nullable(),
  result: z.string().nullable(),
  usage: z
    .object({
      turns: NonNegativeInt,
      inputTokens: NonNegativeInt,
      outputTokens: NonNegativeInt,
      cost: z.number().refine(Number.isFinite).refine((value) => value >= 0),
    })
    .nullable(),
  error: z.string().nullable(),
  steps: NonNegativeInt,
  activity: z.string().nullable(),
  startedAt: NonNegativeInt,
  endedAt: z.number().int().refine(Number.isFinite).nullable(),
});

const DelegationDetailsSchema = z.object({ delegations: z.array(SubagentDelegationSchema) });

/**
 * 从工具 details 或草稿 partialResult 中解析委派投影。
 *
 * @param value - 未经校验的工具 details 值
 * @returns 合法的委派列表;不合法时返回 null,调用方按"无投影"处理
 */
export function parseSubagentDelegations(value: unknown): SubagentDelegation[] | null {
  const result = DelegationDetailsSchema.safeParse(value);
  return result.success ? (result.data.delegations as SubagentDelegation[]) : null;
}
