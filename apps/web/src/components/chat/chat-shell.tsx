import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDefaultLayout } from 'react-resizable-panels';

import { SessionSidebar } from '@/components/chat/session-sidebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useMediaQuery } from '@/hooks/use-media-query';
import { type SessionList, useSessionList } from '@/hooks/use-session-list';
import { useHubConnection } from '@/hooks/use-hub-connection';

/** 会话侧栏布局在浏览器中的稳定标识。 */
const CHAT_LAYOUT_ID = 'chat-workspace-layout';

/** 工作区从外壳获得的共享状态与回调。 */
export interface ChatShellContext {
  /** 外壳订阅的会话列表状态 */
  sessionList: SessionList;
  /** 窄屏下唤出会话抽屉;宽屏不提供,工作区不渲染唤出按钮 */
  onOpenSidebar?: () => void;
}

interface ChatShellProps {
  /** 侧栏中高亮的会话标识;草稿页没有当前会话时省略 */
  activeSessionId?: string;
  /** 渲染右侧工作区;外壳按当前布局注入不同上下文 */
  children: (context: ChatShellContext) => React.ReactNode;
}

/**
 * 会话工作台外壳:侧栏常驻,右侧工作区由调用方注入。
 * 桌面端保持侧栏稳定,窄屏( < 48rem )下侧栏变为抽屉覆盖,默认收起。
 *
 * @param props - 高亮会话与工作区渲染函数
 * @returns 带会话侧栏的工作台外壳
 */
export function ChatShell({ activeSessionId, children }: ChatShellProps): React.JSX.Element {
  const navigate = useNavigate();
  const sessionList = useSessionList();
  const hubConnection = useHubConnection();
  const isWide = useMediaQuery('(min-width: 48rem)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const persistedLayout = useDefaultLayout({
    id: CHAT_LAYOUT_ID,
    panelIds: ['session-sidebar', 'chat-workspace'],
  });

  /**
   * 进入草稿页;会话延迟到首条消息提交时才创建,避免遗留空会话。
   */
  const handleNewSession = (): void => {
    navigate('/sessions/new');
  };

  /**
   * 归档指定会话。
   *
   * @param targetSessionId - 要归档的会话标识
   */
  const handleArchiveSession = (targetSessionId: string): void => {
    void sessionList.archiveSession(targetSessionId);
  };

  /**
   * 永久删除指定会话。
   *
   * @param targetSessionId - 要永久删除的会话标识
   */
  const handleDeleteSession = (targetSessionId: string): void => {
    void sessionList.deleteSession(targetSessionId);
  };

  const sidebarProps = {
    sessions: sessionList.sessions,
    activeSessionId: activeSessionId ?? '',
    loading: sessionList.loading,
    mutatingSessionId: sessionList.mutatingSessionId,
    error: sessionList.error,
    hubConnectionStatus: hubConnection.status,
    onCreate: handleNewSession,
    onSelect: (selectedId: string) => {
      setDrawerOpen(false);
      navigate(`/sessions/${encodeURIComponent(selectedId)}`);
    },
    onArchive: handleArchiveSession,
    onDelete: handleDeleteSession,
    onRename: sessionList.renameSession,
    onReconnect: hubConnection.reconnect,
    onSettings: () => navigate('/settings'),
  };

  // 抽屉打开时允许 Escape 关闭,与背景点击一起构成对话框的基本退出方式。
  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  const context: ChatShellContext = {
    sessionList,
    onOpenSidebar: isWide ? undefined : () => setDrawerOpen(true),
  };

  if (!isWide) {
    return (
      <main className="flex h-dvh min-h-[32rem] overflow-hidden bg-background">
        {children(context)}
        {drawerOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="会话列表"
            className="fixed inset-0 z-50"
          >
            <button
              type="button"
              aria-label="关闭会话列表"
              className="absolute inset-0 cursor-default bg-black/40"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-sidebar shadow-xl">
              <SessionSidebar {...sidebarProps} />
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-[32rem] overflow-hidden bg-background">
      <ResizablePanelGroup id={CHAT_LAYOUT_ID} orientation="horizontal" {...persistedLayout}>
        <ResizablePanel
          id="session-sidebar"
          defaultSize="256px"
          minSize="208px"
          maxSize="384px"
          groupResizeBehavior="preserve-pixel-size"
        >
          <SessionSidebar {...sidebarProps} />
        </ResizablePanel>

        <ResizableHandle
          aria-label="调整侧栏宽度"
          className="bg-transparent transition-colors from-transparent via-wood to-transparent hover:bg-linear-to-b focus-visible:bg-primary focus-visible:ring-primary/30"
        />

        <ResizablePanel id="chat-workspace" className="min-w-0">
          {children(context)}
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
