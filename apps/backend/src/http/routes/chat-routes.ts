import type { Express } from 'express';

import {
  API_PATHS,
  SESSION_API_PATHS,
  type CreateSessionResult,
  type ModelReference,
  type ThinkingLevel,
} from '@lvdagun/protocol';

import type { SessionManager } from '../../sessions/session-manager';

/**
 * 注册对话消息与 Pi 会话控制接口。
 *
 * @param app - Express 应用
 * @param sessionManager - 会话管理器
 * @returns 无返回值
 */
export function registerChatRoutes(app: Express, sessionManager: SessionManager): void {
  app.get(API_PATHS.sessions, async (_req, res) => {
    res.json(await sessionManager.listSessions());
  });

  app.post(API_PATHS.sessions, async (_req, res) => {
    const result: CreateSessionResult = { sessionId: await sessionManager.createSession() };
    res.status(201).json(result);
  });

  app.post(SESSION_API_PATHS.archive, async (req, res) => {
    await sessionManager.archiveSession(req.params.sessionId!);
    res.status(204).end();
  });

  app.delete(SESSION_API_PATHS.state, async (req, res) => {
    await sessionManager.deleteSession(req.params.sessionId!);
    res.status(204).end();
  });

  app.get(SESSION_API_PATHS.messages, async (req, res) => {
    res.json(await sessionManager.getMessages(req.params.sessionId!));
  });

  app.get(SESSION_API_PATHS.state, async (req, res) => {
    res.json(await sessionManager.getState(req.params.sessionId!));
  });

  app.put(SESSION_API_PATHS.title, async (req, res) => {
    const { title } = req.body as { title?: unknown };
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: '标题不能为空' });
      return;
    }
    await sessionManager.setSessionName(req.params.sessionId!, title.trim());
    res.status(204).end();
  });

  app.post(SESSION_API_PATHS.prompt, async (req, res) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    await sessionManager.prompt(req.params.sessionId!, text);
    res.status(202).end();
  });

  app.post(SESSION_API_PATHS.abort, async (req, res) => {
    await sessionManager.abort(req.params.sessionId!);
    res.status(204).end();
  });

  app.put(SESSION_API_PATHS.thinkingLevel, async (req, res) => {
    const { level } = req.body as { level?: unknown };
    const sessionId = req.params.sessionId!;
    const state = await sessionManager.getState(sessionId);
    if (
      typeof level !== 'string' ||
      !state.availableThinkingLevels.includes(level as ThinkingLevel)
    ) {
      res.status(400).json({ error: '当前模型不支持该思考等级' });
      return;
    }
    res.json(await sessionManager.setThinkingLevel(sessionId, level as ThinkingLevel));
  });

  app.put(SESSION_API_PATHS.model, async (req, res) => {
    const { provider, id } = req.body as { provider?: unknown; id?: unknown };
    if (typeof provider !== 'string' || typeof id !== 'string' || !provider || !id) {
      res.status(400).json({ error: '模型参数不合法' });
      return;
    }
    const model: ModelReference = { provider, id };
    res.json(await sessionManager.setModel(req.params.sessionId!, model));
  });
}
