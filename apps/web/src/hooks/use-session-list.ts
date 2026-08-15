import { useCallback, useEffect, useState } from 'react';

import type { SessionSummary } from '@lvdagun/protocol';

import { api } from '@/services/api-client';

/** 侧边栏会话列表状态与操作 */
export interface SessionList {
  sessions: SessionSummary[];
  loading: boolean;
  creating: boolean;
  error: string | null;
  /** @returns 新会话标识 */
  createSession(): Promise<string | null>;
  /** @returns 列表刷新完成后的 Promise */
  refresh(): Promise<void>;
}

/**
 * 加载并定期刷新持久化会话摘要。
 *
 * 轮询仅投影轻量元数据，使切走后仍在运行的会话能及时更新侧栏状态；消息流继续使用
 * 会话专属 SSE，不把多个 Pi 事件流混在一起。
 *
 * @returns 会话列表状态和创建操作
 */
export function useSessionList(): SessionList {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 获取最新会话摘要并保留现有列表直至请求完成。
   *
   * @returns 列表刷新完成后的 Promise
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSessions(await api.listSessions());
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 2500);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  /**
   * 创建一个持久化会话并刷新列表。
   *
   * @returns 新会话标识；创建失败或正在创建时返回 null
   */
  const createSession = useCallback(async (): Promise<string | null> => {
    if (creating) {
      return null;
    }
    setCreating(true);
    try {
      const result = await api.createSession();
      await refresh();
      return result.sessionId;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      return null;
    } finally {
      setCreating(false);
    }
  }, [creating, refresh]);

  return { sessions, loading, creating, error, createSession, refresh };
}
