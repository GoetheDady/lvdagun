import {
  assertRpcMethodResult,
  RPC_PATH,
  RPC_PROTOCOL_VERSION,
  RPC_WEBSOCKET_SUBPROTOCOL,
  parseRpcServerMessage,
  type AgentStreamEvent,
  type RpcError,
  type RpcMethod,
  type RpcRequest,
  type SessionSnapshotEvent,
  type SessionSummary,
} from '@lvdagun/protocol';

type EventListener = (event: AgentStreamEvent) => void;
const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export type HubConnectionStatus = 'connecting' | 'connected' | 'failed';

interface Subscription {
  onEvent: EventListener;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}
interface ListSubscription {
  onList: (sessions: SessionSummary[]) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

let nextId = 1;
let shared: RpcConnection | null = null;

/** 浏览器与 Agent Hub 共用的一条 JSON-RPC WebSocket 连接。 */
export function getRpcConnection(): RpcConnection {
  shared ??= new RpcConnection();
  return shared;
}

export class RpcConnection {
  private socket: WebSocket | null = null;
  private initializedSocket: WebSocket | null = null;
  private connectionCycle: Promise<void> | null = null;
  private restoration: Promise<void> | null = null;
  private status: HubConnectionStatus = 'connecting';
  private readonly statusListeners = new Set<() => void>();
  private readonly pending = new Map<
    number,
    {
      method: RpcMethod;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private readonly listSubscriptions = new Set<ListSubscription>();

  /** @returns Hub 连接的当前状态 */
  readonly getStatus = (): HubConnectionStatus => this.status;

  /**
   * 订阅 Hub 连接状态变化。
   *
   * @param listener - 状态变化回调
   * @returns 取消订阅函数
   */
  readonly subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  /** 在用户确认后从失败态开启新的连接轮次。 */
  reconnect(): void {
    if (this.status !== 'failed') return;
    this.startRestoration(true);
  }

  /** 发起一个 JSON-RPC request。 */
  async request<T>(method: RpcMethod, params?: unknown): Promise<T> {
    await this.ensureConnected();
    const id = nextId++;
    const message: RpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error('请求超时，执行结果未知'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        const socket = this.socket;
        if (!socket || socket !== this.initializedSocket) throw new Error('Hub 连接已断开');
        socket.send(JSON.stringify(message));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** 订阅一个会话，并接收权威快照后的实时事件。 */
  async subscribeSession(sessionId: string, subscription: Subscription): Promise<() => void> {
    const existing = this.subscriptions.get(sessionId);
    const set = existing ?? new Set<Subscription>();
    set.add(subscription);
    this.subscriptions.set(sessionId, set);
    const unsubscribe = (): void => {
      set.delete(subscription);
      if (set.size === 0) {
        this.subscriptions.delete(sessionId);
        void this.request('session/unsubscribe', { scope: 'session', sessionId }).catch(
          () => undefined
        );
      }
    };
    try {
      if (!existing) {
        const snapshot = await this.request<SessionSnapshotEvent>('session/subscribe', {
          sessionId,
        });
        subscription.onEvent(snapshot);
      }
    } catch (error) {
      if (this.status === 'failed') {
        subscription.onError?.(toError(error));
        return unsubscribe;
      }
      set.delete(subscription);
      if (set.size === 0) this.subscriptions.delete(sessionId);
      throw error;
    }
    return unsubscribe;
  }

  /** 订阅会话列表的权威快照和变化通知。 */
  async subscribeSessionList(subscription: ListSubscription): Promise<() => void> {
    const alreadySubscribed = this.listSubscriptions.size > 0;
    this.listSubscriptions.add(subscription);
    const unsubscribe = (): void => {
      this.listSubscriptions.delete(subscription);
      if (this.listSubscriptions.size === 0)
        void this.request('session/unsubscribe', { scope: 'list' }).catch(() => undefined);
    };
    try {
      if (!alreadySubscribed)
        subscription.onList(await this.request<SessionSummary[]>('session/list'));
    } catch (error) {
      if (this.status === 'failed') {
        subscription.onError?.(toError(error));
        return unsubscribe;
      }
      this.listSubscriptions.delete(subscription);
      throw error;
    }
    return unsubscribe;
  }

  private async ensureConnected(restartFailed = false): Promise<void> {
    if (
      this.status === 'connected' &&
      this.socket === this.initializedSocket &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      return;
    }
    if (this.connectionCycle) return this.connectionCycle;
    if (this.status === 'failed' && !restartFailed) throw new Error('Hub 连接失败');

    this.setStatus('connecting');
    const cycle = this.runConnectionCycle();
    this.connectionCycle = cycle;
    try {
      await cycle;
    } finally {
      if (this.connectionCycle === cycle) this.connectionCycle = null;
    }
  }

  private async runConnectionCycle(): Promise<void> {
    let lastError = new Error('Hub 连接失败');
    for (let attempt = 0; attempt <= RECONNECT_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await this.wait(RECONNECT_DELAYS_MS[attempt - 1]!);
      try {
        const socket = await this.openOnce();
        if (
          socket !== this.socket ||
          socket !== this.initializedSocket ||
          socket.readyState !== WebSocket.OPEN
        ) {
          throw new Error('Hub 连接已断开');
        }
        this.setStatus('connected');
        return;
      } catch (error) {
        lastError = toError(error);
      }
    }
    this.setStatus('failed');
    throw lastError;
  }

  private openOnce(): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let socket: WebSocket;
      try {
        socket = new WebSocket(
          `${protocol}//${window.location.host}${RPC_PATH}`,
          RPC_WEBSOCKET_SUBPROTOCOL
        );
      } catch (error) {
        reject(toError(error));
        return;
      }
      let openingError = new Error('Hub 连接已断开');
      this.socket = socket;
      socket.onopen = () => {
        const id = nextId++;
        const timeout = window.setTimeout(() => {
          if (!this.pending.delete(id)) return;
          openingError = new Error('初始化超时');
          socket.close();
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, {
          method: 'initialize',
          resolve: () => {
            this.initializedSocket = socket;
            resolve(socket);
          },
          reject: (error) => {
            openingError = error;
            socket.close();
          },
          timeout,
        });
        try {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              method: 'initialize',
              params: {
                protocolVersion: RPC_PROTOCOL_VERSION,
                clientInfo: { name: 'lvdagun-web', version: '0.1.0' },
                capabilities: {},
              },
            })
          );
        } catch (error) {
          openingError = toError(error);
          socket.close();
        }
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onerror = () => {
        openingError = new Error('WebSocket 连接失败');
        socket.close();
      };
      socket.onclose = () => {
        const wasConnected = this.initializedSocket === socket;
        if (this.socket === socket) this.socket = null;
        if (this.initializedSocket === socket) this.initializedSocket = null;
        for (const request of this.pending.values()) {
          window.clearTimeout(request.timeout);
          request.reject(openingError);
        }
        this.pending.clear();
        reject(openingError);
        if (wasConnected) {
          this.setStatus('connecting');
          for (const set of this.subscriptions.values())
            for (const item of set) item.onDisconnect?.();
          for (const item of this.listSubscriptions) item.onDisconnect?.();
          this.startRestoration(false);
        }
      };
    });
  }

