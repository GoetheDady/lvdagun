import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { cn } from '@/utils/class-names';

/**
 * 管理下拉菜单的打开状态和菜单项行为。
 *
 * @param props - Radix DropdownMenu 根组件属性
 * @returns 下拉菜单根组件
 */
export function DropdownMenu(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>
): React.JSX.Element {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/**
 * 渲染打开下拉菜单的触发器。
 *
 * @param props - Radix DropdownMenu Trigger 属性
 * @returns 下拉菜单触发器
 */
export function DropdownMenuTrigger(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>
): React.JSX.Element {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

/**
 * 将下拉菜单内容渲染到页面顶层。
 *
 * @param props - Radix DropdownMenu Content 属性和菜单内容
 * @returns 下拉菜单内容
 */
export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/**
 * 渲染一个可执行的下拉菜单项。
 *
 * @param props - 菜单项属性和可选的视觉变体
 * @returns 下拉菜单项
 */
export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive';
}): React.JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        'relative flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  );
}
