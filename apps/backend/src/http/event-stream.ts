import type { RequestHandler, Response } from 'express';

import type { AgentStreamEvent } from '@lvdagun/protocol';

/** SSE 客户端集合及其事件广播能力 */
export interface EventStream {
  /**
   * 向所有已连接客户端广播事件。
   *
   * @param event - 共享协议事件
   * @returns 无返回值
   */
  broadcast(event: AgentStreamEvent): void;

  /** 接受并维护 SSE 连接的 Express 处理器 */
  handler: RequestHandler;
}

/**
 * 创建进程内 SSE 事件流。
 *
 * @returns 事件广播函数和连接处理器
 */
export function createEventStream(): EventStream {
  const clients = new Set<Response>();

  return {
    broadcast(event: AgentStreamEvent): void {
      const frame = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) {
        client.write(frame);
      }
    },

    handler(req, res): void {
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
    },
  };
}
