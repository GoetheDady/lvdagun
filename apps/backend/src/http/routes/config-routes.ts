import type { Express } from 'express';

import { API_PATHS, type ModelConfig } from '@lvdagun/protocol';

import { parseModelConfig } from '../../config/model-config';
import type { AgentHub } from '../../hub/agent-hub';

/**
 * 注册模型配置读写接口。
 *
 * @param app - Express 应用
 * @param agentHub - Agent Hub
 * @returns 无返回值
 */
export function registerConfigRoutes(app: Express, agentHub: AgentHub): void {
  app.get(API_PATHS.config, async (_req, res) => {
    res.json(await agentHub.getConfig());
  });

  app.put(API_PATHS.config, async (req, res) => {
    let config: ModelConfig;
    try {
      config = parseModelConfig(req.body);
    } catch {
      res.status(400).json({ error: '配置不合法' });
      return;
    }
    await agentHub.updateConfig(config);
    res.status(204).end();
  });
}
