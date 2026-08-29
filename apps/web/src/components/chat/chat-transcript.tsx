import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Loader2,
  Pencil,
  Send,
  Split,
  Wrench,
  X,
} from 'lucide-react';
import { Streamdown } from 'streamdown';

import type {
  ProductAgentRun,
  ProductAssistantSegmentItem,
  ProductCompactionItem,
  ProductRetryItem,
  ProductSessionHistory,
  ProductToolCallBlock,
  ProductToolDraft,
  ProductToolResultItem,
  ProductUserMessageItem,
} from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';

interface ChatTranscriptProps {
  history: ProductSessionHistory | null;
  loading: boolean;
  runMarker: { runId: string | null; text: string } | null;
  editableUserItemId: string | null;
  editing: { itemId: string; draft: string; submitting: boolean } | null;
  forkingRunId: string | null;
  actionsDisabled: boolean;
  onStartEdit: (itemId: string, text: string) => void;
  onEditDraftChange: (draft: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onFork: (runId: string) => void;
}

/** @param props.text - 当前可判断的运行阶段 @returns 助手回复末尾的瞬时运行标记 */
function AgentRunMarker({ text }: { text: string }): React.JSX.Element {
  return (
    <Marker
      role="status"
      className="max-w-[min(94%,48rem)] animate-in fade-in slide-in-from-bottom-2 text-soy-foreground duration-300"
    >
      <MarkerIcon>
        <Loader2 className="animate-spin" />
      </MarkerIcon>
      <MarkerContent>{text}</MarkerContent>
    </Marker>
  );
}

/** @param value - JSON 兼容值 @returns 检查文本 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** @param timestamp - Unix 毫秒 @returns 小时和分钟 */
function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp);
}

/** @param markdown - 流式 Markdown @returns 单块 Markdown，确保跨段字符共享一条动画时间线 */
function parseStreamingMarkdown(markdown: string): string[] {
  return [markdown];
}

/** @param props.text - Markdown 文本 @param props.streaming - 是否流式 @returns 文本块 */
function MarkdownText(props: { text: string; streaming?: boolean }): React.JSX.Element {
  return (
    <Streamdown
      className="chat-markdown text-[15px] leading-7"
      mode={props.streaming ? 'streaming' : 'static'}
      isAnimating={props.streaming}
      // Streamdown 默认按 Markdown block 分别从 delay=0 开始动画；流式时合为单块并按字符级联，
      // 否则同一批新增内容跨段后，各段首字会同时出现。
      // ponytail: 流式阶段单块重解析换取全局顺序；超长回复若卡顿再换跨 block 动画插件。
      parseMarkdownIntoBlocksFn={props.streaming ? parseStreamingMarkdown : undefined}
      animated={props.streaming ? { sep: 'char', stagger: 15, duration: 120 } : undefined}
      caret={props.streaming ? 'block' : undefined}
    >
      {props.text}
    </Streamdown>
  );
}

/** @param props - 产品用户消息与操作 @returns 用户气泡 */
function UserMessage(props: {
  item: ProductUserMessageItem;
  editable: boolean;
  editing: { draft: string; submitting: boolean } | null;
  onStartEdit: (itemId: string, text: string) => void;
  onEditDraftChange: (draft: string) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
}): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.editing) textareaRef.current?.focus();
  }, [props.editing]);

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
          />
          <div className="mt-2 flex justify-end gap-1">
            <Button size="icon" variant="ghost" title="取消编辑" onClick={props.onCancelEdit}>
              <X />
            </Button>
            <Button
              size="icon"
              variant="outline"
              title="发送编辑后的消息"
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
      <div className="max-w-[min(88%,42rem)] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{props.item.text}</p>
      </div>
      <div className="pointer-events-none mt-1 flex min-h-7 items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <time className="px-1 text-xs">{formatTime(props.item.createdAt)}</time>
        {props.editable ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="编辑并重发"
            onClick={() => props.onStartEdit(props.item.itemId, props.item.text)}
          >
            <Pencil className="size-4" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title="复制消息"
          onClick={() => void navigator.clipboard.writeText(props.item.text)}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </article>
  );
}

