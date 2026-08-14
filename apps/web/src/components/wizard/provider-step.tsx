import { useEffect, useState } from 'react';

import type { ProviderInfo } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { api } from '@/services/api-client';

import { SearchableList } from './searchable-list';

interface ProviderStepProps {
  provider: string;
  onSelect: (id: string) => void;
  onNext: () => void;
}

/**
 * 展示配置向导的 Provider 选择步骤。
 *
 * @param props - 当前选择和步骤回调
 * @returns Provider 选择步骤元素
 */
export function ProviderStep(props: ProviderStepProps): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listProviders().then((list) => {
      if (!cancelled) setProviders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SearchableList
        placeholder="搜索服务商…"
        items={providers}
        selectedId={props.provider}
        loadingText="加载中…"
        emptyText="没有匹配的服务商"
        onSelect={props.onSelect}
      />
      <Button className="w-full" disabled={!props.provider} onClick={props.onNext}>
        下一步
      </Button>
    </>
  );
}
