import type { Server } from 'node:http';

import {
  assertRpcMethodParams,
  isRpcMethod,
  parseRpcRequest,
  RPC_PATH,
  RPC_PROTOCOL_VERSION,
  RPC_WEBSOCKET_SUBPROTOCOL,
  RpcValidationError,
  type ModelSettings,
  type RpcError,
  type RpcMethodParams,
  type RpcRequest,
  type RpcServerNotification,
  type RpcSuccess,
  type ThinkingLevel,
} from '@lvdagun/protocol';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  AgentNotRunningError,
  PendingMessageNotFoundError,
} from '../extensions/pending-messages/pending-message-extension';
import {
  AgentBusyError,
  ModelUnavailableError,
  SessionArchivedError,
  SessionEntryConflictError,
  SessionNotFoundError,
} from '../hub/agent-hub-adapter';
import { NotConfiguredError, type AgentHub } from '../hub/agent-hub';

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const DOMAIN_ERROR = -32000;
const MAX_BUFFERED_BYTES = 1024 * 1024;

interface Connection {
  socket: WebSocket;
  initialized: boolean;
  sessions: Map<string, () => void>;
  listSubscribed: boolean;
  afterResponse: RpcServerNotification[];
  requestsInFlight: number;
  alive: boolean;
}

/** 将 Agent Hub 挂载为单一 JSON-RPC WebSocket 入口。 */
export function attachRpcServer(server: Server, agentHub: AgentHub): () => Promise<void> {
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: 4 * 1024 * 1024,
    handleProtocols: (protocols) =>
      protocols.has(RPC_WEBSOCKET_SUBPROTOCOL) ? RPC_WEBSOCKET_SUBPROTOCOL : '',
  });
  const connections = new Set<Connection>();
  server.on('upgrade', (request, socket, head) => {
    if (
      request.url?.split('?')[0] !== RPC_PATH ||
      !requestedSubprotocols(request.headers['sec-websocket-protocol']).includes(
        RPC_WEBSOCKET_SUBPROTOCOL
      )
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => wss.emit('connection', webSocket));
  });
  wss.on('connection', (socket) => {
    const connection: Connection = {
      socket,
      initialized: false,
      sessions: new Map(),
      listSubscribed: false,
      afterResponse: [],
      requestsInFlight: 0,
      alive: true,
    };
    connections.add(connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, '只支持 UTF-8 文本帧');
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        sendError(socket, null, -32700, 'Parse error');
        socket.close(1002, 'JSON 解析失败');
        return;
      }
      let request: RpcRequest;
      try {
        request = parseRpcRequest(value);
      } catch {
        sendError(socket, null, INVALID_REQUEST, 'Invalid Request');
        socket.close(1002, 'JSON-RPC 请求不合法');
        return;
      }
      void handleMessage(connection, request, agentHub, connections);
    });
    socket.on('close', () => {
      for (const unsubscribe of connection.sessions.values()) unsubscribe();
      connections.delete(connection);
    });
    socket.on('error', () => socket.close());
  });
  const heartbeat = setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }, 30_000);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    for (const connection of connections) connection.socket.close(1001, '服务关闭');
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };
}

async function handleMessage(
  connection: Connection,
  request: RpcRequest,
  agentHub: AgentHub,
  connections: Set<Connection>
): Promise<void> {
  if (!connection.initialized && request.method !== 'initialize') {
    sendError(connection.socket, request.id, INVALID_REQUEST, '必须先 initialize');
    connection.socket.close(1008, '未初始化');
    return;
  }
  connection.requestsInFlight += 1;
  try {
    const result = await dispatch(connection, request, agentHub, connections);
    sendResult(connection.socket, request.id, result);
  } catch (error) {
    sendDomainError(connection.socket, request.id, error);
    if (request.method === 'initialize') {
      connection.socket.close(1002, '初始化失败');
    }
  } finally {
    connection.requestsInFlight -= 1;
    if (connection.requestsInFlight === 0)
      for (const notification of connection.afterResponse.splice(0))
        send(connection.socket, notification);
  }
}

