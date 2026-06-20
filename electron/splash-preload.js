// splash 窗口的 preload：contextIsolation 下只暴露最小 API 给按钮回调
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashApi', {
  openLog: () => ipcRenderer.invoke('splash:openLog'),
  readLog: () => ipcRenderer.invoke('splash:readLog')
});
