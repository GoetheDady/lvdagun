/** 本地服务监听地址 */
export const SERVICE_HOST = 'localhost';

/** 本地服务默认端口 */
export const DEFAULT_SERVICE_PORT = 16345;

/** Vite 开发服务器固定端口 */
export const DEV_WEB_PORT = 16346;

/** 所有 API 请求携带本机访问 token 的请求头 */
export const TOKEN_HEADER = 'x-lvdagun-token';

/** 客户端与本地服务共享的 HTTP 路径 */
export const API_PATHS = {
  config: '/api/config',
  testConnection: '/api/test-connection',
  providers: '/api/providers',
  models: '/api/models',
  messages: '/api/messages',
  prompt: '/api/prompt',
  clearSession: '/api/session/clear',
  events: '/api/events',
} as const;
