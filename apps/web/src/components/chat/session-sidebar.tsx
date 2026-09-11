import { useState } from 'react';
import {
  Archive,
  CircleAlert,
  Ellipsis,
  MessageSquare,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';

import type { SessionSummary } from '@lvdagun/protocol';
import type { HubConnectionStatus } from '@/services/rpc-client';

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
import { Button, buttonVariants } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/icon-tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  mutatingSessionId: string | null;
  error: string | null;
  hubConnectionStatus: HubConnectionStatus;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
  onArchive: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onReconnect: () => void;
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
  mutatingSessionId,
  error,
  hubConnectionStatus,
  onCreate,
  onSelect,
  onArchive,
  onDelete,
  onRename,
  onReconnect,
  onSettings,
}: SessionSidebarProps): React.JSX.Element {
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [pendingRename, setPendingRename] = useState<SessionSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-12 shrink-0 items-center gap-2.5 px-4">
          <img
            alt=""
            className="size-8 shrink-0 rounded-md"
            height="32"
            src="/brand/logo-512.png"
            width="32"
          />
          <h1 className="font-display truncate text-[17px] font-bold tracking-wide">驴打滚</h1>
        </div>

        <div className="p-3">
          <Button className="w-full justify-start" onClick={onCreate}>
            <Plus />
            新对话
          </Button>
        </div>

        <nav aria-label="会话列表" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {loading && sessions.length === 0 ? (
            /* 占位高度对齐真实会话行,数据到达时原地替换而不跳高 */
            <div aria-hidden="true" className="space-y-2 pt-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="space-y-1.5 rounded-md px-2.5 py-2">
                  <Skeleton className="h-4 w-40 bg-sidebar-accent/60" />
                  <Skeleton className="h-3 w-20 bg-sidebar-accent/40" />
                </div>
              ))}
            </div>
          ) : null}
          {sessions.map((session) => {
            const active = session.id === activeSessionId;
            const mutating = mutatingSessionId === session.id;
            const destructiveActionsDisabled = session.isRunning || mutating;
            return (
              <div
                key={session.id}
                className={`group relative mb-1 flex w-full items-stretch rounded-md transition-colors ${
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:top-1/2 before:left-0 before:h-4.5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-primary'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                }`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`打开会话：${session.title}`}
                  aria-current={active ? 'page' : undefined}
                  // h-auto/justify-start/font-normal 抹平 Button 默认尺寸;行底色由外层容器负责,
                  // 因此把 ghost 自带的悬停底压掉,避免与容器悬停叠加成两层
                  className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-2.5 py-2 pr-10 text-left font-normal hover:bg-transparent"
                  onClick={() => onSelect(session.id)}
                >
                  <MessageSquare className={`size-4 shrink-0 ${active ? 'text-primary' : ''}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`truncate text-sm ${active ? 'font-semibold' : 'font-medium'}`}>{session.title}</span>
                      {session.isRunning ? (
                        <span
                          className="size-1.5 shrink-0 animate-pulse rounded-full bg-soy"
                          title="运行中"
                          aria-label="运行中"
                        />
                      ) : null}
                    </span>
                    <span
                      className={`block text-[11px] ${active ? 'text-sidebar-accent-foreground/60' : 'text-muted-foreground'}`}
                    >
                      {DATE_FORMATTER.format(session.updatedAt)}
                    </span>
                  </span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`更多操作：${session.title}`}
                      className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2 opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      {mutating ? (
                        <Spinner className="size-4" />
                      ) : (
                        <Ellipsis className="size-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" aria-label={`${session.title}会话操作`}>
                    <DropdownMenuItem
                      disabled={mutating}
                      onSelect={() => {
                        setPendingRename(session);
                        setRenameTitle(session.title);
                      }}
                    >
                      <Pencil />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={destructiveActionsDisabled}
                      onSelect={() => onArchive(session.id)}
                    >
                      <Archive />
                      归档
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={destructiveActionsDisabled}
                      onSelect={() => setPendingDelete(session)}
                      variant="destructive"
                    >
                      <Trash2 />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
          {error ? (
            /* 侧栏很窄,Alert 收紧内边距;role="alert" 让加载失败被主动播报 */
            <Alert variant="destructive" className="mx-2 my-2 items-start px-2.5 py-2">
              <CircleAlert />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}
        </nav>

        <div className="flex shrink-0 items-center p-2">
          <Button
            className="min-w-0 flex-1 justify-start hover:bg-sidebar-accent"
            variant="ghost"
            onClick={onSettings}
          >
            <Settings />
            设置
          </Button>
          <HubConnectionIndicator status={hubConnectionStatus} onReconnect={onReconnect} />
        </div>
      </aside>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除会话及其全部消息，无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingRename !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRename(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重命名会话</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">修改当前会话标题</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            aria-label="会话标题"
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!renameTitle.trim() || mutatingSessionId !== null}
              onClick={() => {
                if (!pendingRename) return;
                const title = renameTitle.trim();
                void onRename(pendingRename.id, title).then((renamed) => {
                  if (renamed) setPendingRename(null);
                });
              }}
            >
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const HUB_CONNECTION_PRESENTATION: Record<
  HubConnectionStatus,
  { label: string; dotClassName: string }
> = {
  connected: { label: 'Hub 已连接', dotClassName: 'bg-emerald-500 text-emerald-500' },
  connecting: {
    label: 'Hub 正在连接',
    dotClassName: 'bg-amber-400 text-amber-400',
  },
  failed: {
    label: 'Hub 连接失败，点击重连',
    dotClassName: 'bg-destructive text-destructive',
  },
};

/**
 * 显示全局 Hub 连接状态，仅在失败时接受手动重连。
 *
 * @param props - 连接状态与重连回调
 * @returns 连接状态点
 */
function HubConnectionIndicator({
  status,
  onReconnect,
}: {
  status: HubConnectionStatus;
  onReconnect: () => void;
}): React.JSX.Element {
  const presentation = HUB_CONNECTION_PRESENTATION[status];
  const dot = (
    <span
      className={`size-2 animate-pulse rounded-full shadow-[0_0_8px_currentColor] ${presentation.dotClassName}`}
    />
  );

  if (status === 'failed') {
    return (
      <IconTooltip label={presentation.label}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 hover:bg-sidebar-accent"
          aria-label={presentation.label}
          onClick={onReconnect}
        >
          {dot}
        </Button>
      </IconTooltip>
    );
  }

  return (
    <span
      role="status"
      aria-label={presentation.label}
      className="flex size-8 shrink-0 items-center justify-center"
      title={presentation.label}
    >
      {dot}
    </span>
  );
}
