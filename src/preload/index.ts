/**
 * @file preload 桥接层:把主进程能力通过 contextBridge 暴露给渲染进程。
 */
import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// 仅当启用 context isolation 时,通过 contextBridge 将 Electron API 暴露给渲染进程;
// 否则直接挂到 DOM 全局对象上。
// context isolation 开启时渲染进程拿不到 Node 全局,只能用 contextBridge 桥接;
// 关闭时则直接赋值,两条路径都要覆盖,否则 window.electron 未定义导致渲染进程报错
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
  } catch (error) {
    // 暴露失败不应导致 preload 崩溃,否则整个窗口无法加载
    console.error(error);
  }
} else {
  // @ts-ignore (在 dts 中定义)
  window.electron = electronAPI;
}
