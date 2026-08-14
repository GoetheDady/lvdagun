import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import type { ModelConfig } from '@lvdagun/protocol';

import ChatPage from '@/pages/chat-page';
import SettingsPage from '@/pages/settings-page';
import WizardPage from '@/pages/wizard-page';
import { api } from '@/services/api-client';

/**
 * 应用根组件:路由表 + 首次访问守卫。
 *
 * 挂载时读一次模型配置:未配置则进配置向导,已配置才进对话页(PRD 6.2 页面流程)。
 *
 * @returns 路由表元素
 */
function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<ConfigGuard />} />
      <Route path="/wizard" element={<WizardPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

/**
 * 首次访问守卫:已配置 → 对话页;未配置 → 向导页。
 *
 * 向导保存配置后 navigate('/') 会重新挂载本组件,触发一次新的配置读取。
 */
function ConfigGuard(): React.JSX.Element {
  // undefined = 读取中,null = 未配置
  const [config, setConfig] = useState<ModelConfig | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api
      .getConfig()
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch(() => {
        // 读取失败按未配置处理:进入向导,用户可重试
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (config === undefined) {
    return <main className="min-h-screen bg-muted/40" />;
  }
  return config === null ? <Navigate to="/wizard" replace /> : <ChatPage />;
}

export default App;
