/**
 * @file 渲染进程入口:创建 React 根节点并挂载 App 组件。
 */
import './assets/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import App from './App';

// 用 HashRouter 而非 BrowserRouter:生产环境经 file:// 加载,
// path 路由在 file 协议下无法工作,hash 路由不依赖服务端路径解析。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
