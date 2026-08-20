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
  private opening: Promise<void> | null = null;
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

  /** 发起一个 JSON-RPC request。 */
  async request<T>(method: RpcMethod, params?: unknown): Promise<T> {
    await this.ensureOpen();
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
        this.socket!.send(JSON.stringify(message));
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
    try {
      if (!existing) {
        const snapshot = await this.request<SessionSnapshotEvent>('session/subscribe', {
          sessionId,
        });
        subscription.onEvent(snapshot);
      }
    } catch (error) {
      set.delete(subscription);
      if (set.size === 0) this.subscriptions.delete(sessionId);
      throw error;
    }
    return () => {
      set.delete(subscription);
      if (set.size === 0) {
        this.subscriptions.delete(sessionId);
        void this.request('session/unsubscribe', { scope: 'session', sessionId }).catch(
          () => undefined
        );
      }
    };
  }

  /** 订阅会话列表的权威快照和变化通知。 */
  async subscribeSessionList(subscription: ListSubscription): Promise<() => void> {
    const alreadySubscribed = this.listSubscriptions.size > 0;
    this.listSubscriptions.add(subscription);
    try {
      if (!alreadySubscribed)
        subscription.onList(await this.request<SessionSummary[]>('session/list'));
    } catch (error) {
      this.listSubscriptions.delete(subscription);
      throw error;
    }
    return () => {
      this.listSubscriptions.delete(subscription);
      if (this.listSubscriptions.size === 0)
        void this.request('session/unsubscribe', { scope: 'list' }).catch(() => undefined);
    };
  }

  private async ensureOpen(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(
        `${protocol}//${window.location.host}${RPC_PATH}`,
        RPC_WEBSOCKET_SUBPROTOCOL
      );
      this.socket = socket;
      socket.onopen = () => {
        const id = nextId++;
        const timeout = window.setTimeout(() => {
          if (!this.pending.delete(id)) return;
          socket.close();
          reject(new Error('初始化超时'));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, {
          method: 'initialize',
          resolve: () => resolve(),
          reject: (error) => {
            socket.close();
            reject(error);
          },
          timeout,
        });
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
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onerror = () => {
        socket.close();
        reject(new Error('WebSocket 连接失败'));
      };
      socket.onclose = () => {
        this.socket = null;
        this.opening = null;
        for (const request of this.pending.values()) {
          window.clearTimeout(request.timeout);
          request.reject(new Error('连接已断开'));
        }
        this.pending.clear();
        for (const set of this.subscriptions.values())
          for (const item of set) item.onDisconnect?.();
        for (const item of this.listSubscriptions) item.onDisconnect?.();
        window.setTimeout(() => void this.reconnectSubscriptions(), 1_000);
      };
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async reconnectSubscriptions(): Promise<void> {
    if (this.subscriptions.size === 0 && this.listSubscriptions.size === 0) return;
    try {
      await this.ensureOpen();
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
      const reconnectError = error instanceof Error ? error : new Error(String(error));
      for (const set of this.subscriptions.values())
        for (const item of set) item.onError?.(reconnectError);
      for (const item of this.listSubscriptions) item.onError?.(reconnectError);
    }
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
