import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Archive, Loader2, MessageSquareOff, Send, Square } from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';

import { SessionSidebar } from '@/components/chat/session-sidebar';
import { ChatTranscript } from '@/components/chat/chat-transcript';
import { ModelSelector } from '@/components/chat/model-selector';
import { PendingMessages } from '@/components/chat/pending-messages';
import { SessionExecutionPlanView } from '@/components/chat/session-execution-plan';
import { ThinkingLevelSlider } from '@/components/chat/thinking-level-slider';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useChatSession } from '@/hooks/use-chat-session';
import {
  selectEditableUserItemId,
  selectRunMarker,
  selectSessionTitle,
} from '@/state/chat-session-selectors';
import type { SessionUnavailableReason } from '@/state/chat-session-state';
import { type SessionList, useSessionList } from '@/hooks/use-session-list';
import { useHubConnection } from '@/hooks/use-hub-connection';

/** 空会话中可直接填入输入框的示例提示。 */
const SUGGESTIONS = ['总结今天的重要新闻', '帮我检查一个本地项目', '制定本周待办计划'];

/** 会话侧栏布局在浏览器中的稳定标识。 */
const CHAT_LAYOUT_ID = 'chat-workspace-layout';

/**
 * 把取回文本放在现有草稿之前，并用空行分隔每条消息。
 *
 * @param texts - 按原排队顺序取回的文本
 * @param draft - 当前客户端草稿
 * @returns 合并后的草稿
 */
function prependDraft(texts: string[], draft: string): string {
  return [...texts, draft].filter((text) => text.trim() !== '').join('\n\n');
}

/**
 * 从 URL 解析当前会话，并在会话变化时重建客户端状态。
 *
 * @returns 按 session id 寻址的对话工作台
 */
function ChatPage(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) {
    return <Navigate to="/" replace />;
  }
  return <ChatShell sessionId={sessionId} />;
}

/**
 * 保持桌面端会话侧栏稳定，只在切换时重建右侧对话区域。
 *
 * @param props - 当前 URL 中的会话标识
 * @returns 对话工作台
 */
