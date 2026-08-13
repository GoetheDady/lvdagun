/**
 * @file 主进程入口:负责应用生命周期、主窗口创建与关闭。
 */
import { app, shell, BrowserWindow } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { ensureDataDir, FileConfigStore } from './hub/config';
import { registerHubIpc } from './hub/ipc';

/**
 * 创建应用主窗口。
 *
 * @returns 创建的 BrowserWindow 实例
 */
function createWindow(): void {
  // show: false + ready-to-show 再显示:若直接显示,窗口会先渲染白底再加载内容,造成闪烁
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    // 隐藏菜单栏:应用界面自带操作入口,菜单栏冗余
    autoHideMenuBar: true,
    // Linux 下窗口图标必须显式传入(mac/Windows 图标由打包配置提供,无需此字段)
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 关闭沙箱:@electron-toolkit/preload 桥接需要完整 Node API,沙箱开启时无法使用
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 一律用系统浏览器打开外部链接,禁止应用内新开窗口(否则页面脱离 React 应用上下文)
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 渲染进程 HMR,由 electron-vite CLI 驱动。
  // 开发环境加载远程 URL,生产环境加载本地 HTML 文件。
  // 用 void 忽略 Promise:加载结果异步返回,失败会触发 did-fail-load,无需在此 await
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// 此方法在 Electron 完成初始化、可以创建浏览器窗口时被调用。
// 部分 API 只能在该事件触发后使用,提前调用会抛异常。
void app.whenReady().then(async () => {
  // 设置 Windows 的 App User Model ID,否则任务栏分组/通知归属异常
  electronApp.setAppUserModelId('com.electron');

  // 确保 ~/.lvdagun 数据目录存在(幂等),再注册 Hub 的 IPC 通道(配置读写/模型列表/测试连接)
  await ensureDataDir();
  registerHubIpc(new FileConfigStore());

  // 开发环境默认按 F12 开关 DevTools,生产环境忽略 CommandOrControl + R。
  // 参见 https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', function () {
    // macOS 上点击 Dock 图标且没有其他窗口时,惯例是重新创建一个窗口。
    // 若省略此分支,关闭全部窗口后点击 Dock 图标应用无任何反应
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 所有窗口关闭时退出应用,macOS 除外。macOS 上应用及其菜单栏通常保持活动,
// 直到用户显式用 Cmd + Q 退出,这是平台惯例。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
