/**
 * @file Agent Hub:统一提供模型目录、配置和持久化会话能力。
 */
import {
  createForkSessionTitle,
  type AgentSessionState,
  type AgentStreamEvent,
  type ModelConfig,
  type ModelInfo,
  type ModelReference,
  type ProviderInfo,
  type ProductSessionHistory,
  type SessionSnapshotEvent,
  type SessionSummary,
  type ThinkingLevel,
  type TestConnectionResult,
} from '@lvdagun/protocol';
import { randomUUID } from 'node:crypto';

import type { ConfigStore } from '../config/config-store';
import { ProductHistory } from '../history/product-history';
import { ProductHistoryRecorder } from '../history/product-history-recorder';
import {
  AgentBusyError,
  SessionNotFoundError,
  type AgentSessionAdapterEvent,
  type AgentHubAdapter,
  type AgentSessionAdapter,
} from './agent-hub-adapter';

/** 未配置领域错误:HTTP 层映射为 409 */
export class NotConfiguredError extends Error {
  /** 创建未配置错误。 */
  constructor() {
    super('尚未配置模型');
    this.name = 'NotConfiguredError';
  }
}

interface SessionRecord {
  productSessionId: string;
  session: AgentSessionAdapter;
  listeners: Set<(event: AgentStreamEvent) => void>;
  unsubscribeState: () => void;
  unsubscribeHistory: () => void;
  recorder: ProductHistoryRecorder;
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

  /** @param sourceSessionId - 源会话 @param runId - 助手回复运行 @returns 派生会话标识 */
  forkSession(sourceSessionId: string, runId: string): Promise<string>;

