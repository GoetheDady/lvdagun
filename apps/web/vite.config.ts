import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { DEFAULT_SERVICE_PORT, DEV_WEB_PORT, SERVICE_HOST } from '@lvdagun/protocol';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: DEV_WEB_PORT,
    // 端口变化会让 CLI 打开的固定地址失效,因此被占用时应直接报错
    strictPort: true,
    // dev 模式:页面跑在 vite(16346),RPC WebSocket 转发到本地服务(16345)
    proxy: {
      '/rpc': {
        target: `http://${SERVICE_HOST}:${DEFAULT_SERVICE_PORT}`,
        ws: true,
      },
    },
  },
});
