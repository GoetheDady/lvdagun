import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, RotateCcw, Send, Settings, Trash2 } from 'lucide-react';

import type { ChatMessage } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { useChatSession } from '@/hooks/use-chat-session';

/** 空状态示例建议(点击填入输入框,PRD 7) */
const SUGGESTIONS = ['今天有什么值得关注的新闻?', '帮我写一个快速排序', '什么是复利?'];

/**
 * 对话页:消息流、输入框、流式渲染、清空会话(PRD 6.1)。
 *
 * 薄适配器:会话语义全部在 useChatSession 里,这里只做渲染与 UI 交互
 * (输入状态、滚动、确认弹窗)。
 *
 * @returns 对话页元素
 */
function ChatPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { messages, pending, streaming, error, sending, send, retry, clear } = useChatSession();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  /**
   * 输入框发送:清空输入后交给会话模块。
   */
  const handleSend = (): void => {
    const text = input.trim();
    if (!text || sending || streaming) return;
    setInput('');
    void send(text);
  };

  /**
   * 清空会话(带确认,PRD 6.1;确认弹窗是 UI 职责,留在页面)。
   */
  const handleClear = (): void => {
    if (window.confirm('确定清空当前会话吗?')) {
      clear();
    }
  };

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-semibold">驴打滚</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <Trash2 />
            清空会话
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
            <Settings />
            设置
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !streaming && (
          <div className="space-y-3 pt-16 text-center">
            <p className="text-sm text-muted-foreground">
              你好,我是你的 AI 管家。说点什么开始对话吧。
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setInput(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[75%] rounded-lg border bg-muted px-3 py-2 text-sm">
              <MessageText text={pending} />
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" />
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-start">
            <div className="flex max-w-[75%] flex-col gap-2 rounded-lg border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
              {error.retryable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start border-destructive text-destructive hover:bg-destructive/10"
                  onClick={retry}
                >
                  <RotateCcw />
                  重试
                </Button>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t p-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          <textarea
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="输入消息…(Enter 发送,Shift+Enter 换行)"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            className="self-end"
            disabled={!input.trim() || sending || streaming}
            onClick={handleSend}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            发送
          </Button>
        </div>
      </footer>
    </main>
  );
}

/**
 * 单条消息气泡:用户右对齐主色,AI 左对齐浅色(PRD 7)。
 *
 * @param props.message - 消息
 * @returns 气泡元素
 */
function MessageBubble(props: { message: ChatMessage }): React.JSX.Element {
  const { message } = props;
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-primary text-primary-foreground' : 'border bg-muted'
        }`}
      >
        <MessageText text={message.text} />
      </div>
    </div>
  );
}

/**
 * 消息文本渲染:``` 包裹的代码块转深色等宽块,其余保持换行(PRD 7 界面要点)。
 *
 * @param props.text - 原始文本
 * @returns 渲染片段
 */
function MessageText(props: { text: string }): React.JSX.Element {
  const parts = props.text.split('```');
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <pre
            key={index}
            className="my-1 overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-100"
          >
            {part}
          </pre>
        ) : (
          <span key={index} className="whitespace-pre-wrap">
            {part}
          </span>
        )
      )}
    </>
  );
}

export default ChatPage;
