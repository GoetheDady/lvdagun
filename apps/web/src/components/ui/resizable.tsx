import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/utils/class-names';

/**
 * 布置可调整尺寸的相邻面板。
 *
 * @param props - react-resizable-panels Group 属性
 * @returns 面板组元素
 */
function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps): React.JSX.Element {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  );
}

/**
 * 渲染面板组中的一个区域。
 *
 * @param props - react-resizable-panels Panel 属性
 * @returns 可调整尺寸的面板元素
 */
function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps): React.JSX.Element {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * 渲染带键盘语义的面板分隔条。
 *
 * @param props - react-resizable-panels Separator 属性
 * @returns 可拖动的分隔条元素
 */
function ResizableHandle({
  className,
  ...props
}: ResizablePrimitive.SeparatorProps): React.JSX.Element {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
        className
      )}
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
