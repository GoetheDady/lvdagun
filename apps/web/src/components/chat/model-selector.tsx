import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';

import type { AvailableModel, ModelReference } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  /** @param model - 用户选择的跨 Provider 模型引用 */
  onSelect(model: ModelReference): void;
}

/**
 * 展示可搜索、按 Provider 分组的会话模型选择器。
 *
 * @param props - 当前模型、可用模型和切换状态
 * @returns 会话模型选择器
 */
export function ModelSelector(props: ModelSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? props.models.filter(
          (model) =>
            model.name.toLowerCase().includes(normalized) ||
            model.id.toLowerCase().includes(normalized) ||
            model.providerName.toLowerCase().includes(normalized)
        )
      : props.models;
    const byProvider = new Map<string, { name: string; models: AvailableModel[] }>();
    for (const model of filtered) {
      const group = byProvider.get(model.provider) ?? {
        name: model.providerName,
        models: [],
      };
      group.models.push(model);
      byProvider.set(model.provider, group);
    }
    return [...byProvider.entries()];
  }, [props.models, query]);

  /** @param nextOpen - 浮层的下一个开关状态 */
  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery('');
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <div className="relative border-b border-border p-2">
            <Search className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              placeholder="搜索模型"
              className="border-0 bg-muted/60 pl-8 focus-visible:ring-1"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div role="listbox" aria-label="可用模型" className="max-h-72 overflow-y-auto p-1.5">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配的模型</p>
            ) : (
              groups.map(([provider, group]) => (
                <div key={provider} role="group" aria-label={group.name}>
                  <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                    {group.name}
                  </p>
                  {group.models.map((model) => {
                    const selected =
                      model.provider === props.value.provider && model.id === props.value.id;
                    return (
                      <button
                        key={`${model.provider}/${model.id}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        onClick={() => {
                          props.onSelect({ provider: model.provider, id: model.id });
                          handleOpenChange(false);
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-foreground">{model.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {model.id}
                          </span>
                        </span>
                        {selected ? <Check className="size-4 text-primary" /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
