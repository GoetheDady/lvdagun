import { CornerDownRight, RotateCcw, Trash2 } from 'lucide-react';

import type { PendingMessage } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * 渲染输入框上方的待处理消息列表。
 *
 * @param props - 权威消息快照及逐条操作
 * @returns Codex 风格的紧凑待处理区
 */
export function PendingMessages({
  messages,
  disabled,
  steerDisabled,
  onSteer,
  onRemove,
  onTakeAll,
  onDiscardAll,
}: {
  messages: PendingMessage[];
  disabled: boolean;
  steerDisabled: boolean;
  onSteer: (messageId: string) => void;
  onRemove: (messageId: string) => void;
  onTakeAll: () => void;
  onDiscardAll: () => void;
}): React.JSX.Element | null {
  if (messages.length === 0) return null;

  return (
    <div aria-label="待处理消息" className="border-b border-input px-3 py-2">
      <div className="mb-1 flex min-h-8 items-center gap-1">
        <span className="mr-auto text-xs text-muted-foreground">待处理消息 {messages.length}</span>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onTakeAll}>
          <RotateCcw />
          全部取回
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost" size="sm" disabled={disabled}>
              <Trash2 />
              清空
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清空待处理消息？</AlertDialogTitle>
              <AlertDialogDescription>
                这会丢弃当前会话中全部尚未移交给 Agent 的消息。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={onDiscardAll}>清空</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="max-h-40 overflow-y-auto">
        {messages.map((message) => (
          <div key={message.id} className="flex min-h-9 items-center gap-2">
            <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={message.text}>
              {message.text}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || steerDisabled}
              onClick={() => onSteer(message.id)}
            >
              <CornerDownRight />
              调整方向
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              title="删除待处理消息"
              aria-label={`删除待处理消息：${message.text}`}
              disabled={disabled}
              onClick={() => onRemove(message.id)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
