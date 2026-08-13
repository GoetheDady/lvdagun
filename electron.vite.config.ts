import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    build: {
      // Pi 包是纯 ESM(只导出 import),主进程 CJS 产物 require 会报
      // ERR_PACKAGE_PATH_NOT_EXPORTED;把它们打进主进程 bundle,构建期完成解析
      externalizeDeps: {
        exclude: [
          '@earendil-works/pi-coding-agent',
          '@earendil-works/pi-agent-core',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-telemetry',
        ],
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
