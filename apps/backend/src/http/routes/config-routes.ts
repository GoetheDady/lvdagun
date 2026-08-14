import type { Express } from 'express';

import { API_PATHS, type ModelConfig } from '@lvdagun/protocol';

import type { ConfigStore } from '../../config/config-store';
import { parseModelConfig } from '../../config/model-config';
import type { SessionManager } from '../../sessions/session-manager';

/**
 * 注册模型配置读写接口。
 *
 * @param app - Express 应用
 * @param configStore - 模型配置存储
 * @param sessionManager - 配置变更后需要失效的会话管理器
 * @returns 无返回值
 */
export function registerConfigRoutes(
  app: Express,
  configStore: ConfigStore,
  sessionManager: SessionManager
): void {
  app.get(API_PATHS.config, async (_req, res) => {
    res.json(await configStore.load());
  });

  app.put(API_PATHS.config, async (req, res) => {
    let config: ModelConfig;
    try {
      config = parseModelConfig(req.body);
    } catch {
      res.status(400).json({ error: '配置不合法' });
      return;
    }
    await configStore.save(config);
    await sessionManager.invalidate();
    res.status(204).end();
  });
}
