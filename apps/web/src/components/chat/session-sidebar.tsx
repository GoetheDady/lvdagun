import { Loader2, MessageSquare, Plus, Settings } from 'lucide-react';

import type { SessionSummary } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  loading: boolean;
  creating: boolean;
  error: string | null;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
  onSettings: () => void;
}

/**
 * 渲染桌面端常驻会话导航。
 *
 * @param props - 会话摘要、当前选择和导航回调
 * @returns 会话侧边栏
 */
export function SessionSidebar({
  sessions,
  activeSessionId,
  loading,
  creating,
  error,
  onCreate,
  onSelect,
  onSettings,
}: SessionSidebarProps): React.JSX.Element {
  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground ring-1 ring-soy/60">
          驴
        </div>
        <h1 className="truncate text-sm font-semibold">驴打滚</h1>
      </div>

      <div className="p-3">
        <Button className="w-full justify-start" disabled={creating} onClick={onCreate}>
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          新对话
        </Button>
      </div>

      <nav aria-label="会话列表" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : null}
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
              onClick={() => onSelect(session.id)}
            >
              <MessageSquare className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{session.title}</span>
                <span
                  className={`block text-[11px] ${active ? 'text-sidebar-primary-foreground/70' : 'text-muted-foreground'}`}
                >
                  {DATE_FORMATTER.format(session.updatedAt)}
                </span>
              </span>
              {session.isRunning ? (
                <span
                  className="size-1.5 shrink-0 animate-pulse rounded-full bg-soy ring-1 ring-soy-foreground/20"
                  title="运行中"
                  aria-label="运行中"
                />
              ) : null}
            </button>
          );
        })}
        {error ? <p className="px-2 py-2 text-xs text-destructive">{error}</p> : null}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <Button
          className="w-full justify-start hover:bg-sidebar-accent"
          variant="ghost"
          onClick={onSettings}
        >
          <Settings />
          设置
        </Button>
      </div>
    </aside>
  );
}
