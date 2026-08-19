#!/usr/bin/env bun
/**
 * @file CLI 入口:lvdagun serve 启动本地服务,lvdagun stop 停止。
 *
 * 生命周期与 PRD 6.2 一致:关浏览器标签 ≠ 退出,只有 stop(或 Ctrl+C/SIGTERM)才结束进程。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_SERVICE_PORT, DEV_WEB_PORT, SERVICE_HOST } from '@lvdagun/protocol';

import { FileConfigStore } from './config/config-store';
import { CONFIG_FILE, DATA_DIR } from './config/paths';
import { createPiAgentHubAdapter } from './hub/pi-agent-hub-adapter';
import { createAgentHub } from './hub/agent-hub';
import { createServer } from './http/server';

const PID_FILE = join(DATA_DIR, 'serve.pid');

const command = process.argv[2];

switch (command) {
  case 'serve':
    await serve();
    break;
  case 'stop':
    await stop();
    break;
  default:
    console.error('用法:lvdagun serve [--port <端口>] | lvdagun stop');
    process.exit(2);
}

/**
 * 启动本地服务:监听端口,写 pid 文件,自动打开浏览器。
 */
async function serve(): Promise<void> {
  const isDev = process.env.LVDAGUN_DEV === '1';
  const port = parsePort();

  // 生产模式托管 web 构建产物;dev 模式页面由 vite 提供,只开 API
  const webDist = join(import.meta.dirname, '../../web/dist');
  const configStore = new FileConfigStore(CONFIG_FILE);
  const agentHub = createAgentHub(createPiAgentHubAdapter({ dataDir: DATA_DIR }), configStore);
  const app = createServer({
    agentHub,
    webDist: !isDev && existsSync(webDist) ? webDist : undefined,
  });

  const server = app.listen(port, SERVICE_HOST, () => {
    const webPort = isDev ? DEV_WEB_PORT : port;
    const url = `http://${SERVICE_HOST}:${webPort}/`;
    console.log(`驴打滚已启动:${url}`);
    void writeFile(PID_FILE, String(process.pid), { mode: 0o600 });
    openBrowser(url);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用:服务可能已在运行,或改用 --port 指定其他端口。`);
      process.exit(1);
    }
    throw error;
  });

  // 优雅退出:关服务、清 pid 文件(SIGINT=Ctrl+C,SIGTERM=lvdagun stop)
  const shutdown = async (): Promise<void> => {
    server.close();
    await agentHub.dispose();
    await rm(PID_FILE, { force: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/**
 * 停止本地服务:按 pid 文件发 SIGTERM,服务进程自己负责清理。
 */
async function stop(): Promise<void> {
  let pid: number;
  try {
    pid = Number((await readFile(PID_FILE, 'utf8')).trim());
  } catch {
    console.error('服务未在运行(找不到 pid 文件)。');
    process.exit(1);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log('驴打滚已停止。');
  } catch {
    console.error('服务未在运行(pid 已失效)。');
    await rm(PID_FILE, { force: true });
    process.exit(1);
  }
}

/**
 * 解析 --port 参数。
 *
 * @returns 端口号
 */
function parsePort(): number {
  const index = process.argv.indexOf('--port');
  if (index === -1) {
    return DEFAULT_SERVICE_PORT;
  }
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`无效端口:${process.argv[index + 1]}`);
    process.exit(2);
  }
  return value;
}

/**
 * 用系统默认浏览器打开页面。
 *
 * @param url - 客户端完整地址
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true }).unref();
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true }).unref();
  }
}
