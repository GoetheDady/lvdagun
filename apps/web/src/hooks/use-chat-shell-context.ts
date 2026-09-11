import { useOutletContext } from 'react-router';

import type { ChatShellContext } from '@/components/chat/chat-shell';

/**
 * 从 Outlet 读取会话外壳注入的上下文。
 *
 * @returns 外壳共享的会话列表状态与侧栏唤出回调
 */
export function useChatShellContext(): ChatShellContext {
  return useOutletContext<ChatShellContext>();
}
