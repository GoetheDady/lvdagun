/**
 * @file 持久化会话注册表:按 id 懒加载 Pi Runtime、转发事件并约束全局 Agent 运行。
 */
import type {
  AgentSessionState,
  AgentStreamEvent,
  ChatMessage,
  ModelReference,
  SessionSummary,
  ThinkingLevel,
} from '@lvdagun/protocol';

import type { ConfigStore } from '../config/config-store';
import { AgentBusyError, type Hub, type HubSession } from '../hub/hub';

const PI_EMPTY_SESSION_MESSAGE = '(no messages)';

/** 未配置领域错误:HTTP 层映射为 409 */
export class NotConfiguredError extends Error {
  /** 创建未配置错误。 */
  constructor() {
    super('尚未配置模型');
    this.name = 'NotConfiguredError';
  }
}

interface SessionRecord {
  session: HubSession;
  createdAt: number;
  listeners: Set<(event: AgentStreamEvent) => void>;
  unsubscribe: () => void;
}

/** 持久化会话注册表接口 */
export interface SessionManager {
  /** @returns 按最后更新时间倒序排列的全部会话 */
  listSessions(): Promise<SessionSummary[]>;

  /** @returns 新建持久化会话的不透明标识 */
  createSession(): Promise<string>;

  /** @param sessionId - 会话标识 @returns 归档完成后的 Promise */
  archiveSession(sessionId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 永久删除完成后的 Promise */
  deleteSession(sessionId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 结构化消息历史 */
  getMessages(sessionId: string): Promise<ChatMessage[]>;

  /** @param sessionId - 会话标识 @returns Agent 运行与思考等级状态 */
  getState(sessionId: string): Promise<AgentSessionState>;

  /** @param sessionId - 会话标识 @param title - 新标题 @returns 无返回值 */
  setSessionName(sessionId: string, title: string): Promise<void>;

  /**
   * 在全局没有其他 Agent 运行时接受提示。
   *
   * @param sessionId - 会话标识
   * @param text - 用户提示
   * @returns Pi 接受提示后解决的 Promise
   */
  prompt(sessionId: string, text: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns Agent 稳定后解决的 Promise */
  abort(sessionId: string): Promise<void>;

  /**
   * 设置指定会话的思考等级。
   *
   * @param sessionId - 会话标识
   * @param level - 请求的 Pi 思考等级
   * @returns 设置后的会话状态
   */
  setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<AgentSessionState>;

  /**
   * 设置指定会话后续 Agent 运行使用的模型。
   *
   * @param sessionId - 会话标识
   * @param model - 跨 Provider 模型引用
   * @returns 设置后的权威会话状态
   */
  setModel(sessionId: string, model: ModelReference): Promise<AgentSessionState>;

  /**
   * 订阅指定会话事件;注册后首先投递一份权威会话状态。
   *
   * @param sessionId - 会话标识
   * @param listener - 事件监听器
   * @returns 退订函数
   */
  subscribe(sessionId: string, listener: (event: AgentStreamEvent) => void): Promise<() => void>;

  /** @returns 配置变更后释放全部已加载 Runtime */
  invalidate(): Promise<void>;
}

/**
 * 创建持久化会话注册表。
 *
 * 每个 session id 在进程内至多对应一个 Runtime，避免 Pi JSONL 被多个实例并发写入。
 * 当前并行策略尚未纳入产品范围，因此保留单 Agent 全局运行约束。
 *
 * @param hub - Hub 能力
 * @param configStore - 模型配置存取
 * @returns 会话管理操作集
 */
export function createSessionManager(hub: Hub, configStore: ConfigStore): SessionManager {
  const records = new Map<string, Promise<SessionRecord>>();
  const lifecycleSessionIds = new Set<string>();
  let runningSessionId: string | null = null;

  /** @returns 当前有效配置 */
  const loadConfig = async () => {
    const config = await configStore.load();
    if (!config) {
      throw new NotConfiguredError();
    }
    return config;
  };

  /**
   * 注册一个 Runtime，并把 Pi 事件投影给该会话的所有 SSE 订阅者。
   *
   * @param session - Hub 会话
   * @param createdAt - 持久化摘要中的创建时间
   * @returns 注册记录
   */
  const register = (session: HubSession, createdAt = session.createdAt): SessionRecord => {
    const listeners = new Set<(event: AgentStreamEvent) => void>();
    const record: SessionRecord = {
      session,
      createdAt,
      listeners,
      unsubscribe: () => {},
    };
    record.unsubscribe = session.subscribe((event) => {
      if (event.type === 'agent_settled' && runningSessionId === session.id) {
        runningSessionId = null;
      }
      for (const listener of listeners) {
        listener(event);
      }
    });
    return record;
  };

  /** @returns 释放所有已加载 Runtime */
  async function disposeAll(): Promise<void> {
    const pending = [...records.values()];
    records.clear();
    runningSessionId = null;
    const loaded = await Promise.allSettled(pending);
    await Promise.all(
      loaded.flatMap((result) => {
        if (result.status === 'rejected') {
          return [];
        }
        result.value.unsubscribe();
        return [result.value.session.dispose()];
      })
    );
  }

  /**
   * 获取注册记录；并发请求同一 id 时复用同一个加载 Promise。
   *
   * @param sessionId - 会话标识
   * @returns 会话注册记录
   */
  const getRecord = async (sessionId: string): Promise<SessionRecord> => {
    if (lifecycleSessionIds.has(sessionId)) {
      throw new AgentBusyError();
    }
    const existing = records.get(sessionId);
    if (existing) {
      const record = await existing;
      if (lifecycleSessionIds.has(sessionId)) {
        throw new AgentBusyError();
      }
      return record;
    }

    const loading = (async (): Promise<SessionRecord> => {
      const config = await loadConfig();
      const stored = (await hub.listSessions()).find((session) => session.id === sessionId);
      const session = await hub.openSession(config, sessionId);
      return register(session, stored?.createdAt);
    })();
    records.set(sessionId, loading);
    try {
      const record = await loading;
      if (lifecycleSessionIds.has(sessionId)) {
        throw new AgentBusyError();
      }
      return record;
    } catch (error) {
      records.delete(sessionId);
      throw error;
    }
  };

  /**
   * 在会话空闲时释放 Runtime、提交生命周期变化并通知全部订阅者。
   *
   * 生命周期标记先于任何异步步骤写入，避免新的提示或模型变更在检查后穿透。
   *
   * @param sessionId - 会话标识
   * @param event - 提交成功后广播的生命周期事件
   * @param mutate - Hub 持久化操作
   * @returns 生命周期变化完成后的 Promise
   */
  const changeLifecycle = async (
    sessionId: string,
    event: Extract<AgentStreamEvent, { type: 'session_archived' | 'session_deleted' }>,
    mutate: () => Promise<void>
  ): Promise<void> => {
    if (lifecycleSessionIds.has(sessionId)) {
      throw new AgentBusyError();
    }
    lifecycleSessionIds.add(sessionId);
    try {
      const pendingRecord = records.get(sessionId);
      const record = pendingRecord ? await pendingRecord.catch(() => null) : null;
      if (record?.session.getState().isRunning) {
        throw new AgentBusyError();
      }

      if (record) {
        record.unsubscribe();
        await record.session.dispose();
      }
      records.delete(sessionId);
      if (runningSessionId === sessionId) {
        runningSessionId = null;
      }

      await mutate();
      if (record) {
        for (const listener of record.listeners) {
          listener(event);
        }
      }
    } finally {
      lifecycleSessionIds.delete(sessionId);
    }
  };

  return {
    async listSessions(): Promise<SessionSummary[]> {
      const stored = await hub.listSessions();
      const loaded = await Promise.all(
        [...records.values()].map(async (recordPromise) => recordPromise.catch(() => null))
      );
      const loadedById = new Map(
        loaded
          .filter((record): record is SessionRecord => record !== null)
          .map((record) => [record.session.id, record])
      );
      const summaries = new Map<string, SessionSummary>();

      for (const session of stored) {
        const record = loadedById.get(session.id);
        const { name, firstMessage, ...metadata } = session;
        const fallbackTitle =
          firstMessage === PI_EMPTY_SESSION_MESSAGE ? '' : firstMessage.trim();
        summaries.set(session.id, {
          ...metadata,
          title: name?.trim() || fallbackTitle || '新对话',
          isRunning: record?.session.getState().isRunning ?? false,
        });
      }

      return [...summaries.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    },

    async createSession(): Promise<string> {
      const session = await hub.createSession(await loadConfig());
      const record = register(session);
      records.set(session.id, Promise.resolve(record));
      return session.id;
    },

    async archiveSession(sessionId: string): Promise<void> {
      await changeLifecycle(sessionId, { type: 'session_archived', sessionId }, async () =>
        hub.archiveSession(sessionId)
      );
    },

    async deleteSession(sessionId: string): Promise<void> {
      await changeLifecycle(sessionId, { type: 'session_deleted', sessionId }, async () =>
        hub.deleteSession(sessionId)
      );
    },

    async getMessages(sessionId: string): Promise<ChatMessage[]> {
      return (await getRecord(sessionId)).session.getMessages();
    },

    async getState(sessionId: string): Promise<AgentSessionState> {
      return (await getRecord(sessionId)).session.getState();
    },

    async setSessionName(sessionId: string, title: string): Promise<void> {
      (await getRecord(sessionId)).session.setSessionName(title);
    },

    async prompt(sessionId: string, text: string): Promise<void> {
      const record = await getRecord(sessionId);
      if (runningSessionId !== null && runningSessionId !== sessionId) {
        throw new AgentBusyError();
      }
      runningSessionId = sessionId;
      try {
        await record.session.prompt(text);
      } catch (error) {
        if (!record.session.getState().isRunning) {
          runningSessionId = null;
        }
        throw error;
      }
    },

    async abort(sessionId: string): Promise<void> {
      await (await getRecord(sessionId)).session.abort();
    },

    async setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<AgentSessionState> {
      return (await getRecord(sessionId)).session.setThinkingLevel(level);
    },

    async setModel(sessionId: string, model: ModelReference): Promise<AgentSessionState> {
      return (await getRecord(sessionId)).session.setModel(model);
    },

    async subscribe(
      sessionId: string,
      listener: (event: AgentStreamEvent) => void
    ): Promise<() => void> {
      const record = await getRecord(sessionId);
      record.listeners.add(listener);
      listener({ type: 'session_state', state: record.session.getState() });
      return () => record.listeners.delete(listener);
    },

    async invalidate(): Promise<void> {
      await disposeAll();
    },
  };
}
