import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * 对话页(主页面):消息流、输入框、流式渲染。
 * 当前为占位内容,后续接入 Hub 事件流。
 *
 * @returns 对话页元素
 */
function ChatPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Button>
        <Plus />
        新建
      </Button>
    </main>
  );
}

export default ChatPage;
