import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface IconTooltipProps {
  /** 提示文字;同时作为被包裹控件的说明 */
  label: string;
  /** 触发提示的控件,通常是图标按钮 */
  children: React.ReactNode;
  /** 提示相对控件的方位 */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * 给图标控件套统一提示。
 *
 * 取代原生 title:title 要悬停约一秒才出、沿用系统灰气泡与整站风格脱节,
 * 且键盘聚焦时完全不显示。提示文字与控件的可访问名分开维护,
 * 因此控件仍应自带 aria-label 或可见文字。
 *
 * 已知边界:控件 disabled 时 Button 基础样式带 pointer-events-none,
 * 指针事件到不了触发器,提示不显示——这与原生 title 行为一致,不做额外包装。
 *
 * 自带 Provider:Radix 要求 Tooltip 处于 Provider 内,而使用方既有经应用根
 * 渲染的页面也有直接单测渲染的组件,挂到应用根会让后者全部报错
 *
 * @param props - 提示文字、被包裹控件与方位
 * @returns 带提示的控件
 */
export function IconTooltip({ label, children, side }: IconTooltipProps): React.JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
