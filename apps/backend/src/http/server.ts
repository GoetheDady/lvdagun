/** @file Express 应用装配：托管静态客户端资源 */
import { join } from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';

/** 装配本地服务所需的依赖 */
export interface ServerDeps {
  /** 生产环境客户端构建产物目录；开发环境不提供 */
  webDist?: string;
}

/**
 * 创建本地服务应用。
 *
 * @param deps - 可选静态资源目录
 * @returns Express 应用
 */
export function createServer(deps: ServerDeps): express.Express {
  const app = express();

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

  return app;
}
