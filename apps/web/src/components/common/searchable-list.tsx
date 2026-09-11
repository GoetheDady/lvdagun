import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface SearchableListProps {
  placeholder: string;
  items: Array<{ id: string; name: string }> | null;
  selectedId: string;
  loadingText: string;
  emptyText: string;
  onSelect: (id: string) => void;
}

/**
 * 展示带搜索过滤的单选列表。
 *
 * 匹配交给 Command(cmdk):它同时提供模糊过滤、方向键导航与 listbox/option 语义,
 * 手写过滤只能做到第一条,后两条会让读屏软件按列表控件播报却按不到方向键。
 *
 * @param props - 列表内容、选中值和选择回调
 * @returns 搜索列表元素
 */
export function SearchableList(props: SearchableListProps): React.JSX.Element {
  return (
    <Command shouldFilter loop label={props.placeholder}>
      <CommandInput placeholder={props.placeholder} />
      {/* label 要挂在 List 上:cmdk 的 Root label 给输入框命名,列表名用自己的 */}
      <CommandList label={props.placeholder} className="max-h-72">
        {props.items === null ? (
          <CommandEmpty>{props.loadingText}</CommandEmpty>
        ) : (
          <>
            <CommandEmpty>{props.emptyText}</CommandEmpty>
            {props.items.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.name} ${item.id}`}
                // 选中态走 data-checked:CommandItem 用它显示右侧对勾,
                // cmdk 的 aria-selected 表示键盘高亮项,不能当成"已选"
                data-checked={props.selectedId === item.id}
                onSelect={() => props.onSelect(item.id)}
              >
                {/* id 贴着名字,不用 flex-1 推到行尾:候选行宽(与触发器同宽)时
                    名字与 id 会相隔几百像素,眼睛要在两端来回找 */}
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.id}</span>
              </CommandItem>
            ))}
          </>
        )}
      </CommandList>
    </Command>
  );
}
