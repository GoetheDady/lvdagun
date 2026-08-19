import type { Express, NextFunction } from 'express';

import { SESSION_API_PATHS, type AgentStreamEvent } from '@lvdagun/protocol';

import type { AgentHub } from '../../hub/agent-hub';
import { SessionArchivedError, SessionNotFoundError } from '../../hub/agent-hub-adapter';

/**
 * 注册 SSE 事件流接口。
 *
 * @param app - Express 应用
 * @param agentHub - 按 id 管理 Runtime、快照和事件订阅的 Agent Hub
 * @returns 无返回值
 */
export function registerEventRoutes(app: Express, agentHub: AgentHub): void {
  app.get(SESSION_API_PATHS.events, async (req, res, next: NextFunction) => {
    // 先订阅再取快照；订阅建立后产生的事件会暂存，确保快照与实时流之间没有缺口。
    const pending: AgentStreamEvent[] = [];
    let ready = false;
    let closed = false;
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    req.on('close', () => {
      closed = true;
    });

    try {
      const subscription = await agentHub.subscribe(req.params.sessionId!, (event) => {
        if (!ready) {
          pending.push(event);
          return;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      if (closed) {
        subscription.unsubscribe();
        return;
      }
      req.on('close', subscription.unsubscribe);
      res.flushHeaders();
      res.write(`data: ${JSON.stringify(subscription.snapshot)}\n\n`);
      ready = true;
      for (const event of pending) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      pending.length = 0;
    } catch (error) {
      if (error instanceof SessionArchivedError || error instanceof SessionNotFoundError) {
        res.flushHeaders();
        res.write(
          `data: ${JSON.stringify({
            type: 'session_unavailable',
            reason: error instanceof SessionArchivedError ? 'archived' : 'missing',
          } satisfies AgentStreamEvent)}\n\n`
        );
        res.end();
        return;
      }
      next(error);
    }
  });
}
