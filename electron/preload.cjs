const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tools', {
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  scan: (data) => ipcRenderer.invoke('mover:scan', data),
  move: (data) => ipcRenderer.invoke('mover:move', data),
  list: (directory) => ipcRenderer.invoke('rename:list', directory),
  rename: (data) => ipcRenderer.invoke('rename:execute', data),
  selectVideoFolders: () => ipcRenderer.invoke('video:select-folders'),
  inspectVideoFolders: (data) => ipcRenderer.invoke('video:inspect', data),
  startVideoConversion: (data) => ipcRenderer.invoke('video:start', data),
  cancelVideoConversion: () => ipcRenderer.invoke('video:cancel'),
  onVideoProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('video:progress', listener);
    return () => ipcRenderer.removeListener('video:progress', listener);
  },
  selectNormalizeFolders: () => ipcRenderer.invoke('normalizer:select-folders'),
  scanNormalizeFiles: (data) => ipcRenderer.invoke('normalizer:scan', data),
  startNormalization: (data) => ipcRenderer.invoke('normalizer:start', data),
  cancelNormalization: () => ipcRenderer.invoke('normalizer:cancel'),
  onNormalizeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('normalizer:progress', listener);
    return () => ipcRenderer.removeListener('normalizer:progress', listener);
  },
});
