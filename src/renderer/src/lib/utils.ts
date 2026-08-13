import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 Tailwind 类名:clsx 处理条件类,tailwind-merge 消除冲突类。
 *
 * @param inputs - 类名或条件表达式
 * @returns 合并后的类名字符串
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
