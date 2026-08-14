import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Settings,
  Square,
} from 'lucide-react';

import type { ThinkingLevel } from '@lvdagun/protocol';

import { ChatTranscript } from '@/components/chat/chat-transcript';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useChatSession } from '@/hooks/use-chat-session';

/** 空会话中可直接填入输入框的示例提示。 */
const SUGGESTIONS = ['总结今天的重要新闻', '帮我检查一个本地项目', '制定本周待办计划'];

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
 * 渲染本地 Pi Agent 对话工作台。
 *
 * @returns 对话页元素
 */
function ChatPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { state, send, retry, abort, newSession, setThinkingLevel } = useChatSession();
  const [input, setInput] = useState('');
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
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

  /**
   * 校验并发送当前输入。
   *
   * @returns 无返回值
   */
  const handleSend = (): void => {
    const text = input.trim();
    if (!text || state.sending || state.isRunning) {
      return;
    }
    setInput('');
    void send(text);
  };

  /**
   * 使用 Pi 原生能力开始新会话。
   *
   * @returns 无返回值
   */
  const handleNewSession = (): void => {
    if (state.isRunning || state.creatingSession) {
      return;
    }
    void newSession();
  };

  /**
   * 将原生下拉框值转换为 Pi 思考等级。
   *
   * @param level - 当前模型支持的思考等级字符串
   * @returns 无返回值
   */
  const handleThinkingLevelChange = (level: string): void => {
    void setThinkingLevel(level as ThinkingLevel);
  };

  return (
    <main className="flex h-dvh min-h-[32rem] flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur sm:px-5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <div className="mr-auto flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              驴
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">驴打滚</h1>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={`size-1.5 rounded-full ${state.isRunning ? 'animate-pulse bg-amber-500' : 'bg-emerald-600'}`}
                />
                {state.isRunning ? '运行中' : '就绪'}
              </p>
            </div>
          </div>

          {state.session ? (
            <label className="flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">思考</span>
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

          <Button
            variant="ghost"
            size="sm"
            title="新对话"
            aria-label="新对话"
            disabled={state.isRunning || state.creatingSession}
            onClick={() => setNewSessionDialogOpen(true)}
          >
            {state.creatingSession ? (
              <Loader2 className="animate-spin" />
            ) : (
              <MessageSquarePlus />
            )}
            <span className="hidden sm:inline">新对话</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="设置"
            aria-label="设置"
            onClick={() => navigate('/settings')}
          >
            <Settings />
          </Button>
        </div>
      </header>

      <AlertDialog open={newSessionDialogOpen} onOpenChange={setNewSessionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>开始新对话？</AlertDialogTitle>
            <AlertDialogDescription>
              当前对话将从界面移除，新消息会进入一个独立的 Pi 会话。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={state.isRunning || state.creatingSession}
              onClick={handleNewSession}
            >
              开始新对话
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5">
        <div className="mx-auto max-w-3xl">
          {!state.loading && !hasTranscript ? (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-5 text-center">
              <div>
                <h2 className="text-base font-semibold">开始一段新对话</h2>
                <p className="mt-1 text-sm text-muted-foreground">本地 Pi Agent 已准备就绪</p>
              </div>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

      <footer className="shrink-0 border-t bg-background px-3 py-3 sm:px-5">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            className="max-h-40 min-h-11 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2.5 text-sm leading-5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={state.isRunning ? 'Agent 正在运行' : '输入消息'}
            rows={2}
            value={input}
            disabled={state.loading}
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
              {state.aborting ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
            </Button>
          ) : (
            <Button
              className="h-11 min-w-11"
              disabled={!input.trim() || state.sending || state.loading}
              title="发送"
              aria-label="发送"
              onClick={handleSend}
            >
              {state.sending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          )}
        </div>
      </footer>
    </main>
  );
}

export default ChatPage;
