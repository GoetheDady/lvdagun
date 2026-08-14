import type { Express } from 'express';

import { API_PATHS } from '@lvdagun/protocol';

import type { SessionManager } from '../../sessions/session-manager';

/**
 * 注册对话消息与会话生命周期接口。
 *
 * @param app - Express 应用
 * @param sessionManager - 会话管理器
 * @returns 无返回值
 */
export function registerChatRoutes(app: Express, sessionManager: SessionManager): void {
  app.get(API_PATHS.messages, (_req, res) => {
    res.json(sessionManager.getMessages());
  });

  app.post(API_PATHS.prompt, async (req, res) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    const session = await sessionManager.getSession();
    await session.prompt(text);
    res.status(202).end();
  });

  app.post(API_PATHS.clearSession, (_req, res) => {
    sessionManager.clear();
    res.status(204).end();
  });
}
