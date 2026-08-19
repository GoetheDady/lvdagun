/** @file Express 应用装配：组合中间件、路由和静态客户端资源 */
import { join } from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { ConfigStore } from '../config/config-store';
import { AgentBusyError } from '../hub/hub';
import type { Hub } from '../hub/hub';
import {
  NotConfiguredError,
  createSessionManager,
  type SessionManager,
} from '../sessions/session-manager';
import { registerCatalogRoutes } from './routes/catalog-routes';
import { registerChatRoutes } from './routes/chat-routes';
import { registerConfigRoutes } from './routes/config-routes';
import { registerEventRoutes } from './routes/event-routes';

/** 装配本地服务所需的依赖 */
export interface ServerDeps {
  configStore: ConfigStore;
  hub: Hub;
  /** CLI 需要持有同一实例以便退出时释放全部 Runtime。 */
  sessionManager?: SessionManager;
  /** 生产环境客户端构建产物目录；开发环境不提供 */
  webDist?: string;
}

/**
 * 创建本地服务应用。
 *
 * @param deps - 配置存储、Agent Hub 与可选静态资源目录
 * @returns Express 应用
 */
export function createServer(deps: ServerDeps): express.Express {
  const app = express();
  app.use(express.json());

  const sessionManager = deps.sessionManager ?? createSessionManager(deps.hub, deps.configStore);

  registerConfigRoutes(app, deps.configStore, sessionManager);
  registerCatalogRoutes(app, deps.hub);
  registerChatRoutes(app, sessionManager);
  registerEventRoutes(app, sessionManager);

  if (deps.webDist) {
    app.use(express.static(deps.webDist));
    const indexFile = join(deps.webDist, 'index.html');
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(indexFile);
        return;
      }
      next();
    });
  }

  // Express 通过四参数签名识别错误中间件，因此保留未使用的 next 参数。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof NotConfiguredError || error instanceof AgentBusyError) {
      res.status(409).json({ error: error.message });
      return;
    }
    const status = isStatusError(error) ? error.status : 500;
    const message = error instanceof Error ? error.message : '内部错误';
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ error: status >= 500 ? '内部错误' : message });
  });

  return app;
}

/**
 * 判断错误是否带 HTTP 状态码。
 *
 * @param error - 未知错误
 * @returns 是否带状态码
 */
function isStatusError(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && 'status' in error;
}
