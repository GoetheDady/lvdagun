import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import type {
  ModelInfo,
  ModelSettings,
  ProviderInfo,
  TestConnectionResult,
} from '@lvdagun/protocol';

import { SearchableList } from '@/components/common/searchable-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/services/api-client';
import { maskKey } from '@/utils/mask-api-key';

/**
 * Provider 编辑页:新建与编辑共用;编辑时 Provider 锁定,换 Provider = 删除重建。
 *
 * Key 留空表示沿用现有凭据,输入则覆盖;模型选择仅为测试连接挑选载体,不随条目持久化。
 *
 * @returns Provider 编辑页元素
 */
function ProviderEditPage(): React.JSX.Element {
  const { providerId } = useParams();
  const isEdit = providerId !== undefined;
  const navigate = useNavigate();

  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [provider, setProvider] = useState(providerId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [testModelId, setTestModelId] = useState('');
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.getConfig().then(setSettings);
    void api.listProviders().then(setProviders);
  }, []);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void api.listModels(provider).then((list) => {
      if (cancelled) return;
      setModels(list);
      setTestModelId(list[0]?.id ?? '');
      setTestResult(null);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const existing = settings?.providers.find((entry) => entry.provider === provider);
  const providerName = providers?.find((item) => item.id === provider)?.name ?? provider;
  // 测试与保存都用生效 Key:输入框的新值优先,留空则沿用已存凭据
  const effectiveApiKey = apiKey || existing?.apiKey || '';

  /** 用生效凭据对选定模型发起连接测试 */
  const handleTest = async (): Promise<void> => {
    setTesting(true);
    try {
      setTestResult(await api.testConnection(provider, effectiveApiKey, testModelId));
    } finally {
      setTesting(false);
    }
  };

  /** 以 Provider id 为身份合并条目并整表保存 */
  const handleSave = async (): Promise<void> => {
    if (!settings || !provider) return;
    const next: ModelSettings = {
      providers: [
        ...settings.providers.filter((entry) => entry.provider !== provider),
        { provider, apiKey: effectiveApiKey },
      ],
      defaultModel: settings.defaultModel,
    };
    setSaving(true);
    try {
      await api.saveConfig(next);
      navigate('/settings/model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{isEdit ? `编辑 ${providerName}` : '新建模型服务'}</CardTitle>
        <CardDescription>
          {isEdit ? '该 Provider 已锁定;想更换请删除后重新新建。' : '选择服务商并填写 API Key。'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEdit ? (
          <div className="space-y-2">
            <Label>Provider</Label>
            <p className="rounded-md border px-3 py-2 text-sm">
              {providerName}
              <span className="ml-2 text-xs text-muted-foreground">{provider}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="provider-select">Provider</Label>
            <SearchableList
              placeholder="搜索服务商…"
              items={providers}
              selectedId={provider}
              loadingText="加载中…"
              emptyText="没有匹配的服务商"
              onSelect={setProvider}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="api-key">{provider ? `${providerName} 的 API Key` : 'API Key'}</Label>
          <Input
            id="api-key"
            type="password"
            placeholder={existing ? `${maskKey(existing.apiKey)}(留空沿用)` : 'sk-…(本地模型可留空)'}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setTestResult(null);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>测试模型</Label>
          <SearchableList
            placeholder="搜索模型…"
            items={models}
            selectedId={testModelId}
            loadingText={provider ? '加载中…' : '先选择 Provider'}
            emptyText="没有可用模型"
            onSelect={setTestModelId}
          />
        </div>

        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {testResult.ok ? '连接成功' : testResult.message}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!provider || !testModelId || testing}
            onClick={() => void handleTest()}
          >
            {testing ? '测试中…' : '测试连接'}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => navigate('/settings/model')}>
            <ChevronLeft />
            取消
          </Button>
          <Button disabled={!provider || saving} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ProviderEditPage;
