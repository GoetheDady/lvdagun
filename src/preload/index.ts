import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// 仅当启用 context isolation 时,通过 contextBridge 将 Electron API 暴露给渲染进程;
// 否则直接挂到 DOM 全局对象上。
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (在 dts 中定义)
  window.electron = electronAPI;
}
