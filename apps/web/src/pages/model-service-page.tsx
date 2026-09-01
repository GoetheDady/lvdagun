import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronsUpDown, Pencil, Plus, Server, Trash2 } from 'lucide-react';

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
import { cn } from '@/utils/class-names';
import { maskKey } from '@/utils/mask-api-key';

/**
 * 「默」印章:豆沙红方章,标记默认模型的归属服务。
 * 设计签名:默认模型是铺子的招牌,章盖在招牌与供应它的服务上,两处盖同一枚章,
 * 编码的是真实信息——默认模型出自哪家服务,而非装饰。
 *
 * @param props - 可选尺寸类名(缩小到账本行用)
 * @returns 印章元素
 */
function Seal({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-6 shrink-0 select-none items-center justify-center rounded-[4px] bg-primary font-display text-xs font-bold text-primary-foreground',
        className
      )}
    >
      默
    </span>
  );
}

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
  // 招牌上展示的模型:已加载到元数据用真名,否则回退到 provider/id,最后才是未设置
  const heroValue: AvailableModel =
    selected ?? {
      provider: '',
      providerName: '',
      id: '',
      name: defaultModel ? `${defaultModel.provider}/${defaultModel.id}` : '未设置',
    };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      {/* 页头:宋体标题 + 主操作;未配置时主操作收进空态,避免双入口 */}
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-bold tracking-wide">模型服务</h1>
          <p className="text-sm text-muted-foreground">
            管理提供对话能力的模型服务,并指定新会话的默认模型。
          </p>
        </div>
        {settings && settings.providers.length > 0 ? (
          <Link to="/settings/model/new" className={buttonVariants({ size: 'sm' })}>
            <Plus />
            新建
          </Link>
        ) : null}
      </div>

      {/* 招牌:默认模型;匾额底色取自米黄 secondary,左侧盖「默」章 */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base font-bold tracking-wide">默认模型</CardTitle>
          <CardDescription>新会话的初始模型;会话内可随时切换。</CardDescription>
        </CardHeader>
        <CardContent>
          {settings && settings.providers.length > 0 ? (
            <div className="rounded-md border border-border bg-secondary/60">
              <div className="flex items-center gap-3 p-4">
                <Seal />
                <div className="min-w-0 flex-1">
                  <ModelSelector
                    className="h-auto max-w-full justify-start gap-2 px-0 py-0"
                    value={heroValue}
                    models={models}
                    disabled={saving}
                    loading={saving}
                    onSelect={(model) => void handleDefaultModel(model)}
                    triggerChildren={
                      <>
                        <span className="min-w-0 truncate font-display text-xl font-bold tracking-wide text-foreground">
                          {heroValue.name}
                        </span>
                        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                      </>
                    }
                  />
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {selected ? `${selected.providerName} · ${selected.id}` : '尚未选择模型'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">先在下方添加模型服务,再选择默认模型。</p>
          )}
        </CardContent>
      </Card>

      {/* 账本:已配置的服务;发丝线分条,供应默认模型的服务盖同一枚「默」章 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="font-display text-base font-bold tracking-wide">模型服务</CardTitle>
            <CardDescription>配置好凭据的服务商,其名下模型全部可用。</CardDescription>
          </div>
          {settings && settings.providers.length > 0 ? (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {settings.providers.length} 个服务
            </span>
          ) : null}
        </CardHeader>
        <CardContent>
          {settings === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : settings.providers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Server className="size-5" />
              </span>
              <p className="text-sm font-medium">尚未配置任何模型服务</p>
              <p className="text-xs text-muted-foreground">
                添加一个服务商并填入 API Key,它的模型即可用于对话。
              </p>
              <Link
                to="/settings/model/new"
                className={buttonVariants({ size: 'sm', className: 'mt-2' })}
              >
                <Plus />
                新建模型服务
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {settings.providers.map((entry) => (
                <li key={entry.provider} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{providerName(entry.provider)}</p>
                      {entry.provider === defaultModel?.provider ? (
                        <Seal className="size-5 text-[10px]" />
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {`API Key:${maskKey(entry.apiKey)}`}
                    </p>
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
                </li>
              ))}
            </ul>
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
