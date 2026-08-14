const TOKEN_KEY = 'lvdagun-token';

/**
 * 从地址栏读取一次性 token，保存后从 URL 中移除。
 *
 * @returns 无返回值
 */
export function initTokenFromUrl(): void {
  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url);
  }
}

/**
 * 读取当前本机访问 token。
 *
 * @returns token；尚未初始化时为 null
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
