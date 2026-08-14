import type { Express } from 'express';

import { API_PATHS } from '@lvdagun/protocol';

import type { Hub } from '../../hub/hub';

/**
 * 注册 Provider、模型目录与连接测试接口。
 *
 * @param app - Express 应用
 * @param hub - Agent Hub
 * @returns 无返回值
 */
export function registerCatalogRoutes(app: Express, hub: Hub): void {
  app.post(API_PATHS.testConnection, async (req, res) => {
    const { provider, apiKey } = req.body as { provider?: unknown; apiKey?: unknown };
    if (typeof provider !== 'string' || typeof apiKey !== 'string') {
      res.status(400).json({ error: '请求不合法' });
      return;
    }
    res.json(await hub.testConnection(provider, apiKey));
  });

  app.get(API_PATHS.providers, async (_req, res) => {
    res.json(await hub.listProviders());
  });

  app.get(API_PATHS.models, async (req, res) => {
    const provider = req.query.provider;
    if (typeof provider !== 'string') {
      res.status(400).json({ error: '缺少 provider 参数' });
      return;
    }
    res.json(await hub.listModels(provider));
  });
}
