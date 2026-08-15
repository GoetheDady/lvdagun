import type { Express } from 'express';

import { SESSION_API_PATHS } from '@lvdagun/protocol';

import type { SessionManager } from '../../sessions/session-manager';

/**
 * 注册 SSE 事件流接口。
 *
 * @param app - Express 应用
 * @param sessionManager - 按 id 管理 Runtime 和事件订阅的会话注册表
 * @returns 无返回值
 */
export function registerEventRoutes(app: Express, sessionManager: SessionManager): void {
  app.get(SESSION_API_PATHS.events, async (req, res) => {
    const unsubscribe = await sessionManager.subscribe(req.params.sessionId!, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    req.on('close', unsubscribe);
  });
}