async function dispatch(
  connection: Connection,
  request: RpcRequest,
  agentHub: AgentHub,
  connections: Set<Connection>
): Promise<unknown> {
  if (!isRpcMethod(request.method)) {
    throw new RpcDispatchError(METHOD_NOT_FOUND, 'Method not found');
  }
  try {
    assertRpcMethodParams(request.method, request.params);
  } catch (error) {
    if (error instanceof RpcValidationError) {
      throw new RpcDispatchError(INVALID_PARAMS, error.message);
    }
    throw error;
  }
  const p = isObject(request.params) ? request.params : undefined;
  switch (request.method) {
    case 'initialize':
      if (connection.initialized)
        throw new RpcDispatchError(INVALID_REQUEST, 'initialize 只能调用一次');
      if (!isObject(p) || p.protocolVersion !== RPC_PROTOCOL_VERSION)
        throw new RpcDispatchError(INVALID_PARAMS, '协议版本不兼容');
      connection.initialized = true;
      return {
        protocolVersion: RPC_PROTOCOL_VERSION,
        serverInfo: { name: 'lvdagun', version: '0.1.0' },
        capabilities: { sessionSubscriptions: true },
      };
    case 'config/get':
      return agentHub.getConfig();
    case 'config/update':
      await agentHub.updateConfig(p as unknown as ModelSettings);
      return null;
    case 'catalog/testConnection':
      return agentHub.testConnection(
        stringParam(p, 'provider'),
        stringParam(p, 'apiKey'),
        stringParam(p, 'modelId')
      );
    case 'catalog/listProviders':
      return agentHub.listProviders();
    case 'catalog/listModels':
      return agentHub.listModels(stringParam(p, 'provider'));
    case 'session/list':
      connection.listSubscribed = true;
      return agentHub.listSessions();
    case 'session/subscribe':
      return subscribeSession(connection, stringParam(p, 'sessionId'), agentHub, connections);
    case 'session/unsubscribe': {
      if (p?.scope === 'list') connection.listSubscribed = false;
      else {
        const id = stringParam(p, 'sessionId');
        connection.sessions.get(id)?.();
        connection.sessions.delete(id);
      }
      return null;
    }
    case 'session/create': {
      const result = { sessionId: await agentHub.createSession() };
      await broadcastList(connections, agentHub);
      return result;
    }
    case 'session/archive':
      await agentHub.archiveSession(stringParam(p, 'sessionId'));
      await broadcastList(connections, agentHub);
      return null;
    case 'session/delete':
      await agentHub.deleteSession(stringParam(p, 'sessionId'));
      await broadcastList(connections, agentHub);
      return null;
    case 'session/messages':
      return agentHub.getMessages(stringParam(p, 'sessionId'));
    case 'session/fork': {
      const result = {
        sessionId: await agentHub.forkSession(
          stringParam(p, 'sessionId'),
          stringParam(p, 'runId')
        ),
      };
      await broadcastList(connections, agentHub);
      return result;
    }
    case 'session/editResend':
      return {
        history: await agentHub.editAndResend(
          stringParam(p, 'sessionId'),
          stringParam(p, 'itemId'),
          stringParam(p, 'text')
        ),
      };
    case 'session/state':
      return agentHub.getState(stringParam(p, 'sessionId'));
    case 'session/rename':
      await agentHub.setSessionName(stringParam(p, 'sessionId'), stringParam(p, 'title').trim());
      await broadcastList(connections, agentHub);
      return null;
    case 'session/prompt':
      await agentHub.prompt(stringParam(p, 'sessionId'), stringParam(p, 'text'));
      return { accepted: true };
    case 'session/abort':
      return { restoredTexts: await agentHub.abort(stringParam(p, 'sessionId')) };
    case 'session/pending/steer':
      await agentHub.steerPendingMessage(stringParam(p, 'sessionId'), stringParam(p, 'messageId'));
      return null;
    case 'session/pending/remove':
      await agentHub.removePendingMessage(stringParam(p, 'sessionId'), stringParam(p, 'messageId'));
      return null;
    case 'session/pending/take':
      return { texts: await agentHub.takePendingMessages(stringParam(p, 'sessionId')) };
    case 'session/pending/discard':
      await agentHub.takePendingMessages(stringParam(p, 'sessionId'));
      return null;
    case 'session/thinkingLevel': {
      const sessionId = stringParam(p, 'sessionId');
      const level = stringParam(p, 'level') as ThinkingLevel;
      const state = await agentHub.getState(sessionId);
      if (!state.availableThinkingLevels.includes(level)) {
        throw new RpcDispatchError(INVALID_PARAMS, '当前模型不支持该思考等级');
      }
      return agentHub.setThinkingLevel(sessionId, level);
    }
    case 'session/model':
      return agentHub.setModel(stringParam(p, 'sessionId'), modelParam(p));
    default:
      throw new RpcDispatchError(METHOD_NOT_FOUND, 'Method not found');
  }
}

