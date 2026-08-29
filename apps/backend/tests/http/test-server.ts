import type { AddressInfo } from 'node:net';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AgentSessionState,
  AvailableModel,
  ModelSettings,
  ThinkingLevel,
} from '@lvdagun/protocol';
import type { Express } from 'express';
import { vi } from 'vitest';

import type { FileConfigStore } from '../../src/config/config-store';
import { ProductHistory } from '../../src/history/product-history';
import type { ProductHistoryRepository } from '../../src/history/product-history-repository';
import type {
  AgentHubAdapter,
  AgentSessionAdapter,
  AgentSessionAdapterEvent,
  ExecutionMessage,
} from '../../src/hub/agent-hub-adapter';
import { SessionNotFoundError } from '../../src/hub/agent-hub-adapter';
import { createAgentHub } from '../../src/hub/agent-hub';
import { attachRpcServer } from '../../src/http/rpc-server';
import { createServer } from '../../src/http/server';
import { MemoryHistoryRepository } from '../history/memory-history-repository';

export const validConfig: ModelSettings = {
  providers: [{ provider: 'anthropic', apiKey: 'sk-test' }],
  defaultModel: { provider: 'anthropic', id: 'claude-a' },
};

const model: AvailableModel = {
  provider: 'anthropic',
  providerName: 'Anthropic',
  id: 'claude-a',
  name: 'Claude A',
};

/** JSON-RPC 集成测试使用的最小 Pi 会话。 */
export class FakeSession implements AgentSessionAdapter {
  readonly createdAt = Date.now();
  readonly messages: ExecutionMessage[] = [];
  readonly listeners = new Set<(event: AgentSessionAdapterEvent) => void>();
  sessionName: string | null = null;
  lastEditedEntryId: string | null = null;
  running = false;

  /** @param id - Pi 会话标识 */
  constructor(readonly id: string) {}

  /** @param text - 用户提示 */
  async prompt(text: string): Promise<void> {
    this.running = true;
    const message: AgentMessage = { role: 'user', content: text, timestamp: Date.now() };
    this.emit({ type: 'agent_start' });
    this.emit({ type: 'message_start', message });
    this.emit({ type: 'message_end', message });
  }

  /** @param text - 待处理文本 */
  enqueuePendingMessage(text: string): void {
    this.emit({ type: 'pending_messages_changed', pendingMessages: [{ id: 'pending-a', text }] });
  }

  /** @returns 无返回值 */
  async steerPendingMessage(): Promise<void> {}
  /** @returns 无返回值 */
  removePendingMessage(): void {}
  /** @returns 空待处理列表 */
  takePendingMessages(): string[] {
    return [];
  }
  /** @param listener - 监听器 @returns 退订函数 */
  subscribe(listener: (event: AgentSessionAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** @returns Pi 执行历史 */
  getExecutionHistory(): ExecutionMessage[] {
    return structuredClone(this.messages);
  }
  /** @param entryId - Pi entry @param text - 新文本 @returns 无返回值 */
  async editAndResend(entryId: string, text: string): Promise<void> {
    this.lastEditedEntryId = entryId;
    await this.prompt(text);
  }
  /** @returns 会话状态 */
  getState(): AgentSessionState {
    return {
      sessionName: this.sessionName,
      executionAvailable: true,
      isRunning: this.running,
      activeCompaction: null,
      pendingMessages: [],
      thinkingLevel: 'medium',
      availableThinkingLevels: ['off', 'medium'],
      model,
      availableModels: [model],
      modelWarning: null,
    };
  }
  /** @returns 不含产品历史的状态快照 */
  getSnapshot() {
    return { type: 'session_snapshot' as const, state: this.getState() };
  }
  /** @param title - 新标题 */
  setSessionName(title: string): void {
    this.sessionName = title;
    this.emit({ type: 'session_info_changed', name: title });
  }
  /** @returns 未处理文本 */
  async abort(): Promise<string[]> {
    this.running = false;
    this.emit({ type: 'agent_settled' });
    return [];
  }
  /** @param level - 思考等级 @returns 状态 */
  async setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState> {
    void level;
    return this.getState();
  }
  /** @returns 状态 */
  async setModel(): Promise<AgentSessionState> {
    return this.getState();
  }
  /** @returns 无返回值 */
  async dispose(): Promise<void> {}
  /** @param event - Pi 或产品状态事件 */
  emit(event: AgentSessionAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** @returns 可控 Hub 适配器与会话 */
export function makeFakeHub(): { hub: AgentHubAdapter; sessions: FakeSession[] } {
  const sessions = [new FakeSession('pi-session-1')];
  let next = 2;
  const hub: AgentHubAdapter = {
    clearLegacySessions: vi.fn(async () => {}),
    listProviders: vi.fn(async () => [{ id: 'anthropic', name: 'Anthropic' }]),
    listModels: vi.fn(async () => [{ id: 'claude-a', name: 'Claude A' }]),
    testConnection: vi.fn(async () => ({ ok: true as const })),
    listSessions: vi.fn(async () => []),
    createSession: vi.fn(async () => {
      const session = new FakeSession(`pi-session-${next++}`);
      sessions.push(session);
      return session;
    }),
    openSession: vi.fn(async (_config, sessionId) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) throw new SessionNotFoundError(sessionId);
      return session;
    }),
    forkSession: vi.fn(async () => {
      const session = new FakeSession(`pi-session-${next++}`);
      sessions.push(session);
      return session;
    }),
    archiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  };
  return { hub, sessions };
}

/** @param hub - 测试 Hub @param configStore - 配置 @returns 随机端口服务 */
export async function startServer(
  hub: AgentHubAdapter,
  configStore: FileConfigStore,
  repository: ProductHistoryRepository = new MemoryHistoryRepository()
): Promise<{
  baseUrl: string;
  history: ProductHistory;
  agentHub: ReturnType<typeof createAgentHub>;
  close: () => Promise<void>;
}> {
  const history = new ProductHistory(repository);
  history.initialize();
  history.beginCreate('session-1', 1);
  history.completeCreate('session-1', 'pi-session-1');
  const agentHub = createAgentHub(hub, configStore, history);
  const app: Express = createServer({});
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const closeRpc = attachRpcServer(server, agentHub);
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    history,
    agentHub,
    close: async () => {
      await closeRpc();
      await agentHub.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
