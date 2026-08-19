import type { Express } from 'express';

import {
  API_PATHS,
  SESSION_API_PATHS,
  type CreateSessionResult,
  type AbortSessionResult,
  type EditResendResult,
  type ForkSessionResult,
  type ModelReference,
  type ThinkingLevel,
  type TakePendingMessagesResult,
} from '@lvdagun/protocol';

import type { AgentHub } from '../../hub/agent-hub';

/**
 * 注册对话消息与 Pi 会话控制接口。
 *
 * @param app - Express 应用
 * @param agentHub - Agent Hub
 * @returns 无返回值
 */
export function registerChatRoutes(app: Express, agentHub: AgentHub): void {
  app.get(API_PATHS.sessions, async (_req, res) => {
    res.json(await agentHub.listSessions());
  });

  app.post(API_PATHS.sessions, async (_req, res) => {
    const result: CreateSessionResult = { sessionId: await agentHub.createSession() };
    res.status(201).json(result);
  });

  app.post(SESSION_API_PATHS.archive, async (req, res) => {
    await agentHub.archiveSession(req.params.sessionId!);
    res.status(204).end();
  });

  app.delete(SESSION_API_PATHS.state, async (req, res) => {
    await agentHub.deleteSession(req.params.sessionId!);
    res.status(204).end();
  });

  app.get(SESSION_API_PATHS.messages, async (req, res) => {
    res.json(await agentHub.getMessages(req.params.sessionId!));
  });

  app.post(SESSION_API_PATHS.forks, async (req, res) => {
    const { entryId } = req.body as { entryId?: unknown };
    if (typeof entryId !== 'string' || entryId === '') {
      res.status(400).json({ error: '消息标识不能为空' });
      return;
    }
    const result: ForkSessionResult = {
      sessionId: await agentHub.forkSession(req.params.sessionId!, entryId),
    };
    res.status(201).json(result);
  });

  app.post(SESSION_API_PATHS.editResend, async (req, res) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    const result: EditResendResult = {
      messages: await agentHub.editAndResend(req.params.sessionId!, req.params.entryId!, text),
    };
    res.json(result);
  });

  app.get(SESSION_API_PATHS.state, async (req, res) => {
    res.json(await agentHub.getState(req.params.sessionId!));
  });

  app.put(SESSION_API_PATHS.title, async (req, res) => {
    const { title } = req.body as { title?: unknown };
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: '标题不能为空' });
      return;
    }
    await agentHub.setSessionName(req.params.sessionId!, title.trim());
    res.status(204).end();
  });

  app.post(SESSION_API_PATHS.prompt, async (req, res) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    await agentHub.prompt(req.params.sessionId!, text);
    res.status(202).end();
  });

  app.post(SESSION_API_PATHS.abort, async (req, res) => {
    const result: AbortSessionResult = {
      restoredTexts: await agentHub.abort(req.params.sessionId!),
    };
    res.json(result);
  });

  app.post(SESSION_API_PATHS.pendingMessageSteer, async (req, res) => {
    await agentHub.steerPendingMessage(req.params.sessionId!, req.params.messageId!);
    res.status(204).end();
  });

  app.delete(SESSION_API_PATHS.pendingMessage, async (req, res) => {
    await agentHub.removePendingMessage(req.params.sessionId!, req.params.messageId!);
    res.status(204).end();
  });

  app.post(SESSION_API_PATHS.pendingMessagesTake, async (req, res) => {
    const result: TakePendingMessagesResult = {
      texts: await agentHub.takePendingMessages(req.params.sessionId!),
    };
    res.json(result);
  });

  app.delete(SESSION_API_PATHS.pendingMessages, async (req, res) => {
    await agentHub.takePendingMessages(req.params.sessionId!);
    res.status(204).end();
  });

  app.put(SESSION_API_PATHS.thinkingLevel, async (req, res) => {
    const { level } = req.body as { level?: unknown };
    const sessionId = req.params.sessionId!;
    const state = await agentHub.getState(sessionId);
    if (
      typeof level !== 'string' ||
      !state.availableThinkingLevels.includes(level as ThinkingLevel)
    ) {
      res.status(400).json({ error: '当前模型不支持该思考等级' });
      return;
    }
    res.json(await agentHub.setThinkingLevel(sessionId, level as ThinkingLevel));
  });

  app.put(SESSION_API_PATHS.model, async (req, res) => {
    const { provider, id } = req.body as { provider?: unknown; id?: unknown };
    if (typeof provider !== 'string' || typeof id !== 'string' || !provider || !id) {
      res.status(400).json({ error: '模型参数不合法' });
      return;
    }
    const model: ModelReference = { provider, id };
    res.json(await agentHub.setModel(req.params.sessionId!, model));
  });
}
