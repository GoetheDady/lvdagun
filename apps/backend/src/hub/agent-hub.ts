/**
 * @file Agent Hub:统一提供模型目录、配置和持久化会话能力。
 */
import {
  createForkSessionTitle,
  resolveSessionTitle,
  type AgentSessionState,
  type AgentStreamEvent,
  type ModelConfig,
  type ModelInfo,
  type ModelReference,
  type ProviderInfo,
  type SessionMessage,
  type SessionSnapshotEvent,
  type SessionSummary,
  type ThinkingLevel,
  type TestConnectionResult,
} from '@lvdagun/protocol';

import type { ConfigStore } from '../config/config-store';
import {
  AgentBusyError,
  type AgentHubAdapter,
  type AgentSessionAdapter,
} from './agent-hub-adapter';

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
  session: AgentSessionAdapter;
  listeners: Set<(event: AgentStreamEvent) => void>;
  unsubscribe: () => void;
  promptAdmission: Promise<unknown> | null;
}

/** 事件订阅及建立订阅时的原子会话快照。 */
export interface SessionSubscription {
  /** 退订事件流 */
  unsubscribe: () => void;
  /** 订阅建立时读取的权威快照 */
  snapshot: SessionSnapshotEvent;
}

/** 本地服务使用的 Agent Hub 接口。 */
export interface AgentHub {
  /** @returns 当前模型配置；尚未配置时返回 null */
  getConfig(): Promise<ModelConfig | null>;

  /** @returns 可配置的 Provider 列表 */
  listProviders(): Promise<ProviderInfo[]>;

  /** @param providerId - Provider 标识 @returns 该 Provider 的模型列表 */
  listModels(providerId: string): Promise<ModelInfo[]>;

  /** @param providerId - Provider 标识 @param apiKey - 待验证凭据 @returns 连接结果 */
  testConnection(providerId: string, apiKey: string): Promise<TestConnectionResult>;

  /** @returns 按最后更新时间倒序排列的全部会话 */
  listSessions(): Promise<SessionSummary[]>;

  /** @returns 新建持久化会话的不透明标识 */
  createSession(): Promise<string>;

  /** @param sourceSessionId - 源会话 @param entryId - 助手回复条目 @returns 派生会话标识 */
  forkSession(sourceSessionId: string, entryId: string): Promise<string>;

