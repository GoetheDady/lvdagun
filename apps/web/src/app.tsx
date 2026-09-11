import { ViewTransition, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import type { ModelSettings } from '@lvdagun/protocol';

import ChatLayoutPage from '@/pages/chat-layout-page';
import ChatPage from '@/pages/chat-page';
import NewSessionPage from '@/pages/new-session-page';
import SessionIndexPage from '@/pages/session-index-page';
import SettingsPage, { AboutPanel } from '@/pages/settings-page';
import ModelServicePage from '@/pages/model-service-page';
import ProviderEditPage from '@/pages/provider-edit-page';
import WizardPage from '@/pages/wizard-page';
import { api } from '@/services/api-client';

/**
 * 路由过渡:只在路由元素挂载/卸载时动画,不做 update 动画——页面内部的状态变化
 * (流式回复、列表刷新)不该让整页闪一下(`default="none"` 把其他触发类型全关掉)。
 *
 * 位置有讲究:React 只在 `<ViewTransition>` 位于被插入/删除子树的顶层时才触发
 * enter/exit,中间隔一层 DOM 就静默不生效;壳层留在这层,内容区由子路由各自包一层。
 *
 * routeKey 是必需的:同一位置、同一组件类型时 React 只做原地更新,边界没被插入或删除,
 * enter/exit 静默不触发(不报错、不警告,只能实拍发现),所以放进签名里,漏不掉。
 *
 * @param routeKey - 这条路由过渡边界的唯一 key
 * @param element - 该路由的页面元素
 * @returns 包好的路由元素
 */
const shellRoute = (routeKey: string, element: React.ReactNode): React.JSX.Element => (
  // 整屏换工作台:交叉淡入。全屏元素一移位,看着就是整页在滑,不是换页
  <ViewTransition key={routeKey} enter="vt-shell" exit="vt-shell" default="none">
    {element}
  </ViewTransition>
);

/** @see shellRoute - 同一层包装,壳层内换内容区时用淡入加轻微上移 */
const contentRoute = (routeKey: string, element: React.ReactNode): React.JSX.Element => (
  <ViewTransition key={routeKey} enter="vt-content" exit="vt-content" default="none">
    {element}
  </ViewTransition>
);

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
      {/* 会话外壳作为 layout 路由常驻:切会话只换子路由,不重拉会话列表 */}
      <Route
        element={shellRoute(
          'chat',
          <ConfigGuard>
            <ChatLayoutPage />
          </ConfigGuard>
        )}
      >
        <Route path="sessions/new" element={contentRoute('sessions-new', <NewSessionPage />)} />
        <Route path="sessions/:sessionId" element={contentRoute('sessions-id', <ChatPage />)} />
      </Route>
      <Route path="/wizard" element={shellRoute('wizard', <WizardPage />)} />
      {/* 设置页不做未配置守卫:删光 Provider 后要能在设置页里重建配置 */}
      <Route path="/settings" element={shellRoute('settings', <SettingsPage />)}>
        <Route index element={<Navigate to="model" replace />} />
        <Route path="model" element={contentRoute('settings-model', <ModelServicePage />)} />
        <Route
          path="model/new"
          element={contentRoute('settings-model-new', <ProviderEditPage />)}
        />
        <Route
          path="model/:providerId"
          element={contentRoute('settings-model-edit', <ProviderEditPage />)}
        />
        <Route path="about" element={contentRoute('settings-about', <AboutPanel />)} />
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
