import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import type {
  ModelInfo,
  ModelSettings,
  ProviderInfo,
  TestConnectionResult,
} from '@lvdagun/protocol';

import { SelectCombobox } from '@/components/common/select-combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api-client';
import { maskKey } from '@/utils/mask-api-key';

/** 连接失败信息与 API Key 输入框的绑定 id。 */
const API_KEY_ERROR_ID = 'api-key-error';

/**
 * Provider 编辑页:新建与编辑共用;编辑时 Provider 锁定,换 Provider = 删除重建。
 *
 * Key 留空表示沿用现有凭据,输入则覆盖;模型选择仅为测试连接挑选载体,不随条目持久化。
 * 设计:这是铺子的「登记单」,测试通过后盖「验讫」章,与列表页的「默」章同属一套印章标记。
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
  // 失败信息归属于 API Key 字段:它与输入框用 aria-describedby 双向绑定,
  // 读屏念到 Key 输入框时会同时读出来,而不是只靠视觉扫到下方红字
  const apiKeyError = testResult && !testResult.ok ? testResult.message : null;

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
    <div className="mx-auto w-full max-w-2xl space-y-6">
      {/* 页头:登记单标题,与列表页同构 */}
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-bold tracking-wide">
          {isEdit ? `编辑 ${providerName}` : '添加服务商'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? '该服务商已锁定;想更换请删除后重新添加。'
            : '选择服务商、填入 API Key,登记后它名下的模型全部可用。'}
        </p>
      </div>

      <Card>
        <CardContent className="gap-5">
          {isEdit ? (
            <Field>
              <FieldLabel>服务商</FieldLabel>
              {/* 编辑态:服务商锁定,米黄底只读展示,与可编辑字段区分 */}
              <div className="flex items-baseline gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <p className="text-sm font-medium">{providerName}</p>
                <span className="font-mono text-xs text-muted-foreground">{provider}</span>
              </div>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="provider-select">服务商</FieldLabel>
              <SelectCombobox
                id="provider-select"
                label="服务商"
                placeholder="选择服务商"
                searchPlaceholder="搜索服务商…"
                items={providers}
                selectedId={provider}
                loadingText="加载中…"
                emptyText="没有匹配的服务商"
                onSelect={setProvider}
              />
            </Field>
          )}

          <Field data-invalid={apiKeyError !== null}>
            <FieldLabel htmlFor="api-key">
              {provider ? `${providerName} 的 API Key` : 'API Key'}
            </FieldLabel>
            <Input
              id="api-key"
              type="password"
              className="font-mono"
              aria-invalid={apiKeyError !== null}
              aria-describedby={apiKeyError ? API_KEY_ERROR_ID : undefined}
              placeholder={existing ? `${maskKey(existing.apiKey)}(留空沿用)` : 'sk-…(本地模型可留空)'}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setTestResult(null);
              }}
            />
            <FieldError id={API_KEY_ERROR_ID}>{apiKeyError}</FieldError>
          </Field>

          {/* 验证分区:所选模型只是本次验证的载体、不随凭据保存,所以与上面的凭据字段分开陈列;
              米黄匾额材质与列表页的招牌同源,「验讫」章盖在它自己所属的分区上 */}
          <div className="rounded-md border border-border bg-secondary/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-sm font-bold tracking-wide">验证</p>
              {testResult?.ok ? (
                <div className="flex shrink-0 items-center gap-1.5 text-xs text-primary">
                  {/* 章与旁边的文字说的是同一件事,读屏只念一次即可 */}
                  <span
                    aria-hidden="true"
                    className="rounded-[4px] bg-primary px-1.5 py-0.5 font-display text-xs font-bold text-primary-foreground"
                  >
                    验讫
                  </span>
                  连接成功
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              所选模型只用于本次验证,不随凭据保存。
            </p>
            <div className="mt-3 flex items-center gap-2">
              <SelectCombobox
                className="flex-1"
                label="测试模型"
                placeholder="选择测试模型"
                searchPlaceholder="搜索模型…"
                items={models}
                selectedId={testModelId}
                disabled={!provider}
                loadingText={provider ? '加载中…' : '先选择服务商'}
                emptyText="没有可用模型"
                onSelect={setTestModelId}
              />
              <Button
                variant="outline"
                disabled={!provider || !testModelId || testing}
                onClick={() => void handleTest()}
              >
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
          </div>
        </CardContent>

        {/* 页脚只留导航与提交:测试连接属于验证,不混进这里 */}
        <CardFooter className="border-t">
          <Button variant="ghost" onClick={() => navigate('/settings/model')}>
            <ChevronLeft />
            取消
          </Button>
          <div className="flex-1" />
          <Button disabled={!provider || saving} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default ProviderEditPage;
