const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tools', {
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  scan: (data) => ipcRenderer.invoke('mover:scan', data),
  move: (data) => ipcRenderer.invoke('mover:move', data),
  list: (directory) => ipcRenderer.invoke('rename:list', directory),
  rename: (data) => ipcRenderer.invoke('rename:execute', data),
});