  /** @param sessionId - 会话标识 @returns 归档完成后的 Promise */
  archiveSession(sessionId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 永久删除完成后的 Promise */
  deleteSession(sessionId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 结构化消息历史 */
  getMessages(sessionId: string): Promise<SessionMessage[]>;

  /** @param sessionId - 会话标识 @returns Agent 运行与思考等级状态 */
  getState(sessionId: string): Promise<AgentSessionState>;

  /** @param sessionId - 会话标识 @param title - 新标题 @returns 无返回值 */
  setSessionName(sessionId: string, title: string): Promise<void>;

  /**
   * 接受提示；同一会话已有运行时进入待处理区，不同会话可以并行。
   *
   * @param sessionId - 会话标识
   * @param text - 用户提示
   * @returns Pi 接受提示后解决的 Promise
   */
  prompt(sessionId: string, text: string): Promise<void>;

  /**
   * 编辑当前分支最后一条用户消息并重新发送。
   *
   * @param sessionId - 会话标识
   * @param entryId - 最后一条用户消息的 Pi 条目标识
   * @param text - 修改后的文本
   * @returns 提示被接受后的当前分支历史
   */
  editAndResend(sessionId: string, entryId: string, text: string): Promise<SessionMessage[]>;

  /** @param sessionId - 会话标识 @param messageId - 消息标识 @returns 调整方向完成后的 Promise */
  steerPendingMessage(sessionId: string, messageId: string): Promise<void>;

  /** @param sessionId - 会话标识 @param messageId - 消息标识 @returns 无返回值 */
  removePendingMessage(sessionId: string, messageId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 按排队顺序取回的全部文本 */
  takePendingMessages(sessionId: string): Promise<string[]>;

  /** @param sessionId - 会话标识 @returns Agent 稳定后解决的 Promise */
  abort(sessionId: string): Promise<string[]>;

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
   * 订阅指定会话事件，并返回与订阅建立时原子对应的权威快照。
   *
   * @param sessionId - 会话标识
   * @param listener - 事件监听器
   * @returns 事件退订函数和建立订阅时的权威快照
   */
  subscribe(
    sessionId: string,
    listener: (event: AgentStreamEvent) => void
  ): Promise<SessionSubscription>;

  /** @param config - 新模型配置 @returns 保存配置并释放旧 Runtime 后解决的 Promise */
  updateConfig(config: ModelConfig): Promise<void>;

  /** @returns 停止全部运行并释放所有 Runtime 后解决的 Promise */
  dispose(): Promise<void>;
}

/**
 * 创建 Agent Hub。
 *
 * 每个 session id 在进程内至多对应一个 Runtime，避免 Pi JSONL 被多个实例并发写入。
 * 同一会话的提示前置校验串行执行，不同会话的 Runtime 可以并行运行。
 *
 * @param hubAdapter - Pi 持久化和 Runtime 能力适配器
 * @param configStore - 模型配置存取
 * @returns 会话管理操作集
 */
export function createAgentHub(hubAdapter: AgentHubAdapter, configStore: ConfigStore): AgentHub {
  const records = new Map<string, Promise<SessionRecord>>();
  const lifecycleSessionIds = new Set<string>();
  let configurationChanging = false;
  let disposed = false;

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
   * @returns 注册记录
   */
  const register = (session: AgentSessionAdapter): SessionRecord => {
    const listeners = new Set<(event: AgentStreamEvent) => void>();
    const record: SessionRecord = {
      session,
      listeners,
      unsubscribe: () => {},
      promptAdmission: null,
    };
    record.unsubscribe = session.subscribe((event) => {
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
    if (configurationChanging || disposed) {
      throw new AgentBusyError();
    }
    if (lifecycleSessionIds.has(sessionId)) {
      throw new AgentBusyError();
    }
    const existing = records.get(sessionId);
    if (existing) {
      const record = await existing;
      if (lifecycleSessionIds.has(sessionId) || configurationChanging || disposed) {
        throw new AgentBusyError();
      }
      return record;
    }

    const loading = (async (): Promise<SessionRecord> => {
      const config = await loadConfig();
      const session = await hubAdapter.openSession(config, sessionId);
      return register(session);
    })();
    records.set(sessionId, loading);
    try {
      const record = await loading;
      if (lifecycleSessionIds.has(sessionId) || configurationChanging || disposed) {
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
      if (record?.promptAdmission !== null || record?.session.getState().isRunning) {
        throw new AgentBusyError();
      }

      if (record) {
        record.unsubscribe();
        await record.session.dispose();
      }
      records.delete(sessionId);

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
    getConfig: () => configStore.load(),
    listProviders: () => hubAdapter.listProviders(),
    listModels: (providerId) => hubAdapter.listModels(providerId),
    testConnection: (providerId, apiKey) => hubAdapter.testConnection(providerId, apiKey),

    async listSessions(): Promise<SessionSummary[]> {
      const stored = await hubAdapter.listSessions();
      const loaded = await Promise.all(
        [...records.values()].map(async (recordPromise) => recordPromise.catch(() => null))
      );
      const loadedById = new Map(
        loaded
          .filter((record): record is SessionRecord => record !== null)
          .map((record) => [record.session.id, record])
      );
      const summaries = stored.map((session): SessionSummary => {
        const record = loadedById.get(session.id);
        const { name, firstMessage, ...metadata } = session;
        const firstUserMessage = firstMessage === PI_EMPTY_SESSION_MESSAGE ? '' : firstMessage;
        return {
          ...metadata,
          title: resolveSessionTitle({ sessionName: name, firstUserMessage }),
          isRunning:
            record === undefined
              ? false
              : record.promptAdmission !== null || record.session.getState().isRunning,
        };
      });

      return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
    },

    async createSession(): Promise<string> {
      if (configurationChanging || disposed) throw new AgentBusyError();
      const session = await hubAdapter.createSession(await loadConfig());
      const record = register(session);
      records.set(session.id, Promise.resolve(record));
      return session.id;
    },

    async forkSession(sourceSessionId: string, entryId: string): Promise<string> {
      const sourceRecord = await getRecord(sourceSessionId);
      const stored = (await hubAdapter.listSessions()).find(
        (session) => session.id === sourceSessionId
      );
      const firstUserMessage =
        stored?.firstMessage === PI_EMPTY_SESSION_MESSAGE ? '' : stored?.firstMessage;
      const sourceTitle = resolveSessionTitle({
        sessionName: sourceRecord.session.getState().sessionName ?? stored?.name,
        firstUserMessage,
      });
      const session = await hubAdapter.forkSession(
        await loadConfig(),
        sourceSessionId,
        entryId,
        createForkSessionTitle(sourceTitle)
      );
      const record = register(session);
      records.set(session.id, Promise.resolve(record));
      return session.id;
    },

    async archiveSession(sessionId: string): Promise<void> {
      await changeLifecycle(sessionId, { type: 'session_archived', sessionId }, async () =>
        hubAdapter.archiveSession(sessionId)
      );
    },

    async deleteSession(sessionId: string): Promise<void> {
      await changeLifecycle(sessionId, { type: 'session_deleted', sessionId }, async () =>
        hubAdapter.deleteSession(sessionId)
      );
    },

    async getMessages(sessionId: string): Promise<SessionMessage[]> {
      return (await getRecord(sessionId)).session.getMessages();
    },

    async getState(sessionId: string): Promise<AgentSessionState> {
      return (await getRecord(sessionId)).session.getState();
    },

    async setSessionName(sessionId: string, title: string): Promise<void> {
      const record = await getRecord(sessionId);
      if (record.promptAdmission !== null) throw new AgentBusyError();
      record.session.setSessionName(title);
    },

    async prompt(sessionId: string, text: string): Promise<void> {
      const record = await getRecord(sessionId);
      while (record.promptAdmission !== null) {
        await record.promptAdmission.catch(() => undefined);
      }
      if (configurationChanging || disposed || lifecycleSessionIds.has(sessionId)) {
        throw new AgentBusyError();
      }
      const state = record.session.getState();
      if (state.activeCompaction !== null) {
        throw new AgentBusyError();
      }
      if (state.isRunning) {
        record.session.enqueuePendingMessage(text);
        return;
      }
      const admission = record.session.prompt(text);
      record.promptAdmission = admission;
      try {
        await admission;
      } finally {
        if (record.promptAdmission === admission) record.promptAdmission = null;
      }
    },

    async editAndResend(
      sessionId: string,
      entryId: string,
      text: string
    ): Promise<SessionMessage[]> {
      const record = await getRecord(sessionId);
      while (record.promptAdmission !== null) {
        await record.promptAdmission.catch(() => undefined);
      }
      if (configurationChanging || disposed || lifecycleSessionIds.has(sessionId)) {
        throw new AgentBusyError();
      }
      if (record.session.getState().isRunning) throw new AgentBusyError();
      const admission = record.session.editAndResend(entryId, text);
      record.promptAdmission = admission;
      try {
        return await admission;
      } finally {
        if (record.promptAdmission === admission) record.promptAdmission = null;
      }
    },

    async steerPendingMessage(sessionId: string, messageId: string): Promise<void> {
      await (await getRecord(sessionId)).session.steerPendingMessage(messageId);
    },

    async removePendingMessage(sessionId: string, messageId: string): Promise<void> {
      (await getRecord(sessionId)).session.removePendingMessage(messageId);
    },

    async takePendingMessages(sessionId: string): Promise<string[]> {
      return (await getRecord(sessionId)).session.takePendingMessages();
    },

    async abort(sessionId: string): Promise<string[]> {
      return (await getRecord(sessionId)).session.abort();
    },

    async setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<AgentSessionState> {
      const record = await getRecord(sessionId);
      if (record.promptAdmission !== null) throw new AgentBusyError();
      return record.session.setThinkingLevel(level);
    },

    async setModel(sessionId: string, model: ModelReference): Promise<AgentSessionState> {
      const record = await getRecord(sessionId);
      if (record.promptAdmission !== null) throw new AgentBusyError();
      return record.session.setModel(model);
    },

    async subscribe(
      sessionId: string,
      listener: (event: AgentStreamEvent) => void
    ): Promise<SessionSubscription> {
      const record = await getRecord(sessionId);
      record.listeners.add(listener);
      return {
        unsubscribe: () => record.listeners.delete(listener),
        snapshot: record.session.getSnapshot(),
      };
    },

    async updateConfig(config: ModelConfig): Promise<void> {
      if (configurationChanging || disposed) throw new AgentBusyError();
      configurationChanging = true;
      try {
        const loaded = await Promise.all(
          [...records.values()].map(async (recordPromise) => recordPromise.catch(() => null))
        );
        if (
          loaded.some(
            (record) =>
              record !== null &&
              (record.promptAdmission !== null || record.session.getState().isRunning)
          )
        ) {
          throw new AgentBusyError();
        }
        await configStore.save(config);
        await disposeAll();
      } finally {
        configurationChanging = false;
      }
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      configurationChanging = true;
      try {
        await disposeAll();
        disposed = true;
      } finally {
        configurationChanging = false;
      }
    },
  };
}
