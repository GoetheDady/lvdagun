import type {
  AbortSessionResult,
  AgentSessionState,
  AgentStreamEvent,
  CreateSessionResult,
  EditResendResult,
  ForkSessionResult,
  ProductSessionHistory,
  SessionSummary,
  TakePendingMessagesResult,
  ThinkingLevel,
} from './chat.ts';
import type {
  ModelConfig,
  ModelInfo,
  ModelReference,
  ProviderInfo,
  TestConnectionResult,
} from './model.ts';

/** 驴打滚 JSON-RPC 应用协议版本。 */
export const RPC_PROTOCOL_VERSION = 1;
/** WebSocket 握手使用的驴打滚子协议名称。 */
export const RPC_WEBSOCKET_SUBPROTOCOL = 'lvdagun-jsonrpc';
/** WebSocket JSON-RPC 入口。 */
export const RPC_PATH = '/rpc';

export interface RpcRequest<Method extends string = string, Params = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: Method;
  params?: Params;
}

export interface RpcNotification<Method extends string = string, Params = unknown> {
  jsonrpc: '2.0';
  method: Method;
  params?: Params;
}

export interface RpcSuccess<TResult = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result: TResult;
}

export interface RpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export interface InitializeParams {
  protocolVersion: number;
  clientInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

export interface InitializeResult {
  protocolVersion: number;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

export interface SessionSubscribeParams {
  sessionId: string;
}
export interface SessionUnsubscribeParams {
  scope: 'session' | 'list';
  sessionId?: string;
}
export interface SessionEventParams {
  sessionId: string;
  event: AgentStreamEvent;
}
export interface SessionListEventParams {
  sessions: SessionSummary[];
}

export interface RpcMethodParams {
  initialize: InitializeParams;
  'config/get': undefined;
  'config/update': ModelConfig;
  'catalog/testConnection': { provider: string; apiKey: string };
  'catalog/listProviders': undefined;
  'catalog/listModels': { provider: string };
  'session/list': undefined;
  'session/subscribe': SessionSubscribeParams;
  'session/unsubscribe': SessionUnsubscribeParams;
  'session/create': undefined;
  'session/archive': { sessionId: string };
  'session/delete': { sessionId: string };
  'session/messages': { sessionId: string };
  'session/fork': { sessionId: string; runId: string };
  'session/editResend': { sessionId: string; itemId: string; text: string };
  'session/state': { sessionId: string };
  'session/rename': { sessionId: string; title: string };
  'session/prompt': { sessionId: string; text: string };
  'session/abort': { sessionId: string };
  'session/pending/steer': { sessionId: string; messageId: string };
  'session/pending/remove': { sessionId: string; messageId: string };
  'session/pending/take': { sessionId: string };
  'session/pending/discard': { sessionId: string };
  'session/thinkingLevel': { sessionId: string; level: ThinkingLevel };
  'session/model': { sessionId: string; model: ModelReference };
}

export interface RpcMethodResult {
  initialize: InitializeResult;
  'config/get': ModelConfig | null;
  'config/update': null;
  'catalog/testConnection': TestConnectionResult;
  'catalog/listProviders': ProviderInfo[];
  'catalog/listModels': ModelInfo[];
  'session/list': SessionSummary[];
  'session/subscribe': import('./chat.ts').SessionSnapshotEvent;
  'session/unsubscribe': null;
  'session/create': CreateSessionResult;
  'session/archive': null;
  'session/delete': null;
  'session/messages': ProductSessionHistory;
  'session/fork': ForkSessionResult;
  'session/editResend': EditResendResult;
  'session/state': AgentSessionState;
  'session/rename': null;
  'session/prompt': { accepted: true };
  'session/abort': AbortSessionResult;
  'session/pending/steer': null;
  'session/pending/remove': null;
  'session/pending/take': TakePendingMessagesResult;
  'session/pending/discard': null;
  'session/thinkingLevel': AgentSessionState;
  'session/model': AgentSessionState;
}

export type RpcMethod = keyof RpcMethodParams;

export type RpcServerNotification =
  | RpcNotification<'session/event', SessionEventParams>
  | RpcNotification<'session/listEvent', SessionListEventParams>;

/** JSON-RPC 消息不符合驴打滚 wire contract。 */
export class RpcValidationError extends Error {
  /** @param message - 具体的契约错误 */
  constructor(message: string) {
    super(message);
    this.name = 'RpcValidationError';
  }
}

const RPC_METHODS = new Set<RpcMethod>([
  'initialize',
  'config/get',
  'config/update',
  'catalog/testConnection',
  'catalog/listProviders',
  'catalog/listModels',
  'session/list',
  'session/subscribe',
  'session/unsubscribe',
  'session/create',
  'session/archive',
  'session/delete',
  'session/messages',
  'session/fork',
  'session/editResend',
  'session/state',
  'session/rename',
  'session/prompt',
  'session/abort',
  'session/pending/steer',
  'session/pending/remove',
  'session/pending/take',
  'session/pending/discard',
  'session/thinkingLevel',
  'session/model',
]);

/**
 * 判断方法名是否属于当前协议版本。
 *
 * @param method - 收到的方法名
 * @returns 是否为已知方法
 */
export function isRpcMethod(method: string): method is RpcMethod {
  return RPC_METHODS.has(method as RpcMethod);
}

/**
 * 校验 JSON-RPC request 信封。
 *
 * @param value - JSON 解析结果
 * @returns 合法 request
 * @throws `RpcValidationError` 当信封不合法
 */
export function parseRpcRequest(value: unknown): RpcRequest {
  if (
    !isRecord(value) ||
    value.jsonrpc !== '2.0' ||
    !isRpcId(value.id) ||
    typeof value.method !== 'string' ||
    value.method === ''
  ) {
    throw new RpcValidationError('Invalid Request');
  }
  if (
    'params' in value &&
    value.params !== undefined &&
    !isRecord(value.params) &&
    !Array.isArray(value.params)
  ) {
    throw new RpcValidationError('params 必须是对象或数组');
  }
  return value as unknown as RpcRequest;
}

/**
 * 校验当前协议方法的参数。
 *
 * @param method - 已知方法名
 * @param value - request params
 * @returns 无返回值
 * @throws `RpcValidationError` 当参数不符合方法契约
 */
export function assertRpcMethodParams(method: RpcMethod, value: unknown): void {
  if (
    method === 'config/get' ||
    method === 'catalog/listProviders' ||
    method === 'session/list' ||
    method === 'session/create'
  ) {
    if (value !== undefined && !isRecord(value)) {
      throw new RpcValidationError('该方法不接受位置参数');
    }
    return;
  }

  const params = requireRecord(value);
  switch (method) {
    case 'initialize': {
      if (!Number.isInteger(params.protocolVersion)) {
        throw new RpcValidationError('protocolVersion 必须是整数');
      }
      const clientInfo = requireRecord(params.clientInfo);
      requireString(clientInfo, 'name');
      requireString(clientInfo, 'version');
      requireRecord(params.capabilities);
      return;
    }
    case 'config/update':
      requireString(params, 'provider');
      requireString(params, 'modelId');
      requireString(params, 'apiKey', true);
      return;
    case 'catalog/testConnection':
      requireString(params, 'provider');
      requireString(params, 'apiKey', true);
      return;
    case 'catalog/listModels':
      requireString(params, 'provider');
      return;
    case 'session/unsubscribe':
      if (params.scope !== 'session' && params.scope !== 'list') {
        throw new RpcValidationError('scope 必须是 session 或 list');
      }
      if (params.scope === 'session') requireString(params, 'sessionId');
      return;
    case 'session/fork':
      requireString(params, 'sessionId');
      requireString(params, 'runId');
      return;
    case 'session/editResend':
      requireString(params, 'sessionId');
      requireString(params, 'itemId');
      requireString(params, 'text');
      return;
    case 'session/rename':
      requireString(params, 'sessionId');
      requireString(params, 'title');
      return;
    case 'session/prompt':
      requireString(params, 'sessionId');
      requireString(params, 'text');
      return;
    case 'session/pending/steer':
    case 'session/pending/remove':
      requireString(params, 'sessionId');
      requireString(params, 'messageId');
      return;
    case 'session/thinkingLevel':
      requireString(params, 'sessionId');
      requireString(params, 'level');
      return;
    case 'session/model': {
      requireString(params, 'sessionId');
      const model = requireRecord(params.model);
      requireString(model, 'provider');
      requireString(model, 'id');
      return;
    }
    case 'session/subscribe':
    case 'session/archive':
    case 'session/delete':
    case 'session/messages':
    case 'session/state':
    case 'session/abort':
    case 'session/pending/take':
    case 'session/pending/discard':
      requireString(params, 'sessionId');
      return;
    default:
      return;
  }
}

/**
 * 校验服务端方法结果。
 *
 * @param method - 原始请求方法
 * @param value - response result
 * @returns 无返回值
 * @throws `RpcValidationError` 当结果不符合方法契约
 */
export function assertRpcMethodResult(method: RpcMethod, value: unknown): void {
  switch (method) {
    case 'initialize': {
      const result = requireRecord(value);
      if (!Number.isInteger(result.protocolVersion)) {
        throw new RpcValidationError('protocolVersion 必须是整数');
      }
      const serverInfo = requireRecord(result.serverInfo);
      requireString(serverInfo, 'name');
      requireString(serverInfo, 'version');
      requireRecord(result.capabilities);
      return;
    }
    case 'config/get':
      if (value !== null) assertModelConfig(value);
      return;
    case 'config/update':
    case 'session/unsubscribe':
    case 'session/archive':
    case 'session/delete':
    case 'session/rename':
    case 'session/pending/steer':
    case 'session/pending/remove':
    case 'session/pending/discard':
      if (value !== null) throw new RpcValidationError('方法结果必须是 null');
      return;
    case 'catalog/testConnection': {
      const result = requireRecord(value);
      if (result.ok === true) return;
      if (result.ok === false && typeof result.message === 'string') return;
      throw new RpcValidationError('连接测试结果不合法');
    }
    case 'catalog/listProviders':
    case 'catalog/listModels':
      if (!isArrayOf(value, isNamedItem)) {
        throw new RpcValidationError('目录结果不合法');
      }
      return;
    case 'session/list':
      if (!isArrayOf(value, isSessionSummary)) {
        throw new RpcValidationError('会话列表结果不合法');
      }
      return;
    case 'session/subscribe':
      assertSessionSnapshot(value);
      return;
    case 'session/create':
    case 'session/fork':
      requireString(requireRecord(value), 'sessionId');
      return;
    case 'session/messages':
      assertProductHistory(value);
      return;
    case 'session/editResend':
      assertProductHistory(requireRecord(value).history);
      return;
    case 'session/state':
    case 'session/thinkingLevel':
    case 'session/model':
      assertSessionState(value);
      return;
    case 'session/prompt':
      if (requireRecord(value).accepted !== true) {
        throw new RpcValidationError('提示准入结果不合法');
      }
      return;
    case 'session/abort':
      assertStringArray(requireRecord(value).restoredTexts, 'restoredTexts');
      return;
    case 'session/pending/take':
      assertStringArray(requireRecord(value).texts, 'texts');
      return;
  }
}

/**
 * 校验服务端发给客户端的 JSON-RPC 信封和通知参数。
 *
 * @param value - JSON 解析结果
 * @returns 合法响应或服务端通知
 * @throws `RpcValidationError` 当消息不符合协议
 */
export function parseRpcServerMessage(
  value: unknown
): RpcSuccess | RpcError | RpcServerNotification {
  if (!isRecord(value) || value.jsonrpc !== '2.0') {
    throw new RpcValidationError('服务端消息缺少 jsonrpc 2.0 标记');
  }
  if ('id' in value) {
    const hasResult = 'result' in value;
    const hasError = 'error' in value;
    if (hasResult === hasError || (!isRpcId(value.id) && !(hasError && value.id === null))) {
      throw new RpcValidationError('服务端响应信封不合法');
    }
    if (hasError) {
      const error = requireRecord(value.error);
      if (!Number.isInteger(error.code) || typeof error.message !== 'string') {
        throw new RpcValidationError('JSON-RPC error 不合法');
      }
    }
    return value as unknown as RpcSuccess | RpcError;
  }
  if (value.method === 'session/event') {
    const params = requireRecord(value.params);
    requireString(params, 'sessionId');
    const event = requireRecord(params.event);
    requireString(event, 'type');
    return value as unknown as RpcServerNotification;
  }
  if (value.method === 'session/listEvent') {
    const params = requireRecord(value.params);
    if (!Array.isArray(params.sessions) || !params.sessions.every(isSessionSummary)) {
      throw new RpcValidationError('session/listEvent 的 sessions 不合法');
    }
    return value as unknown as RpcServerNotification;
  }
  throw new RpcValidationError('未知的服务端通知');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new RpcValidationError('params 必须是对象');
  return value;
}

function requireString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new RpcValidationError(`${key} 必须是${allowEmpty ? '' : '非空'}字符串`);
  }
  return value;
}

