import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionSummary } from '@lvdagun/protocol';

import { api } from '@/services/api-client';

/** 侧边栏会话列表状态与操作 */
export interface SessionList {
  sessions: SessionSummary[];
  loading: boolean;
  creating: boolean;
  mutatingSessionId: string | null;
  error: string | null;
  /** @returns 新会话标识 */
  createSession(): Promise<string | null>;
  /** @param sessionId - 会话标识 @returns 是否归档成功 */
  archiveSession(sessionId: string): Promise<boolean>;
  /** @param sessionId - 会话标识 @returns 是否删除成功 */
  deleteSession(sessionId: string): Promise<boolean>;
  /** @param sessionId - 会话标识 @param title - 新标题 @returns 是否重命名成功 */
  renameSession(sessionId: string, title: string): Promise<boolean>;
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
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(null);
  const mutationRef = useRef<string | null>(null);
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

  /**
   * 执行会话生命周期操作并立即从普通列表移除目标会话。
   *
   * @param sessionId - 会话标识
   * @param operation - 归档或删除接口调用
   * @returns 操作是否成功
   */
  const mutateSession = useCallback(
    async (sessionId: string, operation: (id: string) => Promise<void>): Promise<boolean> => {
      if (mutationRef.current !== null) {
        return false;
      }
      mutationRef.current = sessionId;
      setMutatingSessionId(sessionId);
      try {
        await operation(sessionId);
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        setError(null);
        return true;
      } catch (mutationError) {
        setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
        return false;
      } finally {
        mutationRef.current = null;
        setMutatingSessionId(null);
      }
    },
    []
  );

  /** @param sessionId - 会话标识 @returns 是否归档成功 */
  const archiveSession = useCallback(
    (sessionId: string): Promise<boolean> => mutateSession(sessionId, api.archiveSession),
    [mutateSession]
  );

  /** @param sessionId - 会话标识 @returns 是否删除成功 */
  const deleteSession = useCallback(
    (sessionId: string): Promise<boolean> => mutateSession(sessionId, api.deleteSession),
    [mutateSession]
  );

  /** @param sessionId - 会话标识 @param title - 新标题 @returns 是否重命名成功 */
  const renameSession = useCallback(
    async (sessionId: string, title: string): Promise<boolean> => {
      if (mutationRef.current !== null) {
        return false;
      }
      mutationRef.current = sessionId;
      setMutatingSessionId(sessionId);
      try {
        await api.setSessionTitle(sessionId, title);
        setSessions((current) =>
          current.map((session) => (session.id === sessionId ? { ...session, title } : session))
        );
        setError(null);
        return true;
      } catch (renameError) {
        setError(renameError instanceof Error ? renameError.message : String(renameError));
        return false;
      } finally {
        mutationRef.current = null;
        setMutatingSessionId(null);
      }
    },
    []
  );

  return {
    sessions,
    loading,
    creating,
    mutatingSessionId,
    error,
    createSession,
    archiveSession,
    deleteSession,
    renameSession,
    refresh,
  };
}
