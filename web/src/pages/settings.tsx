import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import type { ModelConfig } from '@lvdagun/backend';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WizardCard } from '@/components/wizard';
import { api } from '@/lib/api';
import { maskKey } from '@/lib/mask';

/**
 * 设置页:当前配置摘要(Key 掩码)+ 修改配置(与向导共享同一套流程,PRD 6.1)。
 *
 * @returns 设置页元素
 */
function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ModelConfig | null>(null);

  useEffect(() => {
    void api
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  return (
    <main className="min-h-screen bg-muted/40 p-6">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">设置</h1>
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft />
            返回对话
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前配置</CardTitle>
            <CardDescription>正在使用的模型服务</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {config ? (
              <>
                <p>Provider:{config.provider}</p>
                <p>Model:{config.modelId}</p>
                <p>API Key:{maskKey(config.apiKey)}</p>
              </>
            ) : (
              <p className="text-muted-foreground">尚未配置</p>
            )}
          </CardContent>
        </Card>

        <WizardCard onDone={() => {}} />

        <p className="text-center text-xs text-muted-foreground">
          驴打滚 V0 · 对话数据只存本机
        </p>
      </div>
    </main>
  );
}

export default SettingsPage;