  /** @param sessionId - 会话标识 @returns 归档完成后的 Promise */
  archiveSession(sessionId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 永久删除完成后的 Promise */
  deleteSession(sessionId: string): Promise<void>;

  /** @param sessionId - 会话标识 @returns 产品会话历史 */
  getMessages(sessionId: string): Promise<ProductSessionHistory>;

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
   * @param itemId - 最后一条产品用户消息标识
   * @param text - 修改后的文本
   * @returns 提示被接受后的当前分支历史
   */
  editAndResend(sessionId: string, itemId: string, text: string): Promise<ProductSessionHistory>;

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
export function createAgentHub(
  hubAdapter: AgentHubAdapter,
  configStore: ConfigStore,
  history: ProductHistory
): AgentHub {
  const records = new Map<string, Promise<SessionRecord>>();
  const lifecycleSessionIds = new Set<string>();
  const recoverySessionIds = new Set<string>();
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

  /** @returns Pi 执行文件丢失时仍可展示产品历史的只读状态 */
  const createReadOnlyState = async (sessionId: string): Promise<AgentSessionState> => {
    const config = await loadConfig();
    const [providers, models] = await Promise.all([
      hubAdapter.listProviders(),
      hubAdapter.listModels(config.provider),
    ]);
    const selected = models.find((model) => model.id === config.modelId);
    return {
      sessionName:
        history.listSessions().find((session) => session.id === sessionId)?.title ?? null,
      executionAvailable: false,
      isRunning: false,
      activeCompaction: null,
      pendingMessages: [],
      thinkingLevel: 'off',
      availableThinkingLevels: ['off'],
      model: {
        provider: config.provider,
        providerName:
          providers.find((provider) => provider.id === config.provider)?.name ?? config.provider,
        id: config.modelId,
        name: selected?.name ?? config.modelId,
      },
      availableModels: [],
      modelWarning: 'Pi 执行历史已丢失，当前会话只能查看，不能继续、编辑或分叉',
    };
  };

  /**
   * 注册一个 Runtime，并把 Pi 事件投影给该会话的所有订阅者。
   *
   * @param session - Hub 会话
   * @returns 注册记录
   */
  const register = (productSessionId: string, session: AgentSessionAdapter): SessionRecord => {
    const listeners = new Set<(event: AgentStreamEvent) => void>();
    const recorder = new ProductHistoryRecorder(history, productSessionId, session, (error) => {
      handleHistoryFailure(error);
    });
    const handleHistoryFailure = (error: unknown): void => {
      console.error('产品会话历史写入失败:', error);
      recoverySessionIds.add(productSessionId);
      recorder.detach();
      void session.abort().catch(() => undefined);
    };
    const record: SessionRecord = {
      productSessionId,
      session,
      listeners,
      unsubscribeState: () => {},
      unsubscribeHistory: () => {},
      recorder,
      promptAdmission: null,
    };
    record.unsubscribeState = session.subscribe((event) => {
      if (event.type === 'session_info_changed') {
        try {
          // 标题先进入产品历史，避免客户端看见无法在重启后恢复的状态。
          history.setTitle(productSessionId, event.name ?? null);
        } catch (error) {
          handleHistoryFailure(error);
          return;
        }
      }
      if (!isClientStateEvent(event)) return;
      for (const listener of listeners) {
        listener(event);
      }
    });
    record.unsubscribeHistory = history.subscribe(productSessionId, (event) => {
      for (const listener of listeners) listener(event);
    });
    recorder.attach();
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
        result.value.unsubscribeState();
        result.value.unsubscribeHistory();
        result.value.recorder.detach();
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
    if (lifecycleSessionIds.has(sessionId) || recoverySessionIds.has(sessionId)) {
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
      const session = await hubAdapter.openSession(config, history.getPiSessionId(sessionId));
      return register(sessionId, session);
    })();
    records.set(sessionId, loading);
    try {
      const record = await loading;
      if (
        lifecycleSessionIds.has(sessionId) ||
        recoverySessionIds.has(sessionId) ||
        configurationChanging ||
        disposed
      ) {
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
        record.unsubscribeState();
        record.unsubscribeHistory();
        record.recorder.detach();
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
      const stored = history.listSessions();
      const loaded = await Promise.all(
        [...records.values()].map(async (recordPromise) => recordPromise.catch(() => null))
      );
      const loadedById = new Map(
        loaded
          .filter((record): record is SessionRecord => record !== null)
          .map((record) => [record.productSessionId, record])
      );
      const summaries = stored.map((session): SessionSummary => {
        const record = loadedById.get(session.id);
        return {
          ...session,
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
      const sessionId = randomUUID();
      history.beginCreate(sessionId);
      try {
        const session = await hubAdapter.createSession(await loadConfig());
        history.completeCreate(sessionId, session.id);
        const record = register(sessionId, session);
        records.set(sessionId, Promise.resolve(record));
        return sessionId;
      } catch (error) {
        history.cancelCreate(sessionId);
        throw error;
      }
    },

    async forkSession(sourceSessionId: string, runId: string): Promise<string> {
      const sourceRecord = await getRecord(sourceSessionId);
      const sessionId = randomUUID();
      history.beginCreate(sessionId);
      history.setLifecycle(sessionId, 'forking');
      try {
        const sourceTitle = history
          .listSessions()
          .find((item) => item.id === sourceSessionId)?.title;
        const session = await hubAdapter.forkSession(
          await loadConfig(),
          sourceRecord.session.id,
          history.resolveRunEntry(sourceSessionId, runId),
          createForkSessionTitle(sourceTitle ?? '新对话')
        );
        history.completeCreate(sessionId, session.id);
        history.copyForkHistory(sessionId, sourceSessionId, runId);
        const record = register(sessionId, session);
        records.set(sessionId, Promise.resolve(record));
        return sessionId;
      } catch (error) {
        history.cancelCreate(sessionId);
        throw error;
      }
    },

    async archiveSession(sessionId: string): Promise<void> {
      const piSessionId = history.getPiSessionId(sessionId);
      history.setLifecycle(sessionId, 'archiving');
      try {
        await changeLifecycle(sessionId, { type: 'session_archived', sessionId }, async () =>
          hubAdapter.archiveSession(piSessionId)
        );
        history.finishArchive(sessionId);
      } catch (error) {
        history.setLifecycle(sessionId, 'active');
        throw error;
      }
    },

    async deleteSession(sessionId: string): Promise<void> {
      const piSessionId = history.getPiSessionId(sessionId);
      history.setLifecycle(sessionId, 'deleting');
      try {
        await changeLifecycle(sessionId, { type: 'session_deleted', sessionId }, async () =>
          hubAdapter.deleteSession(piSessionId)
        );
        history.finishDelete(sessionId);
      } catch (error) {
        history.setLifecycle(sessionId, 'active');
        throw error;
      }
    },

    async getMessages(sessionId: string): Promise<ProductSessionHistory> {
      return history.getSnapshot(sessionId);
    },

    async getState(sessionId: string): Promise<AgentSessionState> {
      try {
        return (await getRecord(sessionId)).session.getState();
      } catch (error) {
        if (error instanceof SessionNotFoundError) return createReadOnlyState(sessionId);
        throw error;
      }
    },

    async setSessionName(sessionId: string, title: string): Promise<void> {
      const record = await getRecord(sessionId);
      if (record.promptAdmission !== null) throw new AgentBusyError();
      history.setTitle(sessionId, title);
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
      const runId = history.acceptPrompt(sessionId, text);
      const admission = record.session.prompt(text).catch((error) => {
        history.declineRun(sessionId, runId);
        throw error;
      });
      record.promptAdmission = admission;
      try {
        await admission;
      } finally {
        if (record.promptAdmission === admission) record.promptAdmission = null;
      }
    },

    async editAndResend(
      sessionId: string,
      itemId: string,
      text: string
    ): Promise<ProductSessionHistory> {
      const record = await getRecord(sessionId);
      while (record.promptAdmission !== null) {
        await record.promptAdmission.catch(() => undefined);
      }
      if (configurationChanging || disposed || lifecycleSessionIds.has(sessionId)) {
        throw new AgentBusyError();
      }
      if (record.session.getState().isRunning) throw new AgentBusyError();
      const edit = history.beginEditResend(sessionId, itemId, text);
      const admission = record.session.editAndResend(edit.piEntryId, text).catch((error) => {
        history.declineEditResend(sessionId, edit.previousBranchId, edit.runId);
        throw error;
      });
      record.promptAdmission = admission;
      try {
        await admission;
        return history.getSnapshot(sessionId);
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
      try {
        const record = await getRecord(sessionId);
        record.listeners.add(listener);
        return {
          unsubscribe: () => record.listeners.delete(listener),
          snapshot: {
            ...record.session.getSnapshot(),
            history: history.getSnapshot(sessionId),
          },
        };
      } catch (error) {
        if (!(error instanceof SessionNotFoundError)) throw error;
        const unsubscribe = history.subscribe(sessionId, listener);
        return {
          unsubscribe,
          snapshot: {
            type: 'session_snapshot',
            history: history.getSnapshot(sessionId),
            state: await createReadOnlyState(sessionId),
          },
        };
      }
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
        history.close();
        disposed = true;
      } finally {
        configurationChanging = false;
      }
    },
  };
}

/** @param event - 后端适配器事件 @returns 是否可直接广播给客户端 */
function isClientStateEvent(
  event: AgentSessionAdapterEvent
): event is Extract<AgentSessionAdapterEvent, AgentStreamEvent> {
  return (
    event.type === 'session_model_changed' ||
    event.type === 'pending_messages_changed' ||
    event.type === 'session_info_changed' ||
    event.type === 'thinking_level_changed'
  );
}
