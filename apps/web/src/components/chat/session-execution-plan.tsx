import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';

import type { SessionExecutionPlan, SessionExecutionPlanStep } from '@lvdagun/protocol';

const OPEN_DELAY_MS = 100;
const CLOSE_DELAY_MS = 150;

/** @param step - 计划步骤 @returns 当前展示文本 */
function stepLabel(step: SessionExecutionPlanStep): string {
  return step.status === 'in_progress' && step.activeForm ? step.activeForm : step.subject;
}

/** @param step - 计划步骤 @returns 状态图标 */
function StepIcon({ step }: { step: SessionExecutionPlanStep }): React.JSX.Element {
  if (step.status === 'completed') {
    return <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (step.status === 'in_progress') {
    return <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />;
  }
  return <Circle className="size-4 shrink-0 text-muted-foreground/55" />;
}

/**
 * 显示当前会话执行计划，并仅通过鼠标悬停展开步骤详情。
 *
 * @param props.plan - 当前分支的产品计划投影
 * @returns 计划胶囊；没有计划时不渲染
 */
export function SessionExecutionPlanView({
  plan,
}: {
  plan: SessionExecutionPlan | null;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  if (!plan || plan.steps.length === 0) return null;

  const activeIndex = plan.steps.findIndex((step) => step.status === 'in_progress');
  const pendingIndex = plan.steps.findIndex((step) => step.status === 'pending');
  const currentIndex =
    activeIndex >= 0 ? activeIndex : pendingIndex >= 0 ? pendingIndex : plan.steps.length - 1;
  const current = plan.steps[currentIndex]!;

  const schedule = (nextOpen: boolean, delay: number): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen(nextOpen);
      timerRef.current = null;
    }, delay);
  };

  return (
    <div className="relative z-20 mb-2 flex justify-center">
      <div
        className="relative inline-flex"
        onMouseEnter={() => schedule(true, OPEN_DELAY_MS)}
        onMouseLeave={() => schedule(false, CLOSE_DELAY_MS)}
      >
        {open ? (
          <div
            role="status"
            aria-label="会话执行计划详情"
            className="absolute bottom-full left-1/2 mb-3 max-h-64 w-max min-w-72 max-w-[min(36rem,calc(100vw-3rem))] -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
          >
            <ol className="space-y-1">
              {plan.steps.map((step) => (
                <li key={step.id} className="flex min-h-7 items-start gap-2 text-sm leading-5">
                  <StepIcon step={step} />
                  <span
                    className={`min-w-0 break-words ${step.status === 'completed' ? 'text-muted-foreground' : ''}`}
                  >
                    {stepLabel(step)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div
          role="status"
          aria-label={`会话执行计划，第 ${currentIndex + 1} / ${plan.steps.length} 步`}
          className="flex h-10 max-w-[min(32rem,calc(100vw-4rem))] items-center gap-2 rounded-full border border-border bg-card px-4 text-sm text-muted-foreground shadow-sm"
        >
          <LoaderCircle className="size-4 shrink-0 animate-spin text-soy" />
          <span className="shrink-0 font-medium">
            第 {currentIndex + 1} / {plan.steps.length} 步
          </span>
          <span className="truncate">{stepLabel(current)}</span>
        </div>
      </div>
    </div>
  );
}
