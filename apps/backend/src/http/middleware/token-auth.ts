import type { RequestHandler } from 'express';

import { TOKEN_HEADER } from '@lvdagun/protocol';

/**
 * 创建本机访问 token 鉴权中间件。
 *
 * @param token - 服务启动时生成或读取的本机访问 token
 * @returns Express 请求中间件
 */
export function createTokenAuth(token: string): RequestHandler {
  return (req, res, next) => {
    if (req.get(TOKEN_HEADER) === token) {
      next();
      return;
    }
    res.status(401).json({ error: '未授权' });
  };
}
