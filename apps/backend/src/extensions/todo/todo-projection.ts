import type {
  SessionExecutionPlan,
  SessionExecutionPlanStep,
  SessionExecutionPlanStepStatus,
} from '@lvdagun/protocol';

const TODO_ACTIONS = new Set(['create', 'update', 'list', 'get', 'delete', 'clear']);
const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed', 'deleted']);

/**
 * 把上游 Todo 的完整工具结果校验为稳定的产品展示投影。
 *
 * `undefined` 表示快照非法，调用方必须保留上一份合法投影；`null` 表示合法清空。
 *
 * @param details - Pi `toolResult.details`
 * @returns 合法计划、合法清空或非法标记
 */
export function projectTodoDetails(details: unknown): SessionExecutionPlan | null | undefined {
  if (!isRecord(details) || !TODO_ACTIONS.has(String(details.action))) return undefined;
  if (!isRecord(details.params) || !Array.isArray(details.tasks)) return undefined;
  if (!Number.isInteger(details.nextId) || Number(details.nextId) < 1) return undefined;
  if (details.error !== undefined && typeof details.error !== 'string') return undefined;

  const ids = new Set<number>();
  const steps: SessionExecutionPlanStep[] = [];
  for (const value of details.tasks) {
    if (!isRecord(value) || !isValidTask(value, ids)) return undefined;
    ids.add(value.id as number);
    if (value.status === 'deleted') continue;
    steps.push({
      id: value.id as number,
      subject: value.subject as string,
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(typeof value.activeForm === 'string' ? { activeForm: value.activeForm } : {}),
      status: value.status as SessionExecutionPlanStepStatus,
    });
  }

  const maxId = ids.size === 0 ? 0 : Math.max(...ids);
  if ((details.nextId as number) <= maxId) return undefined;
  return steps.length === 0 ? null : { steps };
}

/** @param value - 上游任务 @param ids - 已出现标识 @returns 是否足以安全投影 */
function isValidTask(value: Record<string, unknown>, ids: Set<number>): boolean {
  return (
    Number.isInteger(value.id) &&
    Number(value.id) > 0 &&
    !ids.has(value.id as number) &&
    typeof value.subject === 'string' &&
    value.subject.trim() !== '' &&
    TODO_STATUSES.has(String(value.status)) &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.activeForm === undefined || typeof value.activeForm === 'string') &&
    (value.blockedBy === undefined ||
      (Array.isArray(value.blockedBy) && value.blockedBy.every(Number.isInteger))) &&
    (value.owner === undefined || typeof value.owner === 'string') &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
}

/** @param value - 未知值 @returns 是否为普通对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
