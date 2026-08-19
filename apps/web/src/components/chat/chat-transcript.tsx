import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Copy,
  FileTerminal,
  Loader2,
  Pencil,
  Send,
  Split,
  Wrench,
  X,
} from 'lucide-react';
import { Streamdown } from 'streamdown';

import type { ChatMessage, SessionMessage } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import type {
  AssistantChatMessage,
  CompactionState,
  RetryRecord,
  ToolResultChatMessage,
  ToolRunState,
} from '@/state/chat-session-state';
import { indexToolResults, selectPairedToolCallIds } from '@/state/chat-session-selectors';

type UserChatMessage = Extract<ChatMessage, { role: 'user' }>;

/** 对话记录组件所需的语义状态。 */
interface ChatTranscriptProps {
  messages: SessionMessage[];
  activeAssistant: AssistantChatMessage | null;
  toolRuns: Record<string, ToolRunState>;
  retries: RetryRecord[];
  compaction: CompactionState | null;
  loading: boolean;
  editableUserEntryId: string | null;
  editing: { entryId: string; draft: string; submitting: boolean } | null;
  forkingEntryId: string | null;
  actionsDisabled: boolean;
  onStartEdit: (entryId: string, text: string) => void;
  onEditDraftChange: (draft: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onFork: (entryId: string) => void;
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
 * @returns 当前区域设置下的小时和分钟
 */
function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
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
function UserMessage(props: {
  message: UserChatMessage;
  entryId: string | null;
  editable: boolean;
  editing: { draft: string; submitting: boolean } | null;
  onStartEdit: (entryId: string, text: string) => void;
  onEditDraftChange: (draft: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
}): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.editing) textareaRef.current?.focus();
  }, [props.editing]);

  const text =
    typeof props.message.content === 'string'
      ? props.message.content
      : props.message.content
          .filter((content) => content.type === 'text')
          .map((content) => content.text)
          .join('\n');

  if (props.editing) {
    return (
      <article className="flex justify-end">
        <div className="w-full max-w-[min(88%,42rem)] rounded-md bg-primary p-2 text-primary-foreground">
          <textarea
            ref={textareaRef}
            aria-label="编辑用户消息"
            className="block min-h-24 w-full resize-y rounded-sm bg-primary-foreground/10 px-2 py-1.5 text-sm leading-6 outline-none ring-1 ring-primary-foreground/25 focus:ring-primary-foreground/50"
            value={props.editing.draft}
            disabled={props.editing.submitting}
            onChange={(event) => props.onEditDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') props.onCancelEdit();
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                props.onSubmitEdit();
              }
            }}
          />
          <div className="mt-2 flex justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              title="取消编辑"
              aria-label="取消编辑"
              disabled={props.editing.submitting}
              onClick={props.onCancelEdit}
            >
              <X />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="bg-background text-foreground hover:bg-background/90 hover:text-foreground"
              title="发送编辑后的消息"
              aria-label="发送编辑后的消息"
              disabled={!props.editing.draft.trim() || props.editing.submitting}
              onClick={props.onSubmitEdit}
            >
              {props.editing.submitting ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex flex-col items-end">
      <div className="max-w-[min(88%,42rem)] rounded-md bg-primary px-3.5 py-2.5 text-primary-foreground">
        <MessageContent content={props.message.content} />
      </div>
      <div className="pointer-events-none mt-1 flex min-h-7 items-center justify-end gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <time className="px-1 text-xs">{formatTime(props.message.timestamp)}</time>
        {props.editable && props.entryId ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="编辑并重发"
            aria-label="编辑并重发"
            onClick={() => props.onStartEdit(props.entryId!, text)}
          >
            <Pencil className="size-4" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title="复制消息"
          aria-label="复制消息"
          disabled={!text}
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          <Copy className="size-4" />
        </Button>
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
      className="group text-muted-foreground"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium">
        <Brain className="size-3.5 text-soy-foreground" />
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
      className={`group overflow-hidden rounded-md bg-muted/55 ${status === 'error' ? 'text-destructive ring-1 ring-destructive/35' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <Wrench className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{props.toolCall.name}</span>
        <span className={status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
          {statusLabel}
        </span>
        <StatusIcon className={`size-3.5 ${status === 'running' ? 'animate-spin' : ''}`} />
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 bg-background/45 px-3 py-2.5 text-xs">
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
  entryId?: string | null;
  streaming: boolean;
  forking?: boolean;
  actionsDisabled?: boolean;
  onFork?: (entryId: string) => void;
  toolRuns: Record<string, ToolRunState>;
  toolResults: Map<string, ToolResultChatMessage>;
}): React.JSX.Element {
  const text = props.message.content
    .map((content) => (content.type === 'text' ? content.text : ''))
    .filter(Boolean)
    .join('\n');

  return (
    <article className="group max-w-[min(94%,48rem)] space-y-2.5">
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
        <div className="pointer-events-none flex min-h-7 items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="复制消息"
            aria-label="复制消息"
            disabled={!text}
            onClick={() => void navigator.clipboard.writeText(text)}
          >
            <Copy className="size-4" />
          </Button>
          {props.entryId ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="分叉为新会话"
              aria-label="分叉为新会话"
              disabled={props.forking || props.actionsDisabled}
              onClick={() => props.onFork?.(props.entryId!)}
            >
              {props.forking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Split className="size-4 rotate-90" />
              )}
            </Button>
          ) : null}
          <time className="px-1 text-xs">{formatTime(props.message.timestamp)}</time>
        </div>
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
    <details className="max-w-[min(94%,48rem)] overflow-hidden rounded-md bg-muted/55" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <FileTerminal className="size-3.5" />
        <span className="flex-1 font-medium">{props.message.toolName}</span>
        {props.message.isError ? '执行失败' : '执行结果'}
      </summary>
      <div className="bg-background/45 px-3 py-2">
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
      <details className="max-w-[min(94%,48rem)] rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1 font-medium">分支摘要</summary>
        <p className="whitespace-pre-wrap py-2 leading-5">{message.summary}</p>
      </details>
    );
  }
  if (message.role === 'bashExecution') {
    return (
      <details className="max-w-[min(94%,48rem)] overflow-hidden rounded-md bg-muted/55" open>
        <summary className="cursor-pointer px-3 py-2 font-mono text-xs">
          $ {message.command}
        </summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all bg-background/45 p-3 text-xs leading-5">
          {message.output}
        </pre>
      </details>
    );
  }
  if (!message.display) {
    return null;
  }
  return (
    <details className="max-w-[min(94%,48rem)] overflow-hidden rounded-md bg-muted/55" open>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
        {message.customType}
      </summary>
      <div className="bg-background/45 px-3 py-2">
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
    <div className="flex w-full items-center gap-3 py-3" role="separator" aria-label="压缩成功">
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5 text-primary" />
        <span>压缩成功</span>
      </div>
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
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
      className={`max-w-[min(94%,48rem)] rounded-md bg-muted/55 px-3 py-2 text-xs ${failed ? 'text-destructive ring-1 ring-destructive/35' : 'text-muted-foreground'}`}
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
      <p className="mt-2 rounded bg-background/45 p-2 leading-5">{props.record.errorMessage}</p>
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
  const toolResults = useMemo(() => indexToolResults(props.messages), [props.messages]);
  const pairedToolCallIds = useMemo(
    () => selectPairedToolCallIds(props.messages),
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
      {props.messages.map(({ entryId, message }, index) => {
        const key = entryId ?? `${message.role}-${message.timestamp}-${index}`;
        if (message.role === 'user') {
          return (
            <UserMessage
              key={key}
              message={message}
              entryId={entryId}
              editable={entryId !== null && entryId === props.editableUserEntryId}
              editing={
                entryId !== null && props.editing?.entryId === entryId
                  ? { draft: props.editing.draft, submitting: props.editing.submitting }
                  : null
              }
              onStartEdit={props.onStartEdit}
              onEditDraftChange={props.onEditDraftChange}
              onCancelEdit={props.onCancelEdit}
              onSubmitEdit={props.onSubmitEdit}
            />
          );
        }
        if (message.role === 'assistant') {
          return (
            <AssistantMessage
              key={key}
              message={message}
              entryId={entryId}
              streaming={false}
              forking={props.forkingEntryId === entryId}
              actionsDisabled={props.actionsDisabled}
              onFork={props.onFork}
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
