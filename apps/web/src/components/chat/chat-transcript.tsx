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
} from 'lucide-react';
import { Streamdown } from 'streamdown';

import type {
  ProductAssistantBlock,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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

/**
 * 判定一段助手内容是否为最终回复：含文本块、且不含任何工具调用块。
 *
 * agent 循环只有在模型不再调用工具时才会结束，因此"有 text、无 toolCall"的消息
 * 即为最终交付物；与此项不相符的段（纯思考、带工具的边做边说）都归属执行过程。
 *
 * @param content - 助手片段的块数组 @returns 是否为最终回复
 */
function isFinalReply(content: ProductAssistantBlock[] | undefined): boolean {
  return !!content?.some((block) => block.type === 'text') && !content?.some((block) => block.type === 'tool_call');
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

/** @param props.text - Markdown 文本 @param props.streaming - 是否流式 @returns 文本块 */
function MarkdownText(props: { text: string; streaming?: boolean }): React.JSX.Element {
  return (
    <Streamdown
      className="chat-markdown text-[15px] leading-7"
      mode={props.streaming ? 'streaming' : 'static'}
      isAnimating={props.streaming}
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
    const editing = props.editing;
    return (
      <article className="flex justify-end">
        {/* 编辑态沿用气泡轮廓，只是胀成可写卡片；底部发丝线分隔提示与操作，
            重发会从这条消息换分支重新生成，后果必须写在操作旁边 */}
        <div className="w-full max-w-[min(88%,42rem)] rounded-2xl rounded-br-md bg-primary px-4 pt-3 pb-2.5 text-primary-foreground shadow-sm">
          <textarea
            ref={textareaRef}
            aria-label="编辑用户消息"
            className="block max-h-64 min-h-16 w-full resize-none bg-transparent text-sm leading-6 text-primary-foreground outline-none disabled:opacity-60"
            value={editing.draft}
            disabled={editing.submitting}
            onChange={(event) => props.onEditDraftChange(event.target.value)}
            onKeyDown={(event) => {
              // 与消息输入框一致：Enter 重发、Shift+Enter 换行；旧版 Safari 会提前结束
              // 组合态，但仍用 229 标识输入法按键，期间不能触发提交
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                props.onCancelEdit();
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                props.onSubmitEdit();
              }
            }}
          />
          <div className="mt-2 flex items-center gap-3 border-t border-primary-foreground/15 pt-2">
            <p className="mr-auto text-xs text-primary-foreground/70">
              重发后将从这条消息重新生成对话
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              onClick={props.onCancelEdit}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-7 bg-primary-foreground px-3 text-primary hover:bg-primary-foreground/90"
              disabled={!editing.draft.trim() || editing.submitting}
              onClick={props.onSubmitEdit}
            >
              {props.editing.submitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              重发
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

  // 最终回复 = run 内最后一个"含 text、无 toolCall"的段；此前的所有内容都属于执行过程。
  // 从后往前找，保证取到真正收尾的那一段（去重后的倒数第一个符合条件的段）。
  const finalItemId = [...visibleSegments].reverse().find((segment) => isFinalReply(segment.content))?.itemId;

  const active =
    props.history.draft?.runId === props.run.runId ? props.history.draft.activeSegment : null;
  // 流式中若活动段已"含 text、无 tool"，即判定它就是要展示的最终回复。
  const activeIsFinal = active !== null && isFinalReply(active.content);
  const finalSegment = visibleSegments.find((segment) => segment.itemId === finalItemId);
  const renderedFinal = finalSegment ?? (activeIsFinal && active ? active : null);
  const finalText =
    renderedFinal?.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n') ?? '';
  // null = 用户尚未干预，跟随自动行为；boolean = 用户已主动展开/收起。
  const [userProcessOpen, setUserProcessOpen] = useState<boolean | null>(null);
  // 最终回复出现前保持展开，出现后自动收起；用户手动切换后按用户选择。
  const processOpen = userProcessOpen ?? renderedFinal === null;

  const firstAssistantAt =
    visibleSegments[0]?.createdAt ?? active?.createdAt ?? props.run.startedAt;

  const renderBlocks = (blocks: ProductAssistantBlock[], streaming: boolean) =>
    blocks.map((block, index) => {
      if (block.type === 'text') {
        return <MarkdownText key={index} text={block.text} streaming={streaming} />;
      }
      if (block.type === 'thinking') {
        return (
          <ThinkingBlock
            key={index}
            text={block.text}
            redacted={block.redacted}
            streaming={streaming}
          />
        );
      }
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

  /** @param segment - 助手片段 @returns 归入执行过程的内容块 */
  const getProcessBlocks = (segment: ProductAssistantSegmentItem): ProductAssistantBlock[] =>
    segment.itemId === finalItemId
      ? segment.content.filter((block) => block.type !== 'text')
      : segment.content;

  // 执行过程只保留助手的思考、工具、重试与压缩；最终文本从工作抽屉中移出。
  const renderProcessItems = () =>
    props.run.items.map((item) => {
      if (item.type === 'user_message') return null;
      if (item.type === 'assistant_segment') {
        if (item.status === 'superseded') return null;
        const blocks = getProcessBlocks(item);
        return blocks.length > 0 ? (
          <div key={item.itemId} className="space-y-2.5">
            {renderBlocks(blocks, false)}
          </div>
        ) : null;
      }
      if (item.type === 'retry') {
        return (
          <div key={item.itemId}>
            <RetryNotice item={item} deadlineAt={props.history.draft?.retryDeadlineAt ?? null} />
          </div>
        );
      }
      if (item.type === 'compaction') return <CompactionNotice key={item.itemId} item={item} />;
      return null;
    });
  const activeProcessBlocks = active
    ? active.content.filter((block) => !activeIsFinal || block.type !== 'text')
    : [];

  // 工作抽屉元信息：只报真实数据——工具执行次数、运行总时长（仅落定后报时长）。
  const toolCount = new Set([...results.keys(), ...tools.keys()]).size;
  const hasProcessItems =
    props.run.items.some(
      (item) =>
        item.type === 'tool_result' ||
        item.type === 'retry' ||
        item.type === 'compaction' ||
        (item.type === 'assistant_segment' &&
          item.status !== 'superseded' &&
          getProcessBlocks(item).length > 0)
    ) || activeProcessBlocks.length > 0;
  const runSeconds =
    props.run.startedAt !== null && props.run.settledAt !== null
      ? Math.max(1, Math.round((props.run.settledAt - props.run.startedAt) / 1000))
      : null;
  const processMeta = [
    toolCount > 0 ? `${toolCount} 次工具` : null,
    runSeconds !== null ? `${runSeconds} 秒` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <section className="group/run space-y-5">
      {props.run.items.map((item) =>
        item.type === 'user_message' ? (
          <UserMessage
            key={item.itemId}
            item={item}
            editable={item.itemId === props.userProps.editableUserItemId}
            editing={props.userProps.editing?.itemId === item.itemId ? props.userProps.editing : null}
            onStartEdit={props.userProps.onStartEdit}
            onEditDraftChange={props.userProps.onEditDraftChange}
            onCancelEdit={props.userProps.onCancelEdit}
            onSubmitEdit={props.userProps.onSubmitEdit}
          />
        ) : null
      )}
      {hasProcessItems ? (
        <div className="max-w-[min(94%,48rem)] overflow-hidden rounded-lg border border-soy/25 border-l-[3px] border-l-soy/55 bg-soy-wash/55">
          {/* 工作抽屉：豆面色属于 Agent 劳动痕迹；最终回复出现后平滑收拢。 */}
          <button
            type="button"
            aria-expanded={processOpen}
            onClick={() => setUserProcessOpen(!processOpen)}
            className="flex min-h-10 w-full select-none items-center gap-2 px-3 text-left text-xs text-soy-foreground transition-colors hover:bg-soy/8 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-soy/12">
              <Wrench className="size-3.5" />
            </span>
            <span className="font-semibold tracking-wide">执行过程</span>
            {processMeta ? (
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {processMeta}
              </span>
            ) : null}
            <ChevronRight
              className={`size-3.5 shrink-0 transition-transform duration-300 ${processOpen ? 'rotate-90' : ''}`}
            />
          </button>
          <div
            className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              // 自动收起（最终回复到达）时瞬时跳变：此刻页面正滚向底部，动画发生在视口外，
              // 平滑收拢反而让抽屉"消失感"变成残影；只有用户手动开合才做动画。
              transitionProperty: userProcessOpen === null ? 'none' : undefined,
              gridTemplateRows: processOpen ? '1fr' : '0fr',
              opacity: processOpen ? 1 : 0,
            }}
          >
            <div className="overflow-hidden">
              <div className="space-y-4 border-t border-soy/15 bg-card/35 px-3 py-3">
                {renderProcessItems()}
                {activeProcessBlocks.length > 0 ? (
                  <div className="space-y-2.5">
                    {renderBlocks(activeProcessBlocks, true)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 最终回复不加文字标签与装饰，靠豆面色执行抽屉区分层级。 */}
      {renderedFinal ? (
        <div className="max-w-[min(94%,48rem)] space-y-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
          {renderBlocks(
            renderedFinal.content.filter((block) => block.type === 'text'),
            renderedFinal !== finalSegment
          )}
        </div>
      ) : null}

      {props.markerText ? <AgentRunMarker text={props.markerText} /> : null}
      {props.run.status !== 'accepted' && props.run.status !== 'running' ? (
        <div className="pointer-events-none flex min-h-7 items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover/run:pointer-events-auto group-hover/run:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="复制回复"
            disabled={!finalText}
            onClick={() => void navigator.clipboard.writeText(finalText)}
          >
            <Copy className="size-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title="分叉为新会话"
                disabled={props.forking || props.actionsDisabled}
              >
                {props.forking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Split className="size-4 rotate-90" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>分叉为新会话？</AlertDialogTitle>
                <AlertDialogDescription>
                  将从这条回复创建一个独立的新会话，当前会话保持不变。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => props.onFork(props.run.runId)}>
                  分叉
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