function ChatShell({ sessionId }: { sessionId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const sessionList = useSessionList();
  const hubConnection = useHubConnection();
  const persistedLayout = useDefaultLayout({
    id: CHAT_LAYOUT_ID,
    panelIds: ['session-sidebar', 'chat-workspace'],
  });

  /**
   * 创建持久化会话并导航到其 URL。
   *
   * @returns 无返回值
   */
  const handleNewSession = (): void => {
    void sessionList.createSession().then((createdId) => {
      if (createdId) {
        navigate(`/sessions/${encodeURIComponent(createdId)}`);
      }
    });
  };

  /**
   * 归档指定会话。
   *
   * @param targetSessionId - 要归档的会话标识
   * @returns 无返回值
   */
  const handleArchiveSession = (targetSessionId: string): void => {
    void sessionList.archiveSession(targetSessionId);
  };

  /**
   * 永久删除指定会话。
   *
   * @param targetSessionId - 要永久删除的会话标识
   * @returns 无返回值
   */
  const handleDeleteSession = (targetSessionId: string): void => {
    void sessionList.deleteSession(targetSessionId);
  };

  return (
    <main className="flex h-dvh min-h-[32rem] min-w-[64rem] overflow-hidden bg-background">
      <ResizablePanelGroup id={CHAT_LAYOUT_ID} orientation="horizontal" {...persistedLayout}>
        <ResizablePanel
          id="session-sidebar"
          defaultSize="256px"
          minSize="208px"
          maxSize="384px"
          groupResizeBehavior="preserve-pixel-size"
        >
          <SessionSidebar
            sessions={sessionList.sessions}
            activeSessionId={sessionId}
            loading={sessionList.loading}
            creating={sessionList.creating}
            mutatingSessionId={sessionList.mutatingSessionId}
            error={sessionList.error}
            hubConnectionStatus={hubConnection.status}
            onCreate={handleNewSession}
            onSelect={(selectedId) => navigate(`/sessions/${encodeURIComponent(selectedId)}`)}
            onArchive={handleArchiveSession}
            onDelete={handleDeleteSession}
            onRename={sessionList.renameSession}
            onReconnect={hubConnection.reconnect}
            onSettings={() => navigate('/settings')}
          />
        </ResizablePanel>

        <ResizableHandle
          aria-label="调整侧栏宽度"
          className="bg-sidebar-border transition-colors hover:bg-wood focus-visible:bg-primary focus-visible:ring-primary/30"
        />

        <ResizablePanel id="chat-workspace" className="min-w-0">
          <ChatWorkspace key={sessionId} sessionId={sessionId} sessionList={sessionList} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}

/**
 * 渲染当前会话的消息和输入区域。
 *
 * @param props - 当前会话标识与稳定的侧边栏列表状态
 * @returns 当前会话工作区
 */
function ChatWorkspace({
  sessionId,
  sessionList,
}: {
  sessionId: string;
  sessionList: SessionList;
}): React.JSX.Element {
  const navigate = useNavigate();
  const {
    state,
    send,
    forkSession,
    editAndResend,
    abort,
    steerPendingMessage,
    removePendingMessage,
    takePendingMessages,
    discardPendingMessages,
    setThinkingLevel,
    setModel,
  } = useChatSession(sessionId);
  const { refresh: refreshSessionList } = sessionList;
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState<{
    itemId: string;
    draft: string;
    submitting: boolean;
  } | null>(null);
  const [forkingRunId, setForkingRunId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLElement>(null);
  const followsOutputRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasTranscript = (state.history?.runs.length ?? 0) > 0;
  const sidebarTitle = sessionList.sessions.find((session) => session.id === sessionId)?.title;
  const sessionTitle = selectSessionTitle(state, sidebarTitle);
  const editableUserItemId = selectEditableUserItemId(state);
  const runMarker = selectRunMarker(state);

  useEffect(() => {
    document.title = `${sessionTitle} - 驴打滚`;
  }, [sessionTitle]);

  // useLayoutEffect：滚动必须在绘制前完成，否则新内容先画出、下一帧才滚，出现可见抖动。
  // 流式事件高频到达，smooth 动画反复重启只会永远落后于内容增长，必须即时贴底。
  // 跟随被用户关闭时不动视图，但用户已回到底部附近则重新贴底并恢复跟随
  //（不依赖 scroll 事件顺序，避免回滚到底部遇上内容爆发时永远无法恢复跟随的竞态）。
  useLayoutEffect(() => {
    const element = transcriptRef.current;
    if (
      element &&
      !followsOutputRef.current &&
      element.scrollHeight - element.scrollTop - element.clientHeight > 80
    ) {
      return;
    }
    bottomRef.current?.scrollIntoView();
    followsOutputRef.current = true;
  }, [state.history]);

  useEffect(() => {
    void refreshSessionList();
  }, [refreshSessionList, state.isRunning, state.session?.sessionName, state.unavailableReason]);

  if (state.unavailableReason) {
    return <UnavailableWorkspace reason={state.unavailableReason} />;
  }

  /**
   * 校验并发送当前输入。
   *
   * @returns 无返回值
   */
  const handleSend = (): void => {
    const text = input.trim();
    if (
      !text ||
      state.sending ||
      state.settingModel ||
      state.settingThinkingLevel ||
      editing !== null
    ) {
      return;
    }
    setInput('');
    void send(text).then((accepted) => {
      if (!accepted) setInput((draft) => prependDraft([text], draft));
    });
  };

  const inputPlaceholder = editing ? '正在编辑历史消息' : '输入消息';

  /** 从一条已完成的助手回复创建会话并切换过去。 */
  const handleFork = (runId: string): void => {
    if (forkingRunId !== null) return;
    setForkingRunId(runId);
    void forkSession(runId).then(async (forkedSessionId) => {
      setForkingRunId(null);
      if (!forkedSessionId) return;
      await refreshSessionList();
      navigate(`/sessions/${encodeURIComponent(forkedSessionId)}`);
    });
  };

  /** 提交原位编辑；失败时保留草稿和旧分支供重试。 */
  const handleSubmitEdit = (): void => {
    if (!editing || editing.submitting || !editing.draft.trim()) return;
    const { itemId, draft } = editing;
    setEditing({ itemId, draft, submitting: true });
    void editAndResend(itemId, draft).then((accepted) => {
      if (accepted) {
        setEditing(null);
      } else {
        setEditing({ itemId, draft, submitting: false });
      }
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border/70 px-5">
        <div className="mx-auto w-full max-w-3xl min-w-0">
          <h2 className="truncate text-sm font-semibold">{sessionTitle}</h2>
        </div>
      </header>

      <section
        ref={transcriptRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        onScroll={() => {
          const element = transcriptRef.current;
          if (!element) return;
          const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
          // 向上滚且离开底部超过阈值才是用户主动离开；内容收缩时浏览器 clamp
          // scrollTop 也产生 top 下移，但那时 gap 仍贴着 0，不能误判为离开
          if (lastScrollTopRef.current - element.scrollTop > 1 && gap > 80) {
            followsOutputRef.current = false;
          }
          lastScrollTopRef.current = element.scrollTop;
        }}
      >
        <div className="mx-auto max-w-3xl">
          {!state.loading && !hasTranscript && !runMarker ? (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-7 text-center">
              <div className="space-y-3">
                <h3 className="font-display text-4xl font-bold tracking-wide">有什么事，吩咐吧。</h3>
                <p className="text-sm text-muted-foreground">驴打滚在本机待命，对话不会离开这台电脑</p>
              </div>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-border bg-card px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatTranscript
              history={state.history}
              loading={state.loading}
              runMarker={runMarker}
              editableUserItemId={editableUserItemId}
              editing={editing}
              forkingRunId={forkingRunId}
              actionsDisabled={!state.synchronized || state.session?.executionAvailable === false}
              onStartEdit={(itemId, draft) => setEditing({ itemId, draft, submitting: false })}
              onEditDraftChange={(draft) =>
                setEditing((current) => (current ? { ...current, draft } : null))
              }
              onCancelEdit={() => setEditing(null)}
              onSubmitEdit={handleSubmitEdit}
              onFork={handleFork}
            />
          )}

          {state.error ? (
            <div className="mt-5 flex max-w-[min(94%,48rem)] items-center gap-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <span className="min-w-0 flex-1 break-words">{state.error.message}</span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </section>

      <footer className="shrink-0 bg-background px-5 py-3">
        <div className="mx-auto max-w-3xl">
          <SessionExecutionPlanView plan={state.history?.executionPlan ?? null} />
          {state.session?.modelWarning ? (
            <p role="status" className="mb-2 text-xs text-muted-foreground">
              {state.session.modelWarning}
            </p>
          ) : null}
          <div
            role="group"
            aria-label="消息输入区"
            className="rounded-xl border border-input bg-card shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10"
          >
            <PendingMessages
              messages={state.session?.pendingMessages ?? []}
              disabled={
                state.aborting ||
                editing !== null ||
                !state.synchronized ||
                state.session?.executionAvailable === false
              }
              steerDisabled={!state.isRunning}
              onSteer={(messageId) => void steerPendingMessage(messageId)}
              onRemove={(messageId) => void removePendingMessage(messageId)}
              onTakeAll={() => {
                void takePendingMessages().then((texts) => {
                  setInput((draft) => prependDraft(texts, draft));
                });
              }}
              onDiscardAll={() => void discardPendingMessages()}
            />
            <textarea
              className="block max-h-40 min-h-20 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm leading-5 placeholder:text-muted-foreground focus-visible:outline-none"
              placeholder={inputPlaceholder}
              rows={2}
              value={input}
              disabled={
                state.loading || editing !== null || state.session?.executionAvailable === false
              }
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // 旧版 Safari 会提前结束组合态，但仍用 229 标识输入法按键。
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex min-h-11 items-center justify-end gap-1 px-2 pb-2">
              {state.session ? (
                <>
                  <ModelSelector
                    value={state.session.model}
                    models={state.session.availableModels}
                    disabled={
                      !state.synchronized ||
                      state.session?.executionAvailable === false ||
                      state.isRunning ||
                      state.settingModel ||
                      state.settingThinkingLevel ||
                      editing !== null
                    }
                    loading={state.settingModel}
                    onSelect={(model) => void setModel(model)}
                  />
                  {/* 模型切换时重建 Slider，避免旧模型预览覆盖新模型的权威状态。 */}
                  <ThinkingLevelSlider
                    key={`${state.session.model.provider}:${state.session.model.id}`}
                    value={state.session.thinkingLevel}
                    levels={state.session.availableThinkingLevels}
                    disabled={
                      !state.synchronized ||
                      state.session?.executionAvailable === false ||
                      state.isRunning ||
                      state.settingModel ||
                      editing !== null
                    }
                    loading={state.settingThinkingLevel}
                    onCommit={setThinkingLevel}
                  />
                </>
              ) : null}
              {state.isRunning ? (
                <Button
                  size="icon"
                  variant="outline"
                  className="rounded-lg"
                  disabled={state.aborting}
                  title="停止"
                  aria-label="停止"
                  onClick={() => {
                    void abort().then((texts) => {
                      setInput((draft) => prependDraft(texts, draft));
                    });
                  }}
                >
                  {state.aborting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Square className="fill-current" />
                  )}
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="rounded-lg"
                  disabled={
                    !input.trim() ||
                    state.sending ||
                    state.settingModel ||
                    state.settingThinkingLevel ||
                    state.loading ||
                    !state.synchronized ||
                    state.session?.executionAvailable === false ||
                    editing !== null
                  }
                  title="发送"
                  aria-label="发送"
                  onClick={handleSend}
                >
                  {state.sending ? <Loader2 className="animate-spin" /> : <Send />}
                </Button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * 渲染已归档、已删除或不存在会话的稳定空状态。
 *
 * @param props - 会话不可显示的原因
 * @returns 不暴露原会话内容的工作区
 */
function UnavailableWorkspace({ reason }: { reason: SessionUnavailableReason }): React.JSX.Element {
  const archived = reason === 'archived';
  const Icon = archived ? Archive : MessageSquareOff;
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center px-5">
        <div>
          <h2 className="text-sm font-semibold">当前会话</h2>
          <p className="text-[11px] text-muted-foreground">{archived ? '已归档' : '不可显示'}</p>
        </div>
      </header>
      <section className="flex min-h-0 flex-1 items-center justify-center px-5 py-8 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-base font-semibold">
            {archived ? '当前会话已归档' : '当前会话不存在或不可显示'}
          </h3>
        </div>
      </section>
    </div>
  );
}

export default ChatPage;
