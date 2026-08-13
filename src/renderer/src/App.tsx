import { Route, Routes } from 'react-router';

import ChatPage from '@/pages/chat';
import SettingsPage from '@/pages/settings';
import WizardPage from '@/pages/wizard';

/**
 * 应用根组件:路由表。
 *
 * 路由结构对应 PRD 页面清单:/ 对话页、/wizard 配置向导、/settings 设置页。
 * 首次启动是否跳转 /wizard 由"是否已配置"决定(后续接入)。
 *
 * @returns 路由表元素
 */
function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/wizard" element={<WizardPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

export default App;
