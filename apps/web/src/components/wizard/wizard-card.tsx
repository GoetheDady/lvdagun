import { useState } from 'react';

import type { ModelConfig, TestConnectionResult } from '@lvdagun/protocol';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api-client';

import { ApiKeyStep } from './api-key-step';
import { ModelStep } from './model-step';
import { ProviderStep } from './provider-step';

type WizardStep = 1 | 2 | 3;

const STEP_TITLES: Record<WizardStep, string> = {
  1: '选择模型服务商',
  2: '填写 API Key',
  3: '选择模型',
};

/**
 * 展示可复用的三步模型配置向导。
 *
 * @param props.onDone - 配置保存成功后的回调
 * @returns 配置向导卡片元素
 */
export function WizardCard(props: { onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>(1);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 保存完整模型配置并结束向导 */
  const handleFinish = async (): Promise<void> => {
    if (!provider || !modelId) return;
    const config: ModelConfig = { provider, apiKey, modelId };
    setSaving(true);
    try {
      await api.saveConfig(config);
      props.onDone();
    } finally {
      setSaving(false);
    }
  };

  /** 测试当前 Provider 与 API Key */
  const handleTest = async (): Promise<void> => {
    setTesting(true);
    try {
      setTestResult(await api.testConnection(provider, apiKey));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <img
              alt=""
              className="size-7 shrink-0 rounded-md"
              height="28"
              src="/brand/logo-512.png"
              width="28"
            />
            <span className="truncate">驴打滚</span>
          </span>
          <span className="shrink-0 text-sm font-normal text-muted-foreground">
            {step} / 3 · {STEP_TITLES[step]}
          </span>
        </CardTitle>
        <CardDescription>选择服务商、填写 Key 并验证,然后挑一个模型开始对话。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <ProviderStep
            provider={provider}
            onSelect={(id) => {
              setProvider(id);
              setApiKey('');
              setModelId('');
              setTestResult(null);
            }}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <ApiKeyStep
            provider={provider}
            apiKey={apiKey}
            onApiKeyChange={(value) => {
              setApiKey(value);
              setTestResult(null);
            }}
            testing={testing}
            testResult={testResult}
            onTest={() => void handleTest()}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <ModelStep
            provider={provider}
            modelId={modelId}
            onSelect={setModelId}
            saving={saving}
            onBack={() => setStep(2)}
            onFinish={() => void handleFinish()}
          />
        )}
      </CardContent>
    </Card>
  );
}
