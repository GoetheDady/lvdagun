import { app, shell, BrowserWindow } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';

function createWindow(): void {
  // 创建浏览器窗口
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 渲染进程 HMR,由 electron-vite CLI 驱动。
  // 开发环境加载远程 URL,生产环境加载本地 HTML 文件。
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// 此方法在 Electron 完成初始化、可以创建浏览器窗口时被调用。
// 部分 API 只能在该事件触发后使用。
void app.whenReady().then(() => {
  // 设置 Windows 的 App User Model ID
  electronApp.setAppUserModelId('com.electron');

  // 开发环境默认按 F12 开关 DevTools,生产环境忽略 CommandOrControl + R。
  // 参见 https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', function () {
    // macOS 上点击 Dock 图标且没有其他窗口时,惯例是重新创建一个窗口。
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 所有窗口关闭时退出应用,macOS 除外。macOS 上应用及其菜单栏通常保持活动,
// 直到用户显式用 Cmd + Q 退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 可以在本文件继续编写主进程专属代码,也可以放到单独文件再引入。
