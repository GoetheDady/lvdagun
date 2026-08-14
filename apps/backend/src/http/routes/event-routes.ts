import type { Express } from 'express';

import { API_PATHS } from '@lvdagun/protocol';

import type { EventStream } from '../event-stream';

/**
 * 注册 SSE 事件流接口。
 *
 * @param app - Express 应用
 * @param eventStream - SSE 事件流
 * @returns 无返回值
 */
export function registerEventRoutes(app: Express, eventStream: EventStream): void {
  app.get(API_PATHS.events, eventStream.handler);
}
