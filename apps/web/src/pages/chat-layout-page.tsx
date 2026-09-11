import { Outlet, useParams } from 'react-router';

import { ChatShell } from '@/components/chat/chat-shell';

/**
 * 会话工作台布局路由:外壳常驻,`/sessions/new` 与 `/sessions/:sessionId`
 * 作为子路由注入右侧工作区。切会话只换子路由,侧栏与会话列表订阅不重挂,
 * 避免每次导航重新拉取会话列表快照。
 *
 * @returns 常驻外壳包裹的子路由出口
 */
function ChatLayoutPage(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <ChatShell activeSessionId={sessionId}>
      {(context) => <Outlet context={context} />}
    </ChatShell>
  );
}

export default ChatLayoutPage;
