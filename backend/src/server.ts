/**
 * @file 本地服务:express 应用装配。
 *
 * 全部业务接口挂 /api 前缀并校验 token(本机 CSRF 防护,见 PRD 8 非功能需求);
 * 对话事件经 /api/events 以 SSE 推给客户端。生产模式下同时托管 web 静态资源。
 */
import { join } from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';

import { parseModelConfig, type ConfigStore } from './config';
import type { Hub, HubSession } from './hub';
import type { ChatMessage, HubEvent, ModelConfig } from './protocol';

/** 装配服务所需的依赖(测试注入假实现) */
export interface ServerDeps {
  configStore: ConfigStore;
  hub: Hub;
  /** 本机访问 token:所有 /api 请求必须携带 */
  token: string;
  /** web 构建产物目录;未提供时仅提供 API(dev 模式由 vite 提供页面) */
  webDist?: string;
}

/** 带 HTTP 状态码的业务错误,由错误中间件转成 JSON 响应 */
class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * 创建本地服务应用。
 *
 * @param deps - 依赖注入
 * @returns express 应用
 */
export function createServer(deps: ServerDeps): express.Express {
  const app = express();
  app.use(express.json());

  // SSE 客户端集合:会话事件广播到所有已连接的客户端
  const clients = new Set<Response>();
  const broadcast = (event: HubEvent): void => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      client.write(frame);
    }
  };

  const sessionManager = createSessionManager(deps.hub, deps.configStore, broadcast);

  app.use('/api', (req, res, next) => {
    if (req.headers['x-lvdagun-token'] === deps.token) {
      next();
      return;
    }
    res.status(401).json({ error: '未授权' });
  });

  app.get('/api/config', async (_req, res) => {
    res.json(await deps.configStore.load());
  });

  app.put('/api/config', async (req, res) => {
    let config: ModelConfig;
    try {
      config = parseModelConfig(req.body);
    } catch {
      res.status(400).json({ error: '配置不合法' });
      return;
    }
    await deps.configStore.save(config);
    // 模型变了,旧会话作废:下次对话按新配置重建
    sessionManager.invalidate();
    res.status(204).end();
  });

  app.post('/api/test-connection', async (req, res) => {
    const { provider, apiKey } = req.body as { provider?: unknown; apiKey?: unknown };
    if (typeof provider !== 'string' || typeof apiKey !== 'string') {
      res.status(400).json({ error: '请求不合法' });
      return;
    }
    res.json(await deps.hub.testConnection(provider, apiKey));
  });

  app.get('/api/providers', async (_req, res) => {
    res.json(await deps.hub.listProviders());
  });

  app.get('/api/models', async (req, res) => {
    const provider = req.query.provider;
    if (typeof provider !== 'string') {
      res.status(400).json({ error: '缺少 provider 参数' });
      return;
    }
    res.json(await deps.hub.listModels(provider));
  });

  app.get('/api/messages', async (_req, res) => {
    res.json(sessionManager.getMessages());
  });

  app.post('/api/prompt', async (req, res) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }
    const session = await sessionManager.getSession();
    await session.prompt(text);
    res.status(202).end();
  });

  app.post('/api/session/clear', async (_req, res) => {
    sessionManager.clear();
    res.status(204).end();
  });

  app.get('/api/events', (req, res) => {
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    clients.add(res);
    req.on('close', () => {
      clients.delete(res);
    });
  });

  if (deps.webDist) {
    // 生产模式:托管 web 构建产物,非 /api 的 GET 一律回落到 index.html(SPA 路由)
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

  // 错误中间件:HttpError 按状态码返回,其余按 500(express 5 自动把 async 异常送到这里)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- express 要求 4 参数才识别为错误中间件
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
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
 * 会话管理:懒创建、配置变更失效、事件广播。
 *
 * @param hub - Hub 能力
 * @param configStore - 配置存取
 * @param broadcast - 事件广播函数(发给所有 SSE 客户端)
 * @returns 会话管理操作集
 */
function createSessionManager(
  hub: Hub,
  configStore: ConfigStore,
  broadcast: (event: HubEvent) => void
): {
  /** 获取当前会话;未配置时抛 409,配置变更时按新配置重建 */
  getSession(): Promise<HubSession>;
  /** 当前会话消息历史;无会话时为空 */
  getMessages(): ChatMessage[];
  /** 清空会话并向所有客户端广播 */
  clear(): void;
  /** 配置变更后作废当前会话(下次对话重建) */
  invalidate(): void;
} {
  let session: HubSession | null = null;
  /** 创建会话时用的配置指纹:配置不变就复用会话 */
  let sessionKey: string | null = null;
  let unsubscribe: (() => void) | null = null;

  const dispose = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    session?.dispose();
    session = null;
    sessionKey = null;
  };

  const keyOf = (config: ModelConfig): string => `${config.provider}\n${config.modelId}\n${config.apiKey}`;

  return {
    async getSession(): Promise<HubSession> {
      const config = await configStore.load();
      if (!config) {
        throw new HttpError(409, '尚未配置模型');
      }
      const key = keyOf(config);
      if (!session || sessionKey !== key) {
        dispose();
        session = await hub.createSession(config);
        sessionKey = key;
        unsubscribe = session.subscribe(broadcast);
      }
      return session;
    },

    getMessages() {
      return session ? session.getMessages() : [];
    },

    clear(): void {
      const hadSession = session !== null;
      dispose();
      if (hadSession) {
        broadcast({ type: 'session_cleared' });
      }
    },

    invalidate(): void {
      dispose();
    },
  };
}

/**
 * 判断错误是否带 HTTP 状态码(express 的 body 解析错误带 status/statusCode)。
 *
 * @param error - 未知错误
 * @returns 是否带状态码
 */
function isStatusError(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && 'status' in error;
}