  private startRestoration(restartFailed: boolean): void {
    if (this.restoration) return;
    const restoration = this.restoreSubscriptions(restartFailed);
    this.restoration = restoration;
    void restoration.finally(() => {
      if (this.restoration === restoration) this.restoration = null;
    });
  }

  private async restoreSubscriptions(restartFailed: boolean): Promise<void> {
    try {
      await this.ensureConnected(restartFailed);
      for (const [sessionId, set] of this.subscriptions) {
        const snapshot = await this.request<SessionSnapshotEvent>('session/subscribe', {
          sessionId,
        });
        for (const item of set) item.onEvent(snapshot);
      }
      if (this.listSubscriptions.size > 0) {
        const sessions = await this.request<SessionSummary[]>('session/list');
        for (const item of this.listSubscriptions) item.onList(sessions);
      }
    } catch (error) {
      const reconnectError = toError(error);
      for (const set of this.subscriptions.values())
        for (const item of set) item.onError?.(reconnectError);
      for (const item of this.listSubscriptions) item.onError?.(reconnectError);
    }
  }

  private wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }

  private setStatus(status: HubConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }

  private handleMessage(raw: unknown): void {
    let message: ReturnType<typeof parseRpcServerMessage>;
    try {
      message = parseRpcServerMessage(JSON.parse(String(raw)));
    } catch (error) {
      const protocolError = error instanceof Error ? error : new Error(String(error));
      for (const set of this.subscriptions.values())
        for (const item of set) item.onError?.(protocolError);
      for (const item of this.listSubscriptions) item.onError?.(protocolError);
      this.socket?.close(1002, '服务端 JSON-RPC 消息不合法');
      return;
    }
    if ('id' in message && ('result' in message || 'error' in message)) {
      if (typeof message.id !== 'number') return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      window.clearTimeout(request.timeout);
      if ('error' in message) {
        request.reject(toRpcError(message.error));
      } else {
        try {
          assertRpcMethodResult(request.method, message.result);
          request.resolve(message.result);
        } catch (error) {
          request.reject(error instanceof Error ? error : new Error(String(error)));
          this.socket?.close(1002, '服务端 JSON-RPC 结果不合法');
        }
      }
      return;
    }
    if (message.method === 'session/event') {
      for (const item of this.subscriptions.get(message.params!.sessionId) ?? [])
        item.onEvent(message.params!.event);
    }
    if (message.method === 'session/listEvent') {
      for (const item of this.listSubscriptions) item.onList(message.params!.sessions);
    }
  }
}

/** JSON-RPC error response converted for client callers. */
export class RpcRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'RpcRequestError';
  }
}
function toRpcError(error: RpcError['error']): Error {
  return new RpcRequestError(error.code, error.message, error.data);
}

/** @param error - 未知异常 @returns Error 实例 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
