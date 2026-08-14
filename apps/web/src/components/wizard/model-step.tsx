import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';

import type { ModelInfo } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { api } from '@/services/api-client';

import { SearchableList } from './searchable-list';

interface ModelStepProps {
  provider: string;
  modelId: string;
  onSelect: (id: string) => void;
  saving: boolean;
  onBack: () => void;
  onFinish: () => void;
}

/**
 * 展示模型选择和保存步骤。
 *
 * @param props - Provider、当前模型和步骤回调
 * @returns 模型选择步骤元素
 */
export function ModelStep(props: ModelStepProps): React.JSX.Element {
  const [models, setModels] = useState<ModelInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listModels(props.provider).then((list) => {
      if (!cancelled) setModels(list);
    });
    return () => {
      cancelled = true;
    };
  }, [props.provider]);

  return (
    <>
      <SearchableList
        placeholder="搜索模型…"
        items={models}
        selectedId={props.modelId}
        loadingText="加载中…"
        emptyText="该服务商没有可用模型"
        onSelect={props.onSelect}
      />
      <div className="flex gap-2">
        <Button variant="outline" onClick={props.onBack}>
          <ChevronLeft className="size-4" />
          上一步
        </Button>
        <Button
          className="flex-1"
          disabled={!props.modelId || props.saving}
          onClick={props.onFinish}
        >
          {props.saving ? <Loader2 className="size-4 animate-spin" /> : null}
          完成
        </Button>
      </div>
    </>
  );
}
