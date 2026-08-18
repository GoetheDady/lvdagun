import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/utils/class-names';

/**
 * 提供需要用户明确确认的模态对话框状态。
 *
 * @param props - Radix AlertDialog 根组件属性
 * @returns 确认对话框根组件
 */
export function AlertDialog(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Root>
): React.JSX.Element {
  return <AlertDialogPrimitive.Root {...props} />;
}

/**
 * 把任意按钮绑定为确认对话框触发器。
 *
 * @param props - Radix Trigger 属性
 * @returns 确认对话框触发器
 */
export function AlertDialogTrigger(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>
): React.JSX.Element {
  return <AlertDialogPrimitive.Trigger {...props} />;
}

/**
 * 将确认对话框渲染到页面顶层。
 *
 * @param props - Radix Portal 属性
 * @returns 对话框 Portal
 */
function AlertDialogPortal(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>
): React.JSX.Element {
  return <AlertDialogPrimitive.Portal {...props} />;
}

/**
 * 渲染确认对话框后的遮罩层。
 *
 * @param props - Radix Overlay 属性
 * @returns 对话框遮罩层
 */
function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  );
}

/**
 * 渲染确认对话框的主体面板。
 *
 * @param props - Radix Content 属性和对话框内容
 * @returns 居中的对话框面板
 */
export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>): React.JSX.Element {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border bg-background p-5 shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-6',
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

/**
 * 布置确认对话框的标题和说明区域。
 *
 * @param props - 标准 div 属性
 * @returns 对话框头部容器
 */
export function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('space-y-2 text-left', className)} {...props} />;
}

/**
 * 布置确认对话框的操作按钮区域。
 *
 * @param props - 标准 div 属性
 * @returns 对话框底部操作容器
 */
export function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

/**
 * 渲染确认对话框标题。
 *
 * @param props - Radix Title 属性
 * @returns 可访问的对话框标题
 */
export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />
  );
}

/**
 * 渲染确认操作影响范围的说明。
 *
 * @param props - Radix Description 属性
 * @returns 可访问的对话框说明
 */
export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-sm leading-6 text-muted-foreground', className)}
      {...props}
    />
  );
}

/**
 * 渲染取消按钮并关闭确认对话框。
 *
 * @param props - Radix Cancel 属性
 * @returns 取消操作按钮
 */
export function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>): React.JSX.Element {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  );
}

/**
 * 渲染确认按钮并关闭确认对话框。
 *
 * @param props - Radix Action 属性
 * @returns 确认操作按钮
 */
export function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>): React.JSX.Element {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants(), className)} {...props} />;
}
