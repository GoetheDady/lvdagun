import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, RotateCcw, Send, Settings, Trash2 } from 'lucide-react';

import type { ChatMessage } from '@lvdagun/backend';

import { Button } from '@/components/ui/button';
import { api, subscribeEvents } from '@/lib/api';

/** 空状态示例建议(点击填入输入框,PRD 7) */
const SUGGESTIONS = ['今天有什么值得关注的新闻?', '帮我写一个快速排序', '什么是复利?'];

/** 对话错误(重试 = 重发最后一条用户消息) */
interface ChatError {
  message: string;
  retryable: boolean;
}

/**
 * 对话页:消息流、输入框、流式渲染、清空会话(PRD 6.1)。
 *
 * 消息来源两个渠道:挂载时拉历史(会话保持,PRD F3),之后靠 SSE 事件增量更新。
 *
 * @returns 对话页元素
 */
function ChatPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 正在流式输出的 AI 文本(未定稿) */
  const [pending, setPending] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 先拉历史、再订阅事件:若先订阅,历史返回时 setMessages 会覆盖已到达的 SSE 事件
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      try {
        const history = await api.getMessages();
        if (!cancelled) setMessages(history);
      } catch {
        if (!cancelled) setMessages([]);
      }
      if (cancelled) return;
      unsubscribe = subscribeEvents((event) => {
        switch (event.type) {
          case 'user_message':
            setMessages((prev) => [...prev, event.message]);
            break;
          case 'assistant_message_start':
            setStreaming(true);
            setPending('');
            setError(null);
            break;
          case 'assistant_text_delta':
            setPending((prev) => prev + event.delta);
            break;
          case 'assistant_message_end':
            setStreaming(false);
            setPending('');
            setMessages((prev) => [...prev, event.message]);
            break;
          case 'session_cleared':
            setMessages([]);
            break;
          case 'error':
            setError({ message: event.message, retryable: event.retryable });
            break;
        }
      }, (errorEvent) => setError({ message: errorEvent.message, retryable: false }));
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  /**
   * 发送文本:统一处理 pending/错误,供发送与重试共用。
   *
   * @param text - 要发送的文本
   */
  const sendText = async (text: string): Promise<void> => {
    setError(null);
    setSending(true);
    try {
      await api.prompt(text);
    } catch (errorEvent) {
      setError({
        message: errorEvent instanceof Error ? errorEvent.message : String(errorEvent),
        retryable: true,
      });
    } finally {
      setSending(false);
    }
  };

  /**
   * 输入框发送:清空输入后发消息。
   */
  const handleSend = async (): Promise<void> => {
    const text = input.trim();
    if (!text || sending || streaming) return;
    setInput('');
    await sendText(text);
  };

  /**
   * 错误重试:重发最后一条用户消息(PRD 7 错误态)。
   */
  const handleRetry = (): void => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (lastUser) {
      void sendText(lastUser.text);
    }
  };

  /**
   * 清空会话(带确认,PRD 6.1)。
   */
  const handleClear = (): void => {
    if (window.confirm('确定清空当前会话吗?')) {
      void api.clearSession();
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
                  onClick={handleRetry}
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
                void handleSend();
              }
            }}
          />
          <Button
            className="self-end"
            disabled={!input.trim() || sending || streaming}
            onClick={() => {
              void handleSend();
            }}
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
