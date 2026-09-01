import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Menu, Send } from 'lucide-react';

import type { AvailableModel } from '@lvdagun/protocol';

import { ChatShell } from '@/components/chat/chat-shell';
import { ModelSelector } from '@/components/chat/model-selector';
import { Button } from '@/components/ui/button';
import {
  COMPOSER_BUTTON_CLASS,
  COMPOSER_GROUP_CLASS,
  COMPOSER_TEXTAREA_CLASS,
  COMPOSER_TOOL_ROW_CLASS,
  SUGGESTIONS,
} from '@/components/chat/composer-constants';
import { api } from '@/services/api-client';

/**
 * 渲染草稿工作区：输入首条提示，提交时才创建持久化会话。
 *
 * 初始输入框随问候语居中，提交后滑落停靠到底部，问候语淡出让位；
 * 草稿不进入会话列表，也不产生任何空会话。首条提示发出且停靠动画
 * 播完后才跳转到真实会话 URL，消息由聊天页在消息流中渲染。
 *
 * @param props - 窄屏下唤出会话抽屉的回调
 * @returns 草稿工作区
 */
function DraftWorkspace({ onOpenSidebar }: { onOpenSidebar?: () => void }): React.JSX.Element {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createdSessionId = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

  // 初始可选模型：默认模型优先，未配置或已不可用时回落到第一个可用模型。
  // 加载失败不阻塞输入；创建时会按缺省模型走，服务端再兜底。
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.listAvailableModels(), api.getConfig()])
      .then(([models, config]) => {
        if (cancelled) return;
        setAvailableModels(models);
        const defaultRef = config.defaultModel;
        const initial =
          (defaultRef
            ? models.find(
                (candidate) =>
                  candidate.provider === defaultRef.provider && candidate.id === defaultRef.id
              )
            : undefined) ?? models[0];
        setSelectedModel(initial ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 创建会话、发出首条提示，等停靠动画播完后跳转；失败时回滚并还原输入供重试。
   *
   * 先发 prompt 再导航：聊天页首帧快照就带用户消息和运行状态，无空白闪烁。
   * 创建成功但 prompt 失败时记住会话 id，重试只补发提示，不产生第二个会话。
   * 成功时不复位 creating：导航过渡期间草稿页会被重渲染一次，提前复位会让
   * Loader 闪回 Send；失败路径才需要复位供重试。
   * 停靠动画从提交开始计时（350ms ≥ duration-300），与 prompt 并行等待，
   * 二者都完成后才换页，避免动画被路由卸载硬切。
   */
  const handleSend = (): void => {
    const text = input.trim();
    if (!text || creating) return;
    setCreating(true);
    setError(null);
    setSubmitted(text);
    setInput('');
    const dockSettled = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 350);
    });
    const ensureSession = createdSessionId.current
      ? Promise.resolve({ sessionId: createdSessionId.current })
      : api.createSession(
          selectedModel
            ? { model: { provider: selectedModel.provider, id: selectedModel.id } }
            : undefined
        );
    void ensureSession
      .then(({ sessionId }) => {
        createdSessionId.current = sessionId;
        return Promise.all([api.prompt(sessionId, text), dockSettled]).then(() => {
          navigate(`/sessions/${encodeURIComponent(sessionId)}`, { replace: true });
        });
      })
      .catch((createError: unknown) => {
        setCreating(false);
        setError(createError instanceof Error ? createError.message : String(createError));
        setSubmitted(null);
        setInput(text);
        textareaRef.current?.focus();
      });
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <header className="relative flex h-12 shrink-0 items-center px-5">
        {onOpenSidebar ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="打开会话列表"
            className="absolute left-2"
            onClick={onOpenSidebar}
          >
            <Menu />
          </Button>
        ) : null}
        <div className="mx-auto w-full max-w-3xl min-w-0">
          <h2 className="truncate text-sm font-semibold">新对话</h2>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 动画载体：问候语与输入区同容器整体居中，聚焦展开时容器重排、
            问候语被顶上去保持间距；提交后输入区保持展开形态、容器高度恒定，
            居中→贴底是纯 top+translate 位移，跳转等动画播完才发生 */}
        <div
          className={`absolute inset-x-0 px-5 pb-3 transition-[top,translate] duration-300 ease-out motion-reduce:transition-none ${
            submitted === null ? 'top-1/2 -translate-y-1/2' : 'top-full -translate-y-full'
          }`}
        >
          {/* 问候与示例：提交后淡出让位（占位保留，停靠期间容器高度不受影响） */}
          <div
            aria-hidden={submitted !== null}
            className={`mx-auto flex max-w-3xl flex-col items-center gap-7 pb-10 text-center transition-opacity duration-300 motion-reduce:transition-none ${
              submitted === null ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <div className="space-y-3">
              <h3 className="font-display text-4xl font-bold tracking-wide">有什么事，吩咐吧。</h3>
              <p className="text-sm text-muted-foreground">
                驴打滚在本机待命，对话不会离开这台电脑
              </p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-border bg-card px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  onClick={() => setInput(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className="mx-auto mb-2 flex max-w-xl items-center gap-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          ) : null}

          <div role="group" aria-label="消息输入区" className={COMPOSER_GROUP_CLASS}>
            <textarea
              ref={textareaRef}
              className={COMPOSER_TEXTAREA_CLASS}
              placeholder="输入消息"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // 旧版 Safari 会提前结束组合态，但仍用 229 标识输入法按键。
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className={COMPOSER_TOOL_ROW_CLASS}>
              {selectedModel ? (
                <ModelSelector
                  value={selectedModel}
                  models={availableModels}
                  disabled={creating}
                  loading={false}
                  onSelect={(model) =>
                    setSelectedModel(
                      availableModels.find(
                        (candidate) =>
                          candidate.provider === model.provider && candidate.id === model.id
                      ) ?? selectedModel
                    )
                  }
                />
              ) : null}
            </div>
            <Button
              size="icon"
              className={COMPOSER_BUTTON_CLASS}
              disabled={!input.trim() || creating}
              title="发送"
              aria-label="发送"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleSend}
            >
              {creating ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 新对话草稿页：进入时不创建任何会话，提交首条消息后才落盘。
 *
 * @returns 草稿页
 */
function NewSessionPage(): React.JSX.Element {
  return (
    <ChatShell>{({ onOpenSidebar }) => <DraftWorkspace onOpenSidebar={onOpenSidebar} />}</ChatShell>
  );
}

export default NewSessionPage;
