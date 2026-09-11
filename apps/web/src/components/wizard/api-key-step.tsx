import { Check, ChevronLeft } from 'lucide-react';

import type { TestConnectionResult } from '@lvdagun/protocol';

import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/** 连接失败信息与 API Key 输入框的绑定 id。 */
const API_KEY_ERROR_ID = 'wizard-api-key-error';

interface ApiKeyStepProps {
  provider: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  testing: boolean;
  testResult: TestConnectionResult | null;
  onTest: () => void;
  saving: boolean;
  onBack: () => void;
  onFinish: () => void;
}

/**
 * 展示 API Key 输入、连接测试和保存步骤。
 *
 * @param props - 凭证、测试状态和步骤回调
 * @returns API Key 步骤元素
 */
export function ApiKeyStep(props: ApiKeyStepProps): React.JSX.Element {
  // 失败信息归属于 API Key 字段:与输入框用 aria-describedby 双向绑定,
  // 读屏念到 Key 输入框时会同时读出来
  const apiKeyError = props.testResult && !props.testResult.ok ? props.testResult.message : null;
  return (
    <>
      <Field data-invalid={apiKeyError !== null}>
        <FieldLabel htmlFor="api-key">{props.provider} 的 API Key</FieldLabel>
        <Input
          id="api-key"
          type="password"
          placeholder="sk-…"
          aria-invalid={apiKeyError !== null}
          aria-describedby={apiKeyError ? API_KEY_ERROR_ID : undefined}
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
        />
        <FieldError id={API_KEY_ERROR_ID}>{apiKeyError}</FieldError>
      </Field>
      {props.testResult?.ok ? (
        <p className="flex items-center gap-1.5 text-sm text-primary">
          <Check className="size-4" />
          连接成功
        </p>
      ) : null}
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
          {props.testing ? <Spinner className="size-4" /> : null}
          测试连接
        </Button>
        <Button
          className="flex-1"
          disabled={props.saving || props.testResult === null || !props.testResult.ok}
          onClick={props.onFinish}
        >
          {props.saving ? <Spinner className="size-4" /> : null}
          完成
        </Button>
      </div>
    </>
  );
}
