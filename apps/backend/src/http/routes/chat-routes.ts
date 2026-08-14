import type { Express } from 'express';

import { API_PATHS, type ThinkingLevel } from '@lvdagun/protocol';

import type { SessionManager } from '../../sessions/session-manager';

/**
 * 注册对话消息与 Pi 会话控制接口。
 *
 * @param app - Express 应用
 * @param sessionManager - 会话管理器
 * @returns 无返回值
 */
export function registerChatRoutes(app: Express, sessionManager: SessionManager): void {
  app.get(API_PATHS.messages, (_req, res) => {
    res.json(sessionManager.getMessages());
  });

  app.get(API_PATHS.sessionState, async (_req, res) => {
    res.json(await sessionManager.getState());
  });

  app.post(API_PATHS.prompt, async (req, res) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    await (await sessionManager.getSession()).prompt(text);
    res.status(202).end();
  });

  app.post(API_PATHS.newSession, async (_req, res) => {
    await sessionManager.newSession();
    res.status(204).end();
  });

  app.post(API_PATHS.abortSession, async (_req, res) => {
    await sessionManager.abort();
    res.status(204).end();
  });

  app.put(API_PATHS.thinkingLevel, async (req, res) => {
    const { level } = req.body as { level?: unknown };
    const state = await sessionManager.getState();
    if (
      typeof level !== 'string' ||
      !state.availableThinkingLevels.includes(level as ThinkingLevel)
    ) {
      res.status(400).json({ error: '当前模型不支持该思考等级' });
      return;
    }
    res.json(await sessionManager.setThinkingLevel(level as ThinkingLevel));
  });
}
