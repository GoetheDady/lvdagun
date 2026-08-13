/**
 * @file 渲染进程入口:创建 React 根节点并挂载 App 组件。
 */
import './assets/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// 用 createRoot 而非 ReactDOM.render:React 18+ 的并发渲染 API,老 API 已废弃
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
