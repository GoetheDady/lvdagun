import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  FileTerminal,
  Loader2,
  Wrench,
} from 'lucide-react';
import { Streamdown } from 'streamdown';

import type { ChatMessage } from '@lvdagun/protocol';

import type {
  AssistantChatMessage,
  CompactionState,
  RetryRecord,
  ToolResultChatMessage,
  ToolRunState,
} from '@/hooks/use-chat-session';

type UserChatMessage = Extract<ChatMessage, { role: 'user' }>;

/** 对话记录组件所需的语义状态。 */
interface ChatTranscriptProps {
  messages: ChatMessage[];
  activeAssistant: AssistantChatMessage | null;
  toolRuns: Record<string, ToolRunState>;
  retries: RetryRecord[];
  compaction: CompactionState | null;
  loading: boolean;
}

/**
 * 将任意 JSON 兼容值格式化为便于检查的文本。
 *
 * @param value - 工具参数、结果或详情
 * @returns 缩进后的 JSON；无法序列化时返回字符串表示
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 格式化消息时间。
 *
 * @param timestamp - Unix 毫秒时间戳
 * @returns 当前区域设置下的日期时间
 */
function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

/**
 * 把 Pi 图片内容转换为浏览器可显示的数据地址。
 *
 * @param data - Pi 返回的 Base64 图片数据
 * @param mimeType - 图片 MIME 类型，例如 image/png
 * @returns 浏览器数据地址
 */
function toImageSource(data: string, mimeType: string): string {
  return data.startsWith('data:') ? data : `data:${mimeType};base64,${data}`;
}

/**
 * 渲染 Pi 文本与图片内容数组。
 *
 * @param props.content - 字符串或结构化内容块
 * @param props.markdown - 是否将文本按 Markdown 渲染
 * @param props.streaming - Markdown 是否仍在流式生成
 * @returns 内容块元素
 */
function MessageContent(props: {
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  markdown?: boolean;
  streaming?: boolean;
}): React.JSX.Element {
  const blocks =
    typeof props.content === 'string'
      ? ([{ type: 'text', text: props.content }] as const)
      : props.content;

  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.type === 'image' ? (
          <img
            key={`image-${index}`}
            src={toImageSource(block.data, block.mimeType)}
            alt="对话图片"
            className="max-h-96 max-w-full rounded-md border object-contain"
          />
        ) : props.markdown ? (
          <Streamdown
            key={`text-${index}`}
            className="chat-markdown text-sm leading-6"
            mode={props.streaming ? 'streaming' : 'static'}
            isAnimating={props.streaming}
            animated={props.streaming}
            caret={props.streaming ? 'block' : undefined}
          >
            {block.text}
          </Streamdown>
        ) : (
          <p key={`text-${index}`} className="whitespace-pre-wrap break-words text-sm leading-6">
            {block.text}
          </p>
        )
      )}
    </div>
  );
}

/**
 * 渲染用户消息。
 *
 * @param props.message - Pi 用户消息
 * @returns 右对齐的用户消息元素
 */
function UserMessage(props: { message: UserChatMessage }): React.JSX.Element {
  return (
    <article className="flex justify-end">
      <div className="max-w-[min(88%,42rem)] rounded-md bg-primary px-3.5 py-2.5 text-primary-foreground">
        <MessageContent content={props.message.content} />
        <time className="mt-1.5 block text-right text-[11px] opacity-70">
          {formatTime(props.message.timestamp)}
        </time>
      </div>
    </article>
  );
}

/**
 * 渲染助手的思考内容。
 *
 * @param props.text - Pi 返回的思考文本
 * @param props.streaming - 当前助手消息是否仍在生成
 * @param props.redacted - 思考是否被提供方安全策略隐藏
 * @returns 可展开的思考区域
 */