async function subscribeSession(
  connection: Connection,
  sessionId: string,
  agentHub: AgentHub,
  connections: Set<Connection>
): Promise<unknown> {
  connection.sessions.get(sessionId)?.();
  let ready = false;
  const pending: RpcServerNotification[] = [];
  const subscription = await agentHub.subscribe(sessionId, (event) => {
    const notification: RpcServerNotification = {
      jsonrpc: '2.0',
      method: 'session/event',
      params: { sessionId, event },
    };
    if (!ready) pending.push(notification);
    else queueOrSend(connection, notification);
    if (
      event.type === 'session_info_changed' ||
      event.type === 'session_history_changed' ||
      event.type === 'session_archived' ||
      event.type === 'session_deleted'
    )
      void broadcastList(connections, agentHub);
  });
  connection.sessions.set(sessionId, subscription.unsubscribe);
  ready = true;
  connection.afterResponse.push(...pending);
  return subscription.snapshot;
}

async function broadcastList(connections: Set<Connection>, agentHub: AgentHub): Promise<void> {
  const sessions = await agentHub.listSessions();
  for (const connection of connections)
    if (connection.listSubscribed)
      queueOrSend(connection, {
        jsonrpc: '2.0',
        method: 'session/listEvent',
        params: { sessions },
      });
}

function sendResult(socket: WebSocket, id: string | number, result: unknown): void {
  send(socket, { jsonrpc: '2.0', id, result });
}
function sendError(
  socket: WebSocket,
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): void {
  send(socket, {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}
function send(socket: WebSocket, value: RpcSuccess | RpcError | RpcServerNotification): void {
  if (socket.readyState !== socket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1013, '客户端消费过慢');
    return;
  }
  socket.send(JSON.stringify(value));
}
function queueOrSend(connection: Connection, value: RpcServerNotification): void {
  if (connection.requestsInFlight > 0) connection.afterResponse.push(value);
  else send(connection.socket, value);
}
function sendDomainError(socket: WebSocket, id: string | number, error: unknown): void {
  if (error instanceof RpcDispatchError) {
    sendError(socket, id, error.code, error.message);
    return;
  }
  if (error instanceof SessionNotFoundError) {
    sendError(socket, id, DOMAIN_ERROR, '会话不存在', { code: 'session_not_found' });
    return;
  }
  if (error instanceof SessionArchivedError) {
    sendError(socket, id, DOMAIN_ERROR, '会话已归档', { code: 'session_archived' });
    return;
  }
  if (error instanceof AgentBusyError) {
    sendError(socket, id, DOMAIN_ERROR, 'Agent 正在运行', { code: 'agent_busy' });
    return;
  }
  if (error instanceof NotConfiguredError) {
    sendError(socket, id, DOMAIN_ERROR, '尚未配置模型', { code: 'not_configured' });
    return;
  }
  if (error instanceof ModelUnavailableError) {
    sendError(socket, id, DOMAIN_ERROR, error.message, { code: 'model_unavailable' });
    return;
  }
  if (error instanceof SessionEntryConflictError) {
    sendError(socket, id, DOMAIN_ERROR, error.message, { code: 'session_entry_conflict' });
    return;
  }
  if (error instanceof PendingMessageNotFoundError) {
    sendError(socket, id, DOMAIN_ERROR, error.message, { code: 'pending_message_not_found' });
    return;
  }
  if (error instanceof AgentNotRunningError) {
    sendError(socket, id, DOMAIN_ERROR, error.message, { code: 'agent_not_running' });
    return;
  }
  console.error(error);
  sendError(socket, id, INTERNAL_ERROR, '内部错误');
}
class RpcDispatchError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function stringParam(params: Record<string, unknown> | undefined, key: string): string {
  return params![key] as string;
}
function requestedSubprotocols(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .split(',')
    .map((item) => item.trim());
}
function modelParam(
  params: Record<string, unknown> | undefined
): RpcMethodParams['session/model']['model'] {
  return params!.model as RpcMethodParams['session/model']['model'];
}
