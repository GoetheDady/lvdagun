import { cn } from '@/utils/class-names';

/** @param props - Marker 根元素属性 @returns 对话内状态标记 */
export function Marker({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="marker"
      className={cn(
        'group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*="size-"])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

/** @param props - Marker 图标容器属性 @returns 对辅助技术隐藏的图标插槽 */
export function MarkerIcon({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    />
  );
}

/** @param props - Marker 文字容器属性 @returns 状态文字插槽 */
export function MarkerContent({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      data-slot="marker-content"
      className={cn('min-w-0 break-words *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground', className)}
      {...props}
    />
  );
}
