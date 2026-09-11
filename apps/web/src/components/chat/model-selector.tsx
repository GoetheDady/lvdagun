import { useMemo, useState } from 'react';
import { ChevronsUpDown, Loader2 } from 'lucide-react';

import type { AvailableModel, ModelReference } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/utils/class-names';

interface ModelSelectorProps {
  /** 当前会话模型 */
  value: AvailableModel;
  /** 当前具有有效凭据的全部模型 */
  models: AvailableModel[];
  /** Agent 运行或设置更新时禁止切换 */
  disabled: boolean;
  /** 模型切换请求是否仍在进行 */
  loading: boolean;
  /** 触发器按钮的自定义类名;与默认类名合并,冲突时后者覆盖 */
  className?: string;
  /** 自定义触发器内容;缺省为模型名 + 切换箭头 */
  triggerChildren?: React.ReactNode;
  /** 选择或取消后接回焦点的元素(通常是输入框);缺省时保留浮层默认的焦点归还 */
  restoreFocusTo?: React.RefObject<HTMLElement | null>;
  /** @param model - 用户选择的跨 Provider 模型引用 */
  onSelect(model: ModelReference): void;
}

/**
 * 展示可搜索、按 Provider 分组的会话模型选择器。
 *
 * 匹配交给 Command(cmdk):手写 listbox 只画了 role=option 却没有方向键导航,
 * 读屏软件会按 ARIA 契约提示"用方向键浏览",而方向键是死的,比不声明更糟。
 *
 * @param props - 当前模型、可用模型和切换状态
 * @returns 会话模型选择器
 */
export function ModelSelector(props: ModelSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 只负责按 Provider 分组;名称/id/服务商名的匹配交给 Command 的模糊过滤
  const groups = useMemo(() => {
    const byProvider = new Map<string, { name: string; models: AvailableModel[] }>();
    for (const model of props.models) {
      const group = byProvider.get(model.provider) ?? { name: model.providerName, models: [] };
      group.models.push(model);
      byProvider.set(model.provider, group);
    }
    return [...byProvider.entries()];
  }, [props.models]);

  /** @param nextOpen - 浮层的下一个开关状态 */
  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery('');
  };

  /**
   * 选中模型并收起浮层。
   *
   * @param model - 用户点选的模型
   */
  const handleSelect = (model: AvailableModel): void => {
    props.onSelect({ provider: model.provider, id: model.id });
    props.restoreFocusTo?.current?.focus();
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('min-w-0 max-w-48 gap-1.5 px-2 text-muted-foreground', props.className)}
          disabled={props.disabled}
          aria-label={`模型 ${props.value.name}`}
          title={`${props.value.providerName} / ${props.value.name}`}
        >
          {props.loading ? <Loader2 className="animate-spin" /> : null}
          {props.triggerChildren ?? (
            <>
              <span className="truncate text-foreground">{props.value.name}</span>
              <ChevronsUpDown className="size-3.5" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        // 命令面板自带内边距,这里清掉让输入框与列表铺满浮层
        className="w-80 gap-0 p-0"
        // 焦点必须与关闭同帧回到输入区:浮层一关，focus-within 与“内部浮层打开”两个
        // 展开条件同帧失效，空出一帧输入区就会先闪一下收缩再展开。Radix 的
        // onCloseAutoFocus 晚一帧才执行，因此在选中/取消时当场接回
        onEscapeKeyDown={() => props.restoreFocusTo?.current?.focus()}
        // 有接回目标时不让 Radix 再把焦点还给触发器，晚一帧的默认接管会把光标拉回工具行
        onCloseAutoFocus={(event) => {
          if (props.restoreFocusTo) event.preventDefault();
        }}
      >
        <Command shouldFilter loop label="可用模型">
          <CommandInput
            autoFocus
            placeholder="搜索模型"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList label="可用模型">
            <CommandEmpty>没有匹配的模型</CommandEmpty>
            {groups.map(([provider, group]) => (
              <CommandGroup key={provider} heading={group.name}>
                {group.models.map((model) => (
                  <CommandItem
                    key={`${model.provider}/${model.id}`}
                    value={`${model.name} ${model.id} ${model.providerName}`}
                    data-checked={
                      model.provider === props.value.provider && model.id === props.value.id
                    }
                    onSelect={() => handleSelect(model)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{model.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {model.id}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
