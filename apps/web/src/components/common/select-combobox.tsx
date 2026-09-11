import { useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/utils/class-names';

import { SearchableList } from './searchable-list';

interface SelectComboboxProps {
  /** 触发器的无障碍名,说明这个控件选的是什么;可见标签不在控件上时靠它 */
  label: string;
  /** 未选中时触发器上的提示文案 */
  placeholder: string;
  /** 浮层内搜索框的占位文案 */
  searchPlaceholder: string;
  /** 候选项;null 表示仍在加载 */
  items: Array<{ id: string; name: string }> | null;
  selectedId: string;
  loadingText: string;
  emptyText: string;
  disabled?: boolean;
  /** HTML id,供 FieldLabel 关联到触发器 */
  id?: string;
  /** 触发器额外类名;与默认类名合并,冲突时后者覆盖 */
  className?: string;
  /** @param id - 用户选中的候选项 id */
  onSelect(id: string): void;
}

/**
 * 单选可搜索下拉。
 *
 * 候选项多时(服务商、模型)常驻列表会把表单撑高,这里收进浮层;展开后仍是同一个
 * SearchableList,模糊过滤、方向键导航与 listbox 语义都跟着走,不必另写一套选择逻辑。
 *
 * @param props - 候选项、当前值与选择回调
 * @returns 单选可搜索下拉元素
 */
export function SelectCombobox(props: SelectComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = props.items?.find((item) => item.id === props.selectedId) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          type="button"
          variant="outline"
          /* 触发器上不写 role=combobox:展开后浮层里的 cmdk 输入框本身就是 combobox,
             两个 combobox 嵌套会让读屏把当前焦点控件的角色念重 */
          aria-label={`${props.label}:${selected?.name ?? props.placeholder}`}
          disabled={props.disabled}
          className={cn('w-full justify-between font-normal', props.className)}
        >
          <span className={cn('min-w-0 truncate', selected === null && 'text-muted-foreground')}>
            {selected?.name ?? props.placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      {/* 浮层与触发器同宽:候选项名长短不一,浮层宽度跟着控件走比固定宽度更像原生下拉 */}
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) gap-0 p-0">
        <SearchableList
          placeholder={props.searchPlaceholder}
          items={props.items}
          selectedId={props.selectedId}
          loadingText={props.loadingText}
          emptyText={props.emptyText}
          onSelect={(id) => {
            props.onSelect(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
