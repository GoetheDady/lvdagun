import { Bot, CircleAlert, CircleCheck, Loader2 } from 'lucide-react';

import type { SubagentDelegation } from '@lvdagun/protocol';

import { MarkdownText } from './markdown-text';

const AGENT_LABELS: Record<SubagentDelegation['agent'], string> = {
  scout: '侦察',
  planner: '规划',
  reviewer: '审查',
  worker: '执行',
};

const STATUS_LABELS: Record<SubagentDelegation['status'], string> = {
  running: '运行中',
  success: '已完成',
  error: '失败',
  interrupted: '已中断',
};

/** @param usage - 用量摘要 @returns 紧凑的用量文本;无用量返回 null */
function formatUsage(usage: NonNullable<SubagentDelegation['usage']>): string | null {
  const parts: string[] = [];
  if (usage.turns > 0) parts.push(`${usage.turns} 轮`);
  if (usage.inputTokens > 0) parts.push(`↑${formatTokens(usage.inputTokens)}`);
  if (usage.outputTokens > 0) parts.push(`↓${formatTokens(usage.outputTokens)}`);
  if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(4)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** @param count - token 数 @returns 紧凑计数 */
function formatTokens(count: number): string {
  return count >= 10000 ? `${Math.round(count / 1000)}k` : count.toString();
}

/** @param props - 单次委派的实时或最终投影 @returns 消息流中的子 Agent 卡片 */
function SubagentCard({ delegation }: { delegation: SubagentDelegation }): React.JSX.Element {
  const running = delegation.status === 'running';
  const failed = delegation.status === 'error';
  const interrupted = delegation.status === 'interrupted';
  const usage = delegation.usage ? formatUsage(delegation.usage) : null;
  return (
    <div
      className={`overflow-hidden rounded-lg bg-soy-wash ${
        failed || interrupted
          ? 'text-destructive ring-1 ring-destructive/35'
          : running
            ? 'ring-1 ring-soy/45'
            : ''
      }`}
    >
      <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-xs">
        <Bot className={`size-3.5 ${failed || interrupted ? '' : 'text-soy'}`} />
        <span className="shrink-0 font-medium">{AGENT_LABELS[delegation.agent]}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={delegation.task}>
          {delegation.task}
        </span>
        {running && delegation.activity ? (
          <span className="hidden shrink-0 text-soy-foreground sm:inline">
            {delegation.activity}
            {delegation.steps > 0 ? `(${delegation.steps})` : ''}
          </span>
        ) : null}
        <span
          className={
            running
              ? 'shrink-0 text-soy-foreground'
              : failed || interrupted
                ? 'shrink-0'
                : 'shrink-0 text-muted-foreground'
          }
        >
          {STATUS_LABELS[delegation.status]}
        </span>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-soy" />
        ) : failed || interrupted ? (
          <CircleAlert className="size-3.5 shrink-0" />
        ) : (
          <CircleCheck className="size-3.5 shrink-0 text-soy" />
        )}
      </div>
      {running ? null : delegation.status === 'success' && delegation.result ? (
        <div className="border-t border-soy/15 bg-card/70 px-3 py-2.5">
          <MarkdownText text={delegation.result} />
          {usage ? (
            <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground">{usage}</p>
          ) : null}
        </div>
      ) : (delegation.status === 'error' || delegation.status === 'interrupted') &&
        delegation.error ? (
        <p className="border-t border-destructive/20 bg-card/70 px-3 py-2.5 text-xs leading-5">
          {delegation.error}
        </p>
      ) : null}
    </div>
  );
}

/** @param props - 委派工具调用的子 Agent 投影列表 @returns 一次委派工具调用的全部子 Agent 卡片 */
export function SubagentCards(props: {
  delegations: SubagentDelegation[];
  entrance?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`space-y-2.5 ${
        props.entrance ? 'animate-in fade-in slide-in-from-bottom-2 duration-300' : ''
      }`}
    >
      {props.delegations.map((delegation) => (
        <SubagentCard key={delegation.id} delegation={delegation} />
      ))}
    </div>
  );
}
