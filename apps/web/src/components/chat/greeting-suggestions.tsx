import { SUGGESTIONS } from '@/components/chat/composer-constants';
import { Button } from '@/components/ui/button';

interface GreetingSuggestionsProps {
  /** @param text - 用户点选的建议文案 */
  onPick: (text: string) => void;
}

/**
 * 空对话的问候语与建议胶囊。
 *
 * 对话页与草稿页原本各自复制了一份完全相同的结构;两处必须逐字一致,
 * 抽成一处后只需维护一份文案与样式。
 *
 * 胶囊用 Button 而非 Badge:它是可点击的输入捷径,需要基本的可访问名与焦点环;
 * Badge 是状态标签,尺寸固定且悬停态只对链接生效。
 *
 * @param props - 建议文案的回填回调
 * @returns 问候语与建议胶囊
 */
export function GreetingSuggestions({ onPick }: GreetingSuggestionsProps): React.JSX.Element {
  return (
    <>
      <div className="space-y-3">
        <h3 className="font-display text-4xl font-bold tracking-wide">有什么事，吩咐吧。</h3>
        <p className="text-sm text-muted-foreground">
          驴打滚在本机待命，对话不会离开这台电脑
        </p>
      </div>
      <div className="flex max-w-xl flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto rounded-full bg-card px-4 py-2 font-normal text-muted-foreground hover:border-primary/40 hover:text-foreground"
            onClick={() => onPick(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </>
  );
}
