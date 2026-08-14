/**
 * @file 渲染入口:读取一次性 token 后挂载 React 应用。
 */
import './assets/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import App from './App';
import { initTokenFromUrl } from './lib/api';

// 本地服务打开的 URL 带 ?token=xxx:读一次存 localStorage 并抹掉地址栏
initTokenFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
