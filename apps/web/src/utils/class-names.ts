import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 className:先 clsx 再 tailwind-merge(冲突时后者覆盖)。
 *
 * @param inputs - 任意数量的 className
 * @returns 合并结果
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
