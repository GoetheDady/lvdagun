import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionSummary } from '@lvdagun/protocol';

import { api } from '@/services/api-client';
import { getRpcConnection } from '@/services/rpc-client';

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
 * 订阅持久化会话摘要的权威快照和变化通知。
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
    if (import.meta.env.MODE === 'test') {
      const timer = window.setTimeout(() => void refresh(), 0);
      return () => window.clearTimeout(timer);
    }
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    void getRpcConnection()
      .subscribeSessionList({
        onList: (next) => {
          if (!closed) {
            setSessions(next);
            setLoading(false);
            setError(null);
          }
        },
        onDisconnect: () => {
          if (!closed) setError('连接已断开');
        },
        onError: (error) => {
          if (!closed) {
            setLoading(false);
            setError(error.message);
          }
        },
      })
      .then((close) => {
        if (closed) close();
        else unsubscribe = close;
      })
      .catch((error) => {
        if (!closed) {
          setLoading(false);
          setError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      closed = true;
      unsubscribe?.();
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
   * 执行会话列表操作并投影成功后的列表状态。
   *
   * @param sessionId - 会话标识
   * @param operation - 会话接口调用
   * @param updateSessions - 操作成功后的列表投影，默认移除目标会话
   * @returns 操作是否成功
   */
  const mutateSession = useCallback(
    async (
      sessionId: string,
      operation: (id: string) => Promise<void>,
      updateSessions: (sessions: SessionSummary[]) => SessionSummary[] = (current) =>
        current.filter((session) => session.id !== sessionId)
    ): Promise<boolean> => {
      if (mutationRef.current !== null) {
        return false;
      }
      mutationRef.current = sessionId;
      setMutatingSessionId(sessionId);
      try {
        await operation(sessionId);
        setSessions(updateSessions);
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
    (sessionId: string, title: string): Promise<boolean> =>
      mutateSession(
        sessionId,
        (id) => api.setSessionTitle(id, title),
        (current) =>
          current.map((session) => (session.id === sessionId ? { ...session, title } : session))
      ),
    [mutateSession]
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
