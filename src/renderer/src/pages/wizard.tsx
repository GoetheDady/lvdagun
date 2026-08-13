import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronLeft, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listModels, listProviders, saveConfig, testConnection } from '@/lib/ipc';
import type {
  ModelConfig,
  ModelInfo,
  ProviderInfo,
  TestConnectionResult,
} from '../../../shared/ipc';

/** 向导步骤:1 选 Provider,2 填 Key 并测试连接,3 选 Model */
type WizardStep = 1 | 2 | 3;

/** 步骤标题 */
const STEP_TITLES: Record<WizardStep, string> = {
  1: '选择模型服务商',
  2: '填写 API Key',
  3: '选择模型',
};

/**
 * 配置向导页(仅首次启动出现):三步流程,完成后保存配置并进入对话页。
 *
 * @returns 向导页元素
 */
function WizardPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(1);

  // 各步骤的状态保留在页面级:回退再前进不丢已填内容
  const [provider, setProvider] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');

  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * 测试通过 → 保存配置 → 进入对话页。
   */
  const handleFinish = async (): Promise<void> => {
    if (!provider || !modelId) return;
    const config: ModelConfig = { provider, apiKey, modelId };
    setSaving(true);
    try {
      await saveConfig(config);
      void navigate('/', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  /**
   * 发起测试连接,结果写进 testResult。
   */
  const handleTest = async (): Promise<void> => {
    setTesting(true);
    try {
      setTestResult(await testConnection({ provider, apiKey }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            驴打滚
            <span className="text-sm font-normal text-muted-foreground">
              {step} / 3 · {STEP_TITLES[step]}
            </span>
          </CardTitle>
          <CardDescription>
            首次配置:选择服务商、填写 Key 并验证,然后挑一个模型开始对话。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <StepProvider
              provider={provider}
              onSelect={(id) => setProvider(id)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepApiKey
              provider={provider}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
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
    </main>
  );
}

/**
 * 第一步:搜索并选择 Provider。
 */
function StepProvider(props: {
  provider: string;
  onSelect: (id: string) => void;
  onNext: () => void;
}): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    // 加载失败时保持 null 并展示错误,给重试入口(按钮重新触发 effect)
    let cancelled = false;
    void listProviders().then((list) => {
      if (!cancelled) setProviders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = providers?.filter(
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
          placeholder="搜索服务商…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {providers === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : filtered && filtered.length > 0 ? (
          filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => props.onSelect(item.id)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                props.provider === item.id
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <span>{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.id}</span>
            </button>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的服务商</p>
        )}
      </div>
      <Button className="w-full" disabled={!props.provider} onClick={props.onNext}>
        下一步
      </Button>
    </>
  );
}

/**
 * 第二步:填写 API Key 并测试连接,通过后才能继续。
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
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listModels(props.provider).then((list) => {
      if (!cancelled) setModels(list);
    });
    return () => {
      cancelled = true;
    };
  }, [props.provider]);

  const filtered = models?.filter(
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
          placeholder="搜索模型…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {models === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : filtered && filtered.length > 0 ? (
          filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => props.onSelect(item.id)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                props.modelId === item.id
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <span>{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.id}</span>
            </button>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">该服务商没有可用模型</p>
        )}
      </div>
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

export default WizardPage;