/** @param props - 思考内容 @returns 可展开思考块 */
function ThinkingBlock(props: { text: string; streaming: boolean; redacted?: boolean }) {
  const [open, setOpen] = useState(props.streaming);
  return (
    <details
      className={`group ${props.streaming ? 'animate-in fade-in slide-in-from-bottom-2 duration-300' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium text-soy-foreground">
        <Brain className="size-3.5" />
        {props.streaming ? '正在思考' : '思考过程'}
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <p className="pb-2 pt-1 text-xs leading-5 text-muted-foreground">
        {props.redacted ? '思考内容已由模型提供方隐藏' : props.text || '等待思考内容...'}
      </p>
    </details>
  );
}

/** @param props - 工具调用、最终结果和实时草稿 @returns 工具块 */
function ToolRun(props: {
  call: ProductToolCallBlock;
  result?: ProductToolResultItem;
  draft?: ProductToolDraft;
  blobs: ProductSessionHistory['blobs'];
  entrance?: boolean;
}): React.JSX.Element {
  const status = props.draft?.status ?? (props.result?.isError ? 'error' : 'success');
  const [open, setOpen] = useState(false);
  const command = (props.call.args as { command?: unknown } | null)?.command;
  const title =
    !open && props.call.toolName === 'bash' && typeof command === 'string'
      ? command
      : props.call.toolName;
  return (
    <details
      className={`overflow-hidden rounded-lg bg-soy-wash ${
        status === 'error'
          ? 'text-destructive ring-1 ring-destructive/35'
          : status === 'running'
            ? 'ring-1 ring-soy/45'
            : ''
      } ${props.entrance ? 'animate-in fade-in slide-in-from-bottom-2 duration-300' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <Wrench className={`size-3.5 ${status === 'error' ? '' : 'text-soy'}`} />
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>
          {title}
        </span>
        <span
          className={
            status === 'running'
              ? 'text-soy-foreground'
              : status === 'error'
                ? ''
                : 'text-muted-foreground'
          }
        >
          {status === 'running' ? '运行中' : status === 'error' ? '执行失败' : '执行完成'}
        </span>
        {status === 'running' ? <Loader2 className="size-3.5 animate-spin text-soy" /> : null}
      </summary>
      <div className="space-y-3 bg-card/70 px-3 py-2.5 text-xs">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-card p-2 font-mono leading-5">
          {formatValue(props.call.args)}
        </pre>
        {props.result?.content.map((block, index) =>
          block.type === 'text' ? (
            <pre key={index} className="max-h-72 overflow-auto whitespace-pre-wrap break-all">
              {block.text}
            </pre>
          ) : (
            <img
              key={index}
              src={`data:${block.mimeType};base64,${props.blobs[block.blobId]?.data ?? ''}`}
              alt="工具输出"
              className="max-h-96 max-w-full rounded-md border object-contain"
            />
          )
        )}
        {!props.result && props.draft?.partialResult !== undefined ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all">
            {formatValue(props.draft.partialResult)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

/** @param props - 重试条目及可选倒计时 @returns 原位重试卡 */
function RetryNotice(props: { item: ProductRetryItem; deadlineAt: number | null }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!props.deadlineAt || props.item.status !== 'waiting') return;
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((props.deadlineAt! - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [props.deadlineAt, props.item.status]);
  const failed = props.item.status === 'error';
  const success = props.item.status === 'success';
  const label = success
    ? `第 ${props.item.attempt} 次重试成功`
    : failed
      ? `第 ${props.item.attempt} 次重试失败`
      : props.item.status === 'waiting' && props.deadlineAt
        ? `${seconds} 秒后重试 (${props.item.attempt}/${props.item.maxAttempts})`
        : `正在重试 (${props.item.attempt}/${props.item.maxAttempts})`;
  return (
    <details
      className={`rounded-md bg-muted/55 px-3 py-2 text-xs ${failed ? 'text-destructive ring-1 ring-destructive/35' : 'text-muted-foreground'}`}
      open={!success}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        {success ? (
          <Check className="size-3.5" />
        ) : failed ? (
          <AlertCircle className="size-3.5" />
        ) : (
          <Clock3 className="size-3.5" />
        )}
        {label}
      </summary>
      <p className="mt-2 rounded bg-card/70 p-2 leading-5">{props.item.errorMessage}</p>
    </details>
  );
}

/** @param item - 压缩条目 @returns 压缩状态 */
function CompactionNotice({ item }: { item: ProductCompactionItem }) {
  if (item.status === 'success') {
    return <div className="py-3 text-center text-xs text-muted-foreground">压缩成功</div>;
  }
  return (
    <div
      className={`py-2 text-center text-xs ${item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {item.status === 'running' ? '正在压缩上下文' : (item.message ?? '上下文压缩已中止')}
    </div>
  );
}

/** @param props - 产品 Agent 运行及操作 @returns 一条完整助手回复 */
function AssistantRun(props: {
  run: ProductAgentRun;
  history: ProductSessionHistory;
  markerText: string | null;
  forking: boolean;
  actionsDisabled: boolean;
  onFork: (runId: string) => void;
  userProps: Omit<Parameters<typeof UserMessage>[0], 'item' | 'editable' | 'editing'> & {
    editableUserItemId: string | null;
    editing: ChatTranscriptProps['editing'];
  };
}): React.JSX.Element {
  const results = useMemo(
    () =>
      new Map(
        props.run.items
          .filter((item): item is ProductToolResultItem => item.type === 'tool_result')
          .map((item) => [item.toolCallId, item])
      ),
    [props.run.items]
  );
  const tools = new Map(
    (props.history.draft?.runId === props.run.runId ? props.history.draft.tools : []).map(
      (tool) => [tool.toolCallId, tool]
    )
  );
  const visibleSegments = props.run.items.filter(
    (item): item is ProductAssistantSegmentItem =>
      item.type === 'assistant_segment' && item.status !== 'superseded'
  );
  const text = visibleSegments
    .flatMap((segment) => segment.content)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const active =
    props.history.draft?.runId === props.run.runId ? props.history.draft.activeSegment : null;
  const firstAssistantAt =
    visibleSegments[0]?.createdAt ?? active?.createdAt ?? props.run.startedAt;

  const renderSegment = (segment: ProductAssistantSegmentItem, streaming: boolean) =>
    segment.content.map((block, index) => {
      if (block.type === 'text')
        return <MarkdownText key={index} text={block.text} streaming={streaming} />;
      if (block.type === 'thinking')
        return (
          <ThinkingBlock
            key={index}
            text={block.text}
            redacted={block.redacted}
            streaming={streaming}
          />
        );
      if (block.toolName === 'todo') return null;
      return (
        <ToolRun
          key={block.toolCallId}
          entrance={streaming}
          call={block}
          result={results.get(block.toolCallId)}
          draft={tools.get(block.toolCallId)}
          blobs={props.history.blobs}
        />
      );
    });

  return (
    <section className="group/run space-y-5">
      {props.run.items.map((item) => {
        if (item.type === 'user_message') {
          return (
            <UserMessage
              key={item.itemId}
              item={item}
              editable={item.itemId === props.userProps.editableUserItemId}
              editing={
                props.userProps.editing?.itemId === item.itemId ? props.userProps.editing : null
              }
              onStartEdit={props.userProps.onStartEdit}
              onEditDraftChange={props.userProps.onEditDraftChange}
              onCancelEdit={props.userProps.onCancelEdit}
              onSubmitEdit={props.userProps.onSubmitEdit}
            />
          );
        }
        if (item.type === 'assistant_segment') {
          return item.status === 'superseded' ? null : (
            <div key={item.itemId} className="max-w-[min(94%,48rem)] space-y-2.5">
              {renderSegment(item, false)}
            </div>
          );
        }
        if (item.type === 'retry') {
          return (
            <div key={item.itemId} className="max-w-[min(94%,48rem)]">
              <RetryNotice item={item} deadlineAt={props.history.draft?.retryDeadlineAt ?? null} />
            </div>
          );
        }
        if (item.type === 'compaction') return <CompactionNotice key={item.itemId} item={item} />;
        return null;
      })}
      {active ? (
        <div className="max-w-[min(94%,48rem)] space-y-2.5">{renderSegment(active, true)}</div>
      ) : null}
      {props.markerText ? <AgentRunMarker text={props.markerText} /> : null}
      {props.run.status !== 'accepted' && props.run.status !== 'running' ? (
        <div className="pointer-events-none flex min-h-7 items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover/run:pointer-events-auto group-hover/run:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="复制回复"
            disabled={!text}
            onClick={() => void navigator.clipboard.writeText(text)}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="分叉为新会话"
            disabled={props.forking || props.actionsDisabled}
            onClick={() => props.onFork(props.run.runId)}
          >
            {props.forking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Split className="size-4 rotate-90" />
            )}
          </Button>
          {firstAssistantAt ? (
            <time className="px-1 text-xs">{formatTime(firstAssistantAt)}</time>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** @param props - 产品历史与操作 @returns 完整对话记录 */
export function ChatTranscript(props: ChatTranscriptProps): React.JSX.Element {
  if (props.loading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!props.history) return <div />;
  return (
    <div className="space-y-5">
      {props.history.runs.map((run) => (
        <AssistantRun
          key={run.runId}
          run={run}
          history={props.history!}
          markerText={props.runMarker?.runId === run.runId ? props.runMarker.text : null}
          forking={props.forkingRunId === run.runId}
          actionsDisabled={props.actionsDisabled}
          onFork={props.onFork}
          userProps={{
            editableUserItemId: props.editableUserItemId,
            editing: props.editing,
            onStartEdit: props.onStartEdit,
            onEditDraftChange: props.onEditDraftChange,
            onCancelEdit: props.onCancelEdit,
            onSubmitEdit: props.onSubmitEdit,
          }}
        />
      ))}
      {props.runMarker?.runId === null ? <AgentRunMarker text={props.runMarker.text} /> : null}
    </div>
  );
}
