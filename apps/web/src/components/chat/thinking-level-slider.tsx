import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { ThinkingLevel } from '@lvdagun/protocol';

import { Slider } from '@/components/ui/slider';

/** Pi 思考等级的中文标签。 */
const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

interface ThinkingLevelSliderProps {
  /** 当前服务端权威思考等级 */
  value: ThinkingLevel;
  /** 当前模型按强度递增排列的可用等级 */
  levels: ThinkingLevel[];
  /** Agent 运行或模型更新时禁止修改 */
  disabled: boolean;
  /** 思考等级提交是否仍在进行 */
  loading: boolean;
  /** @param level - 用户完成选择后的思考等级 @returns 服务端处理完成后的 Promise */
  onCommit(level: ThinkingLevel): Promise<void>;
}

interface ThinkingLevelPreview {
  /** 本地预览的思考等级 */
  level: ThinkingLevel;
  /** 产生预览时的服务端权威等级 */
  baseValue: ThinkingLevel;
}

/**
 * 将 Pi 的离散思考等级映射为可预览、完成后提交的 Slider。
 *
 * @param props - 权威等级、可用等级和提交状态
 * @returns 思考等级 Slider
 */
export function ThinkingLevelSlider(props: ThinkingLevelSliderProps): React.JSX.Element {
  const [preview, setPreview] = useState<ThinkingLevelPreview | null>(null);
  const currentLevel =
    preview?.baseValue === props.value && props.levels.includes(preview.level)
      ? preview.level
      : props.value;
  const previewIndex = Math.max(0, props.levels.indexOf(currentLevel));
  const currentLabel = THINKING_LEVEL_LABELS[currentLevel];
  const unavailable = props.disabled || props.loading || props.levels.length <= 1;

  /**
   * 提交用户最终选择的离散思考等级。
   *
   * @param index - 用户完成选择后的离散等级索引
   * @returns 服务端处理完成后的 Promise
   * @throws 当上游思考等级提交失败时透传错误
   */
  const handleCommit = async (index: number): Promise<void> => {
    const level = props.levels[index];
    try {
      if (level && level !== props.value) {
        await props.onCommit(level);
      }
    } finally {
      setPreview(null);
    }
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 px-2 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">
        思考 · <span className="text-foreground">{currentLabel}</span>
      </span>
      <Slider
        className="w-20 sm:w-28"
        value={[previewIndex]}
        min={0}
        max={Math.max(0, props.levels.length - 1)}
        step={1}
        disabled={unavailable}
        onValueChange={([index]) => {
          const level = props.levels[index ?? previewIndex];
          if (level) {
            setPreview({ level, baseValue: props.value });
          }
        }}
        onValueCommit={([index]) => void handleCommit(index ?? previewIndex)}
        thumbProps={{
          'aria-label': '思考等级',
          'aria-disabled': unavailable,
          'aria-valuetext': currentLabel,
        }}
      />
      <span className="flex size-3 items-center justify-center" aria-hidden="true">
        {props.loading ? <Loader2 className="size-3 animate-spin" /> : null}
      </span>
    </div>
  );
}