function isRpcId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isSessionSummary(value: unknown): value is SessionSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    Number.isInteger(value.messageCount) &&
    typeof value.isRunning === 'boolean'
  );
}

function assertModelConfig(value: unknown): void {
  const config = requireRecord(value);
  requireString(config, 'provider');
  requireString(config, 'modelId');
  requireString(config, 'apiKey', true);
}

function assertSessionSnapshot(value: unknown): void {
  const snapshot = requireRecord(value);
  if (snapshot.type !== 'session_snapshot') {
    throw new RpcValidationError('会话快照类型不合法');
  }
  assertProductHistory(snapshot.history);
  assertSessionState(snapshot.state);
}

function assertProductHistory(value: unknown): asserts value is ProductSessionHistory {
  const history = requireRecord(value);
  if (
    history.schemaVersion !== 1 ||
    typeof history.sessionId !== 'string' ||
    typeof history.branchId !== 'string' ||
    !Number.isInteger(history.revision) ||
    !Array.isArray(history.runs) ||
    (history.draft !== null && !isRecord(history.draft)) ||
    !isRecord(history.blobs)
  ) {
    throw new RpcValidationError('产品会话历史结果不合法');
  }
}

function assertSessionState(value: unknown): void {
  const state = requireRecord(value);
  if (
    (state.sessionName !== null && typeof state.sessionName !== 'string') ||
    typeof state.executionAvailable !== 'boolean' ||
    typeof state.isRunning !== 'boolean' ||
    (state.activeCompaction !== null && !isRecord(state.activeCompaction)) ||
    !Array.isArray(state.pendingMessages) ||
    typeof state.thinkingLevel !== 'string' ||
    !isArrayOf(state.availableThinkingLevels, (level) => typeof level === 'string') ||
    !isAvailableModel(state.model) ||
    !isArrayOf(state.availableModels, isAvailableModel) ||
    (state.modelWarning !== null && typeof state.modelWarning !== 'string')
  ) {
    throw new RpcValidationError('会话状态结果不合法');
  }
}

function isAvailableModel(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    typeof value.providerName === 'string' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string'
  );
}

function isNamedItem(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isArrayOf(value: unknown, predicate: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.every(predicate);
}

function assertStringArray(value: unknown, key: string): void {
  if (!isArrayOf(value, (item) => typeof item === 'string')) {
    throw new RpcValidationError(`${key} 必须是字符串数组`);
  }
}
