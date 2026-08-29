import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import type { AvailableModel, ModelReference, ModelSettings, ProviderInfo } from '@lvdagun/protocol';

import { ModelSelector } from '@/components/chat/model-selector';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api-client';
import { maskKey } from '@/utils/mask-api-key';

/**
 * 模型服务分区:默认模型选择 + 已配置 Provider 列表(编辑/删除/新建)。
 *
 * @returns 模型服务分区元素
 */
function ModelServicePage(): React.JSX.Element {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  // 待删除的 Provider id;null 表示无待确认删除
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.getConfig().then(setSettings);
    void api.listProviders().then(setProviders);
  }, []);

  // 已配置 Provider 的全部模型 = 默认模型的候选集;凭据列表变化时重新拉取
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    void Promise.all(
      settings.providers.map(async (entry) => {
        const providerName =
          providers.find((item) => item.id === entry.provider)?.name ?? entry.provider;
        const list = await api.listModels(entry.provider);
        return list.map(
          (model): AvailableModel => ({
            provider: entry.provider,
            providerName,
            id: model.id,
            name: model.name,
          })
        );
      })
    ).then((groups) => {
      if (!cancelled) setModels(groups.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [settings, providers]);

  /** @param model - 用户选定的默认模型 */
  const handleDefaultModel = async (model: ModelReference): Promise<void> => {
    if (!settings) return;
    const next: ModelSettings = { ...settings, defaultModel: { provider: model.provider, id: model.id } };
    setSaving(true);
    try {
      await api.saveConfig(next);
      setSettings(next);
    } finally {
      setSaving(false);
    }
  };

  /** 确认删除待删除的 Provider 凭据;默认模型随其 Provider 一起失效,交给运行时回退 */
  const handleDelete = async (): Promise<void> => {
    if (!settings || !pendingDelete) return;
    const next: ModelSettings = {
      providers: settings.providers.filter((entry) => entry.provider !== pendingDelete),
      defaultModel:
        settings.defaultModel?.provider === pendingDelete ? null : settings.defaultModel,
    };
    setSaving(true);
    try {
      await api.saveConfig(next);
      setSettings(next);
    } finally {
      setSaving(false);
      setPendingDelete(null);
    }
  };

  const providerName = (id: string): string =>
    providers.find((item) => item.id === id)?.name ?? id;
  const defaultModel = settings?.defaultModel;
  const selected =
    models.find(
      (model) =>
        model.provider === defaultModel?.provider && model.id === defaultModel?.id
    ) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">默认模型</CardTitle>
          <CardDescription>新会话的初始模型;会话内可随时切换。</CardDescription>
        </CardHeader>
        <CardContent>
          {settings && settings.providers.length > 0 ? (
            <ModelSelector
              value={
                selected ?? {
                  provider: '',
                  providerName: '',
                  id: '',
                  name: defaultModel ? `${defaultModel.provider}/${defaultModel.id}` : '未设置',
                }
              }
              models={models}
              disabled={saving}
              loading={saving}
              onSelect={(model) => void handleDefaultModel(model)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">先在下方添加模型服务,再选择默认模型。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">模型服务</CardTitle>
            <CardDescription>配置好凭据的 Provider,其名下模型全部可用。</CardDescription>
          </div>
          <Link to="/settings/model/new" className={buttonVariants({ size: 'sm' })}>
            <Plus />
            新建
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {settings === null ? (
            <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
          ) : settings.providers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">尚未配置任何模型服务</p>
          ) : (
            settings.providers.map((entry) => (
              <div
                key={entry.provider}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{providerName(entry.provider)}</p>
                  <p className="text-xs text-muted-foreground">API Key:{maskKey(entry.apiKey)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    to={`/settings/model/${entry.provider}`}
                    className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                    aria-label={`编辑 ${entry.provider}`}
                  >
                    <Pencil />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`删除 ${entry.provider}`}
                    onClick={() => setPendingDelete(entry.provider)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {pendingDelete ? providerName(pendingDelete) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该 Provider 名下的模型将不可用,使用这些模型的会话会回退到其他可用模型。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ModelServicePage;
