import { useSyncExternalStore } from 'react';

/**
 * 订阅 CSS 媒体查询的匹配状态，跨断点时触发重渲染。
 *
 * @param query - 媒体查询字符串，如 `(min-width: 48rem)`
 * @returns 当前是否匹配该查询
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener('change', notify);
      return () => mediaQueryList.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
