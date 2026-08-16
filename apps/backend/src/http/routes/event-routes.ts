import type { Express } from 'express';

import { SESSION_API_PATHS, type AgentStreamEvent } from '@lvdagun/protocol';

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
    // 订阅会同步投递初始快照;响应头就绪前先缓存,避免状态请求与 SSE 建连之间丢事件。
    const pending: AgentStreamEvent[] = [];
    let ready = false;
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const unsubscribe = await sessionManager.subscribe(req.params.sessionId!, (event) => {
      if (!ready) {
        pending.push(event);
        return;
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    res.flushHeaders();
    ready = true;
    for (const event of pending) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    pending.length = 0;
    req.on('close', unsubscribe);
  });
}
