import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import type { ModelSettings } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import SessionIndexPage from '@/pages/session-index-page';
import SettingsPage, { AboutPanel } from '@/pages/settings-page';
import ModelServicePage from '@/pages/model-service-page';
import ProviderEditPage from '@/pages/provider-edit-page';
import WizardPage from '@/pages/wizard-page';
import { api } from '@/services/api-client';

/**
 * 应用根组件:路由表 + 首次访问守卫。
 *
 * 挂载时读一次模型服务配置:未配置则进配置向导,已配置才进对话页(PRD 6.2 页面流程)。
 *
 * @returns 路由表元素
 */
function App(): React.JSX.Element {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ConfigGuard>
            <SessionIndexPage />
          </ConfigGuard>
        }
      />
      <Route
        path="/sessions/:sessionId"
        element={
          <ConfigGuard>
            <ChatPage />
          </ConfigGuard>
        }
      />
      <Route path="/wizard" element={<WizardPage />} />
      {/* 设置页不做未配置守卫:删光 Provider 后要能在设置页里重建配置 */}
      <Route path="/settings" element={<SettingsPage />}>
        <Route index element={<Navigate to="model" replace />} />
        <Route path="model" element={<ModelServicePage />} />
        <Route path="model/new" element={<ProviderEditPage />} />
        <Route path="model/:providerId" element={<ProviderEditPage />} />
        <Route path="about" element={<AboutPanel />} />
      </Route>
    </Routes>
  );
}

/**
 * 首次访问守卫:已配置 → 对话页;未配置 → 向导页。
 *
 * 向导保存配置后 navigate('/') 会重新挂载本组件,触发一次新的配置读取。
 */
function ConfigGuard({ children }: { children: React.ReactNode }): React.JSX.Element {
  // undefined = 读取中
  const [settings, setSettings] = useState<ModelSettings | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api
      .getConfig()
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch(() => {
        // 读取失败按未配置处理:进入向导,用户可重试
        if (!cancelled) setSettings({ providers: [], defaultModel: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (settings === undefined) {
    return <main className="min-h-screen bg-muted/40" />;
  }
  return settings.providers.length === 0 ? (
    <Navigate to="/wizard" replace />
  ) : (
    <>{children}</>
  );
}

export default App;
