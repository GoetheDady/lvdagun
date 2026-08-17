/** 本地服务监听地址 */
export const SERVICE_HOST = 'localhost';

/** 本地服务默认端口 */
export const DEFAULT_SERVICE_PORT = 16345;

/** Vite 开发服务器固定端口 */
export const DEV_WEB_PORT = 16346;

/** 客户端与本地服务共享的 HTTP 路径 */
export const API_PATHS = {
  config: '/api/config',
  testConnection: '/api/test-connection',
  providers: '/api/providers',
  models: '/api/models',
  sessions: '/api/sessions',
} as const;

/** Express 注册按会话寻址接口时使用的路径模板 */
export const SESSION_API_PATHS = {
  state: `${API_PATHS.sessions}/:sessionId`,
  title: `${API_PATHS.sessions}/:sessionId/title`,
  messages: `${API_PATHS.sessions}/:sessionId/messages`,
  prompt: `${API_PATHS.sessions}/:sessionId/prompt`,
  abort: `${API_PATHS.sessions}/:sessionId/abort`,
  archive: `${API_PATHS.sessions}/:sessionId/archive`,
  model: `${API_PATHS.sessions}/:sessionId/model`,
  thinkingLevel: `${API_PATHS.sessions}/:sessionId/thinking-level`,
  events: `${API_PATHS.sessions}/:sessionId/events`,
} as const;

/**
 * 创建客户端访问指定会话时使用的 HTTP 路径。
 *
 * @param sessionId - 不透明会话标识
 * @returns 指定会话的全部资源路径
 */
export function sessionApiPaths(sessionId: string): {
  state: string;
  title: string;
  messages: string;
  prompt: string;
  abort: string;
  archive: string;
  model: string;
  thinkingLevel: string;
  events: string;
} {
  const base = `${API_PATHS.sessions}/${encodeURIComponent(sessionId)}`;
  return {
    state: base,
    title: `${base}/title`,
    messages: `${base}/messages`,
    prompt: `${base}/prompt`,
    abort: `${base}/abort`,
    archive: `${base}/archive`,
    model: `${base}/model`,
    thinkingLevel: `${base}/thinking-level`,
    events: `${base}/events`,
  };
}