function ThinkingBlock(props: {
  text: string;
  streaming: boolean;
  redacted?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(props.streaming);

  return (
    <details
      className="group border-l-2 border-soy/60 pl-3 text-muted-foreground"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium">
        <Brain className="size-3.5" />
        {props.streaming ? '正在思考' : '思考过程'}
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="pb-2 pt-1 text-xs leading-5">
        {props.redacted ? '思考内容已由模型提供方隐藏' : props.text || '等待思考内容...'}
      </div>
    </details>
  );
}

/**
 * 渲染单个工具调用，并把实时执行状态和最终 ToolResult 合并。
 *
 * @param props.toolCall - 助手消息中的工具调用块
 * @param props.run - SSE 提供的实时执行状态
 * @param props.result - 历史或最终消息中的工具结果
 * @returns 可展开的工具执行元素
 */
function ToolRun(props: {
  toolCall: Extract<AssistantChatMessage['content'][number], { type: 'toolCall' }>;
  run?: ToolRunState;
  result?: ToolResultChatMessage;
}): React.JSX.Element {
  const status = props.run?.status ?? (props.result?.isError ? 'error' : 'success');
  const [open, setOpen] = useState(status === 'running' || status === 'error');

  const statusLabel =
    status === 'running' ? '运行中' : status === 'error' ? '执行失败' : '执行完成';
  const StatusIcon = status === 'running' ? Loader2 : status === 'error' ? AlertCircle : Check;
  const resultContent = props.result?.content;

  return (
    <details
      className={`group overflow-hidden rounded-md border ${status === 'error' ? 'border-destructive/50' : 'border-border'}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 bg-muted/60 px-3 py-2 text-xs">
        <Wrench className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{props.toolCall.name}</span>
        <span className={status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
          {statusLabel}
        </span>
        <StatusIcon className={`size-3.5 ${status === 'running' ? 'animate-spin' : ''}`} />
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 border-t px-3 py-2.5 text-xs">
        <div>
          <p className="mb-1 font-medium text-muted-foreground">参数</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono leading-5">
            {formatValue(props.run?.args ?? props.toolCall.arguments)}
          </pre>
        </div>
        {resultContent ? (
          <div>
            <p className="mb-1 font-medium text-muted-foreground">结果</p>
            <MessageContent content={resultContent} />
          </div>
        ) : props.run?.partialResult !== undefined || props.run?.result !== undefined ? (
          <div>
            <p className="mb-1 font-medium text-muted-foreground">
              {status === 'running' ? '当前输出' : '结果'}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono leading-5">
              {formatValue(props.run.partialResult ?? props.run.result)}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/**
 * 渲染助手消息及其思考、文本和工具调用。
 *
 * @param props.message - Pi 助手消息
 * @param props.streaming - 消息是否仍在流式生成
 * @param props.toolRuns - 工具实时状态索引
 * @param props.toolResults - 工具最终结果索引
 * @returns 助手消息元素
 */
function AssistantMessage(props: {
  message: AssistantChatMessage;
  streaming: boolean;
  toolRuns: Record<string, ToolRunState>;
  toolResults: Map<string, ToolResultChatMessage>;
}): React.JSX.Element {
  const usage = props.message.usage;

  return (
    <article className="max-w-[min(94%,48rem)] space-y-2.5">
      {props.message.content.map((content, index) => {
        if (content.type === 'thinking') {
          return (
            <ThinkingBlock
              key={`thinking-${index}`}
              text={content.thinking}
              streaming={props.streaming}
              redacted={content.redacted}
            />
          );
        }
        if (content.type === 'toolCall') {
          const run = props.toolRuns[content.id];
          const result = props.toolResults.get(content.id);
          const statusKey = run?.status ?? (result?.isError ? 'error' : 'success');
          return (
            <ToolRun
              key={`${content.id}-${statusKey}`}
              toolCall={content}
              run={run}
              result={result}
            />
          );
        }
        return (
          <MessageContent
            key={`text-${index}`}
            content={[content]}
            markdown
            streaming={props.streaming}
          />
        );
      })}

      {props.streaming && props.message.content.length === 0 ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在响应
        </div>
      ) : null}

      {!props.streaming ? (
        <details className="group text-[11px] text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1">
            {props.message.provider} / {props.message.responseModel ?? props.message.model}
            <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          </summary>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l pl-3">
            <dt>时间</dt>
            <dd>{formatTime(props.message.timestamp)}</dd>
            <dt>模型</dt>
            <dd className="break-all">{props.message.model}</dd>
            <dt>提供方</dt>
            <dd>{props.message.provider}</dd>
            <dt>结束原因</dt>
            <dd>{props.message.stopReason}</dd>
            <dt>Token</dt>
            <dd>
              输入 {usage.input} / 输出 {usage.output} / 缓存读取 {usage.cacheRead} / 总计{' '}
              {usage.totalTokens}
            </dd>
            <dt>费用</dt>
            <dd>${usage.cost.total.toFixed(6)}</dd>
          </dl>
        </details>
      ) : null}
    </article>
  );
}

/**
 * 渲染未能与助手工具调用配对的 ToolResult。
 *
 * @param props.message - Pi 工具结果消息
 * @returns 独立工具结果元素
 */
function OrphanToolResult(props: { message: ToolResultChatMessage }): React.JSX.Element {
  return (
    <details className="max-w-[min(94%,48rem)] overflow-hidden rounded-md border" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/60 px-3 py-2 text-xs">
        <FileTerminal className="size-3.5" />
        <span className="flex-1 font-medium">{props.message.toolName}</span>
        {props.message.isError ? '执行失败' : '执行结果'}
      </summary>
      <div className="border-t px-3 py-2">
        <MessageContent content={props.message.content} />
      </div>
    </details>
  );
}

/**
 * 渲染 Pi 的特殊消息类型。
 *
 * @param props.message - 压缩摘要、分支摘要、Bash 或自定义消息
 * @returns 对应元素；隐藏的自定义消息返回 null
 */
function SpecialMessage(props: {
  message: Exclude<ChatMessage, { role: 'user' | 'assistant' | 'toolResult' }>;
}): React.JSX.Element | null {
  const { message } = props;
  if (message.role === 'compactionSummary') {
    return <CompactionDivider />;
  }
  if (message.role === 'branchSummary') {
    return (
      <details className="max-w-[min(94%,48rem)] border-l-2 pl-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1 font-medium">分支摘要</summary>
        <p className="whitespace-pre-wrap py-2 leading-5">{message.summary}</p>
      </details>
    );
  }
  if (message.role === 'bashExecution') {
    return (
      <details className="max-w-[min(94%,48rem)] overflow-hidden rounded-md border" open>
        <summary className="cursor-pointer bg-muted/60 px-3 py-2 font-mono text-xs">
          $ {message.command}
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t p-3 text-xs leading-5">
          {message.output}
        </pre>
      </details>
    );
  }
  if (!message.display) {
    return null;
  }
  return (
    <details className="max-w-[min(94%,48rem)] overflow-hidden rounded-md border" open>
      <summary className="cursor-pointer bg-muted/60 px-3 py-2 text-xs font-medium">
        {message.customType}
      </summary>
      <div className="border-t px-3 py-2">
        <MessageContent content={message.content} markdown />
      </div>
    </details>
  );
}

/**
 * 渲染压缩完成的持久分割线。
 *
 * @returns “压缩成功”分割线
 */
function CompactionDivider(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <Check className="size-3.5 text-primary" />
      <span>压缩成功</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * 渲染 Pi 自动重试及倒计时。
 *
 * @param props.record - 重试记录
 * @returns 运行中展开、成功后折叠的重试元素
 */
function RetryNotice(props: { record: RetryRecord }): React.JSX.Element {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((props.record.deadlineAt - Date.now()) / 1000))
  );

  useEffect(() => {
    if (props.record.status !== 'waiting') {
      return;
    }
    const update = (): void => {
      setRemainingSeconds(Math.max(0, Math.ceil((props.record.deadlineAt - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [props.record.deadlineAt, props.record.status]);

  const complete = props.record.status === 'success';
  const failed = props.record.status === 'error';
  const title = complete
    ? `第 ${props.record.attempt} 次重试成功`
    : failed
      ? `第 ${props.record.attempt} 次重试失败`
      : props.record.status === 'waiting'
        ? `${remainingSeconds} 秒后重试 (${props.record.attempt}/${props.record.maxAttempts})`
        : `正在重试 (${props.record.attempt}/${props.record.maxAttempts})`;

  return (
    <details
      className={`max-w-[min(94%,48rem)] rounded-md border px-3 py-2 text-xs ${failed ? 'border-destructive/50 text-destructive' : 'text-muted-foreground'}`}
      open={!complete}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        {complete ? (
          <Check className="size-3.5 text-primary" />
        ) : failed ? (
          <AlertCircle className="size-3.5" />
        ) : (
          <Clock3 className="size-3.5" />
        )}
        {title}
        <ChevronRight className="ml-auto size-3.5" />
      </summary>
      <p className="mt-2 border-t pt-2 leading-5">{props.record.errorMessage}</p>
    </details>
  );
}

/**
 * 渲染压缩进行中、成功或失败状态。
 *
 * @param props.compaction - Pi 上下文压缩状态
 * @returns 压缩状态元素
 */
function CompactionNotice(props: { compaction: CompactionState }): React.JSX.Element {
  if (props.compaction.status === 'success') {
    return <CompactionDivider />;
  }
  if (props.compaction.status === 'running') {
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在压缩上下文
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 py-2 text-xs text-destructive">
      {props.compaction.status === 'aborted' ? (
        <CircleStop className="size-3.5" />
      ) : (
        <AlertCircle className="size-3.5" />
      )}
      {props.compaction.status === 'aborted'
        ? '上下文压缩已中止'
        : (props.compaction.message ?? '上下文压缩失败')}
    </div>
  );
}

/**
 * 把 Pi 消息历史和实时状态渲染为语义化对话记录。
 *
 * @param props - 消息、实时助手、工具、重试和压缩状态
 * @returns 完整对话记录
 */
export function ChatTranscript(props: ChatTranscriptProps): React.JSX.Element {
  const toolResults = useMemo(
    () =>
      new Map(
        props.messages
          .filter((message): message is ToolResultChatMessage => message.role === 'toolResult')
          .map((message) => [message.toolCallId, message])
      ),
    [props.messages]
  );
  const pairedToolCallIds = useMemo(
    () =>
      new Set(
        props.messages.flatMap((message) =>
          message.role === 'assistant'
            ? message.content
                .filter((content) => content.type === 'toolCall')
                .map((content) => content.id)
            : []
        )
      ),
    [props.messages]
  );

  if (props.loading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="sr-only">正在加载对话</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {props.messages.map((message, index) => {
        const key = `${message.role}-${message.timestamp}-${index}`;
        if (message.role === 'user') {
          return <UserMessage key={key} message={message} />;
        }
        if (message.role === 'assistant') {
          return (
            <AssistantMessage
              key={key}
              message={message}
              streaming={false}
              toolRuns={props.toolRuns}
              toolResults={toolResults}
            />
          );
        }
        if (message.role === 'toolResult') {
          return pairedToolCallIds.has(message.toolCallId) ? null : (
            <OrphanToolResult key={key} message={message} />
          );
        }
        return <SpecialMessage key={key} message={message} />;
      })}

      {props.activeAssistant ? (
        <AssistantMessage
          key={`active-${props.activeAssistant.timestamp}`}
          message={props.activeAssistant}
          streaming
          toolRuns={props.toolRuns}
          toolResults={toolResults}
        />
      ) : null}

      {props.retries.map((record) => (
        <RetryNotice key={record.id} record={record} />
      ))}

      {props.compaction ? <CompactionNotice compaction={props.compaction} /> : null}
    </div>
  );
}
