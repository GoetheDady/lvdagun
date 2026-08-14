import { useState } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

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
 * @param props - 列表内容、选中值和选择回调
 * @returns 搜索列表元素
 */
export function SearchableList(props: SearchableListProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const filtered = props.items?.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.id.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={props.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {props.items === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{props.loadingText}</p>
        ) : filtered && filtered.length > 0 ? (
          filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => props.onSelect(item.id)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                props.selectedId === item.id
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <span>{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.id}</span>
            </button>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">{props.emptyText}</p>
        )}
      </div>
    </>
  );
}
