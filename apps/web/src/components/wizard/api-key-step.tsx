import { Check, ChevronLeft, Loader2 } from 'lucide-react';

import type { TestConnectionResult } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ApiKeyStepProps {
  provider: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  testing: boolean;
  testResult: TestConnectionResult | null;
  onTest: () => void;
  onBack: () => void;
  onNext: () => void;
}

/**
 * 展示 API Key 输入和连接测试步骤。
 *
 * @param props - 凭证、测试状态和步骤回调
 * @returns API Key 步骤元素
 */
export function ApiKeyStep(props: ApiKeyStepProps): React.JSX.Element {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="api-key">{props.provider} 的 API Key</Label>
        <Input
          id="api-key"
          type="password"
          placeholder="sk-…"
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
        />
      </div>
      {props.testResult && (
        <p
          className={`flex items-center gap-1.5 text-sm ${props.testResult.ok ? 'text-primary' : 'text-destructive'}`}
        >
          {props.testResult.ok ? <Check className="size-4" /> : null}
          {props.testResult.ok ? '连接成功' : props.testResult.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={props.onBack}>
          <ChevronLeft className="size-4" />
          上一步
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={props.testing || props.apiKey.trim() === ''}
          onClick={props.onTest}
        >
          {props.testing ? <Loader2 className="size-4 animate-spin" /> : null}
          测试连接
        </Button>
        <Button
          className="flex-1"
          disabled={props.testResult === null || !props.testResult.ok || props.testing}
          onClick={props.onNext}
        >
          下一步
        </Button>
      </div>
    </>
  );
}
