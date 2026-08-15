import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Loader2, RotateCcw, Send, Square } from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';

import type { ThinkingLevel } from '@lvdagun/protocol';

import { SessionSidebar } from '@/components/chat/session-sidebar';
import { ChatTranscript } from '@/components/chat/chat-transcript';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useChatSession } from '@/hooks/use-chat-session';
import { type SessionList, useSessionList } from '@/hooks/use-session-list';

/** 空会话中可直接填入输入框的示例提示。 */
const SUGGESTIONS = ['总结今天的重要新闻', '帮我检查一个本地项目', '制定本周待办计划'];

/** 会话侧栏布局在浏览器中的稳定标识。 */
const CHAT_LAYOUT_ID = 'chat-workspace-layout';

/** Pi 思考等级的中文标签。 */
const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: '关闭思考',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

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
            error={sessionList.error}
            onCreate={handleNewSession}
            onSelect={(selectedId) => navigate(`/sessions/${encodeURIComponent(selectedId)}`)}
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
  const { state, send, retry, abort, setThinkingLevel } = useChatSession(sessionId);
  const { refresh: refreshSessionList } = sessionList;
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const anotherRunningSession = sessionList.sessions.find(
    (session) => session.isRunning && session.id !== sessionId
  );
  const hasTranscript =
    state.messages.length > 0 ||
    state.activeAssistant !== null ||
    state.retries.length > 0 ||
    state.compaction !== null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: state.isRunning ? 'smooth' : 'auto' });
  }, [
    state.activeAssistant,
    state.compaction,
    state.isRunning,
    state.messages,
    state.retries,
    state.toolRuns,
  ]);

  useEffect(() => {
    void refreshSessionList();
  }, [refreshSessionList, state.isRunning]);

  /**
   * 校验并发送当前输入。
   *
   * @returns 无返回值
   */
  const handleSend = (): void => {
    const text = input.trim();
    if (!text || state.sending || state.isRunning || anotherRunningSession) {
      return;
    }
    setInput('');
    void send(text);
  };

  /**
   * 更新当前会话的思考等级。
   *
   * @param level - 当前模型支持的思考等级字符串
   * @returns 无返回值
   */
  const handleThinkingLevelChange = (level: string): void => {
    void setThinkingLevel(level as ThinkingLevel);
  };

  const inputPlaceholder = anotherRunningSession
    ? '另一个会话正在运行'
    : state.isRunning
      ? 'Agent 正在运行'
      : '输入消息';

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <div className="mr-auto min-w-0">
          <h2 className="truncate text-sm font-semibold">新对话</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${
                state.isRunning ? 'animate-pulse bg-soy' : 'bg-wood'
              }`}
            />
            {state.isRunning ? '运行中' : '就绪'}
          </p>
        </div>

        {state.session ? (
          <label className="flex h-8 items-center gap-1.5 rounded-md bg-muted/70 px-2 text-xs text-muted-foreground">
            <span>思考</span>
            <select
              aria-label="思考等级"
              className="max-w-24 bg-transparent text-foreground outline-none"
              value={state.session.thinkingLevel}
              disabled={state.settingThinkingLevel}
              onChange={(event) => handleThinkingLevelChange(event.target.value)}
            >
              {state.session.availableThinkingLevels.map((level) => (
                <option key={level} value={level}>
                  {THINKING_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
            {state.settingThinkingLevel ? <Loader2 className="size-3 animate-spin" /> : null}
          </label>
        ) : null}
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-3xl">
          {!state.loading && !hasTranscript ? (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-5 text-center">
              <div>
                <h3 className="text-base font-semibold">开始一段新对话</h3>
                <p className="mt-1 text-sm text-muted-foreground">本地 Pi Agent 已准备就绪</p>
              </div>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-md bg-muted/70 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatTranscript
              messages={state.messages}
              activeAssistant={state.activeAssistant}
              toolRuns={state.toolRuns}
              retries={state.retries}
              compaction={state.compaction}
              loading={state.loading}
            />
          )}

          {state.error ? (
            <div className="mt-5 flex max-w-[min(94%,48rem)] items-center gap-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <span className="min-w-0 flex-1 break-words">{state.error.message}</span>
              {state.error.retryable ? (
                <Button variant="outline" size="sm" onClick={retry}>
                  <RotateCcw />
                  重试
                </Button>
              ) : null}
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </section>

      <footer className="shrink-0 bg-background px-5 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className="max-h-40 min-h-11 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2.5 text-sm leading-5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={inputPlaceholder}
            rows={2}
            value={input}
            disabled={state.loading || Boolean(anotherRunningSession)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
          {state.isRunning ? (
            <Button
              className="h-11 min-w-11"
              variant="outline"
              disabled={state.aborting}
              title="停止"
              aria-label="停止"
              onClick={() => void abort()}
            >
              {state.aborting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Square className="fill-current" />
              )}
            </Button>
          ) : (
            <Button
              className="h-11 min-w-11"
              disabled={
                !input.trim() || state.sending || state.loading || Boolean(anotherRunningSession)
              }
              title="发送"
              aria-label="发送"
              onClick={handleSend}
            >
              {state.sending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

export default ChatPage;
