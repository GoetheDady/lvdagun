import { useEffect, useState } from 'react';
import { Check, ChevronLeft, Loader2, Search } from 'lucide-react';

import type { ModelConfig, ModelInfo, ProviderInfo, TestConnectionResult } from '@lvdagun/backend';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

/** 向导步骤:1 选 Provider,2 填 Key 并测试连接,3 选 Model */
type WizardStep = 1 | 2 | 3;

/** 步骤标题 */
const STEP_TITLES: Record<WizardStep, string> = {
  1: '选择模型服务商',
  2: '填写 API Key',
  3: '选择模型',
};

/**
 * 配置向导卡片(三步流程)。
 *
 * 向导页(首次配置)与设置页(修改配置)共用本组件,PRD 6.1:两处共享同一套配置流程。
 *
 * @param props.onDone - 配置保存成功后的回调(向导页跳对话页,设置页提示完成)
 * @returns 向导卡片元素
 */
export function WizardCard(props: { onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>(1);

  // 各步骤的状态保留在卡片级:回退再前进不丢已填内容
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');

  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

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
        <CardTitle className="flex items-center justify-between">
          驴打滚
          <span className="text-sm font-normal text-muted-foreground">
            {step} / 3 · {STEP_TITLES[step]}
          </span>
        </CardTitle>
        <CardDescription>
          选择服务商、填写 Key 并验证,然后挑一个模型开始对话。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <StepProvider
            provider={provider}
            onSelect={(id) => {
              // 换了服务商:Key、模型、测试结果全部作废——旧服务商的凭证与新服务商无关
              setProvider(id);
              setApiKey('');
              setModelId('');
              setTestResult(null);
            }}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <StepApiKey
            provider={provider}
            apiKey={apiKey}
            onApiKeyChange={(value) => {
              // Key 一旦修改,旧测试结果作废:下一步必须基于"当前 Key 测试通过"
              setApiKey(value);
              setTestResult(null);
            }}
            testing={testing}
            testResult={testResult}
            onTest={() => {
              void handleTest();
            }}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepModel
            provider={provider}
            modelId={modelId}
            onSelect={setModelId}
            saving={saving}
            onBack={() => setStep(2)}
            onFinish={() => {
              void handleFinish();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 可搜索选择列表:搜索框 + 按名称/id 过滤的条目(第一步与第三步共用)。
 *
 * @param props - 列表配置与选中状态
 * @returns 列表元素
 */
function SearchableList(props: {
  placeholder: string;
  items: Array<{ id: string; name: string }> | null;
  selectedId: string;
  loadingText: string;
  emptyText: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
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

/**
 * 第一步:搜索并选择 Provider。
 *
 * @param props - 当前选中值与回调
 * @returns 步骤元素
 */
function StepProvider(props: {
  provider: string;
  onSelect: (id: string) => void;
  onNext: () => void;
}): React.JSX.Element {
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

/**
 * 第二步:填写 API Key 并测试连接,通过后才能继续。
 *
 * @param props - Key 状态、测试状态与导航回调
 * @returns 步骤元素
 */
function StepApiKey(props: {
  provider: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  testing: boolean;
  testResult: TestConnectionResult | null;
  onTest: () => void;
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
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
          className={`flex items-center gap-1.5 text-sm ${props.testResult.ok ? 'text-green-600' : 'text-destructive'}`}
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

/**
 * 第三步:搜索并选择模型,完成保存。
 *
 * @param props - 模型状态、保存状态与回调
 * @returns 步骤元素
 */
function StepModel(props: {
  provider: string;
  modelId: string;
  onSelect: (id: string) => void;
  saving: boolean;
  onBack: () => void;
  onFinish: () => void;
}): React.JSX.Element {
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
