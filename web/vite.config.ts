import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // dev 模式:页面跑在 vite(5173),/api 转发到本地服务(16345)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:16345',
      },
    },
  },
});
