import { z } from 'zod';

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
  AvailableModel,
  ModelInfo,
  ModelReference,
  ModelSettings,
  ProviderInfo,
  TestConnectionResult,
} from './model.ts';

/** 驴打滚 JSON-RPC 应用协议版本。config/get、config/update 改为模型服务配置时升到 2。 */
export const RPC_PROTOCOL_VERSION = 2;
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
  /** 客户端请求的应用协议版本，必须与服务端一致 */
  protocolVersion: number;
}

export interface InitializeResult {
  /** 服务端接受的应用协议版本 */
  protocolVersion: number;
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
  'config/update': ModelSettings;
  'catalog/testConnection': { provider: string; apiKey: string; modelId: string };
  'catalog/listProviders': undefined;
  'catalog/listModels': { provider: string };
  'catalog/listAvailableModels': undefined;
  'session/list': undefined;
  'session/subscribe': SessionSubscribeParams;
  'session/unsubscribe': SessionUnsubscribeParams;
  'session/create': { model?: ModelReference };
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
  'session/thinkingLevel': { sessionId: string; level: ThinkingLevel };
  'session/model': { sessionId: string; model: ModelReference };
}

export interface RpcMethodResult {
  initialize: InitializeResult;
  'config/get': ModelSettings;
  'config/update': null;
  'catalog/testConnection': TestConnectionResult;
  'catalog/listProviders': ProviderInfo[];
  'catalog/listModels': ModelInfo[];
  'catalog/listAvailableModels': AvailableModel[];
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

/**
 * trim 后非空的字符串；不做 trim 转换，保留原始值。
 */
const NonEmptyString = z.string().refine((value) => value.trim() !== '', {
  message: '必须是非空字符串',
});

const RpcIdSchema = z.union([z.string(), z.number().refine(Number.isFinite)]);
const RecordSchema = z.record(z.string(), z.unknown());
const NullResult = z.null();

const ModelReferenceSchema = z.object({ provider: NonEmptyString, id: NonEmptyString });

const ProviderCredentialSchema = z.object({
  provider: NonEmptyString,
  apiKey: z.string(),
});

const ModelSettingsSchema = z.object({
  providers: z.array(ProviderCredentialSchema),
  defaultModel: ModelReferenceSchema.nullable(),
});

const NamedItemSchema = z.object({ id: z.string(), name: z.string() });

const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number().refine(Number.isFinite),
  updatedAt: z.number().refine(Number.isFinite),
  messageCount: z.number().int(),
  isRunning: z.boolean(),
});

const AvailableModelSchema = z.object({
  provider: z.string(),
  providerName: z.string(),
  id: z.string(),
  name: z.string(),
});

const SessionStateSchema = z.object({
  sessionName: z.string().nullable(),
  executionAvailable: z.boolean(),
  isRunning: z.boolean(),
  activeCompaction: RecordSchema.nullable(),
  pendingMessages: z.array(z.unknown()),
  thinkingLevel: z.string(),
  availableThinkingLevels: z.array(z.string()),
  model: AvailableModelSchema,
  availableModels: z.array(AvailableModelSchema),
  modelWarning: z.string().nullable(),
});

const ExecutionPlanSchema = z.object({
  steps: z.array(
    z.object({
      id: z.number().int(),
      subject: z.string(),
      description: z.string().optional(),
      activeForm: z.string().optional(),
      status: z.enum(['pending', 'in_progress', 'completed']),
    })
  ),
});

const ProductHistorySchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  branchId: z.string(),
  revision: z.number().int(),
  runs: z.array(z.unknown()),
  draft: RecordSchema.nullable(),
  blobs: RecordSchema,
  executionPlan: ExecutionPlanSchema.nullable(),
});

const TestConnectionSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

// 握手双方只消费协议版本；schema 非 strict，历史客户端多发的字段会被静默忽略。
const InitializeParamsSchema = z.object({ protocolVersion: z.number().int() });

const InitializeResultSchema = z.object({ protocolVersion: z.number().int() });

const SessionParamsSchema = z.object({ sessionId: NonEmptyString });
/** 无参数方法仍接受空的 params 占位对象，与旧协议行为一致。 */
const NoParamsSchema = z.union([z.undefined(), RecordSchema]);

/** 每个方法的 params 校验 schema；键即协议方法全集，isRpcMethod 由此派生。 */
const RPC_METHOD_PARAMS: Record<RpcMethod, z.ZodType> = {
  initialize: InitializeParamsSchema,
  'config/get': NoParamsSchema,
  'config/update': ModelSettingsSchema,
  'catalog/testConnection': z.object({ provider: NonEmptyString, apiKey: z.string(), modelId: NonEmptyString }),
  'catalog/listProviders': NoParamsSchema,
  'catalog/listModels': z.object({ provider: NonEmptyString }),
  'catalog/listAvailableModels': NoParamsSchema,
  'session/list': NoParamsSchema,
  'session/subscribe': SessionParamsSchema,
  'session/unsubscribe': z.union([
    z.object({ scope: z.literal('session'), sessionId: NonEmptyString }),
    z.object({ scope: z.literal('list') }),
  ]),
  'session/create': z.object({ model: ModelReferenceSchema.optional() }).optional(),
  'session/archive': SessionParamsSchema,
  'session/delete': SessionParamsSchema,
  'session/messages': SessionParamsSchema,
  'session/fork': SessionParamsSchema.extend({ runId: NonEmptyString }),
  'session/editResend': SessionParamsSchema.extend({ itemId: NonEmptyString, text: NonEmptyString }),
  'session/state': SessionParamsSchema,
  'session/rename': SessionParamsSchema.extend({ title: NonEmptyString }),
  'session/prompt': SessionParamsSchema.extend({ text: NonEmptyString }),
  'session/abort': SessionParamsSchema,
  'session/pending/steer': SessionParamsSchema.extend({ messageId: NonEmptyString }),
  'session/pending/remove': SessionParamsSchema.extend({ messageId: NonEmptyString }),
  'session/pending/take': SessionParamsSchema,
  'session/thinkingLevel': SessionParamsSchema.extend({ level: NonEmptyString }),
  'session/model': SessionParamsSchema.extend({ model: ModelReferenceSchema }),
};

/** 每个方法的结果校验 schema，深度与旧 wire contract 保持一致。 */
const RPC_METHOD_RESULTS: Record<RpcMethod, z.ZodType> = {
  initialize: InitializeResultSchema,
  'config/get': ModelSettingsSchema,
  'config/update': NullResult,
  'catalog/testConnection': TestConnectionSchema,
  'catalog/listProviders': z.array(NamedItemSchema),
  'catalog/listModels': z.array(NamedItemSchema),
  'catalog/listAvailableModels': z.array(AvailableModelSchema),
  'session/list': z.array(SessionSummarySchema),
  'session/subscribe': z.object({
    type: z.literal('session_snapshot'),
    history: ProductHistorySchema,
    state: SessionStateSchema,
  }),
  'session/unsubscribe': NullResult,
  'session/create': z.object({ sessionId: NonEmptyString }),
  'session/archive': NullResult,
  'session/delete': NullResult,
  'session/messages': ProductHistorySchema,
  'session/fork': z.object({ sessionId: NonEmptyString }),
  'session/editResend': z.object({ history: ProductHistorySchema }),
  'session/state': SessionStateSchema,
  'session/rename': NullResult,
  'session/prompt': z.object({ accepted: z.literal(true) }),
  'session/abort': z.object({ restoredTexts: z.array(z.string()) }),
  'session/pending/steer': NullResult,
  'session/pending/remove': NullResult,
  'session/pending/take': z.object({ texts: z.array(z.string()) }),
  'session/thinkingLevel': SessionStateSchema,
  'session/model': SessionStateSchema,
};

/**
 * 判断方法名是否属于当前协议版本。
 *
 * @param method - 收到的方法名
 * @returns 是否为已知方法
 */
export function isRpcMethod(method: string): method is RpcMethod {
  return Object.hasOwn(RPC_METHOD_PARAMS, method);
}

/**
 * 校验 JSON-RPC request 信封。
 *
 * @param value - JSON 解析结果
 * @returns 合法 request
 * @throws `RpcValidationError` 当信封不合法
 */
export function parseRpcRequest(value: unknown): RpcRequest {
  const result = z
    .object({
      jsonrpc: z.literal('2.0'),
      id: RpcIdSchema,
      method: NonEmptyString,
      params: z.union([RecordSchema, z.array(z.unknown())]).optional(),
    })
    .safeParse(value);
  if (!result.success) throw new RpcValidationError('Invalid Request');
  return value as RpcRequest;
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
  validate(RPC_METHOD_PARAMS[method], value);
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
  validate(RPC_METHOD_RESULTS[method], value);
}

const ServerErrorSchema = z.object({ code: z.number().int(), message: z.string() });
const SessionEventParamsSchema = z.object({
  sessionId: NonEmptyString,
  event: z.object({ type: z.string() }),
});
const SessionListEventParamsSchema = z.object({ sessions: z.array(SessionSummarySchema) });

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
  // result/error 的存在性互斥无法用 unknown 字段区分，信封互斥检查保留手写。
  if ('id' in value) {
    const hasResult = 'result' in value;
    const hasError = 'error' in value;
    if (hasResult === hasError || (!isRpcId(value.id) && !(hasError && value.id === null))) {
      throw new RpcValidationError('服务端响应信封不合法');
    }
    if (hasError) validate(ServerErrorSchema, value.error);
    return value as unknown as RpcSuccess | RpcError;
  }
  if (value.method === 'session/event') {
    validate(SessionEventParamsSchema, value.params);
    return value as unknown as RpcServerNotification;
  }
  if (value.method === 'session/listEvent') {
    validate(SessionListEventParamsSchema, value.params);
    return value as unknown as RpcServerNotification;
  }
  throw new RpcValidationError('未知的服务端通知');
}

/**
 * 用 schema 校验值，失败时抛出统一的协议校验错误。
 *
 * @param schema - 目标 schema
 * @param value - 待校验值
 * @throws `RpcValidationError` 附带首个 issue 的路径与原因
 */
function validate(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) throw new RpcValidationError('消息不合法');
    const path = issue.path.join('.');
    throw new RpcValidationError(path ? `${path}: ${issue.message}` : issue.message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}
