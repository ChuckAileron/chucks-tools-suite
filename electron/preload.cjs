const { clipboard, contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tools', {
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  scan: (data) => ipcRenderer.invoke('mover:scan', data),
  move: (data) => ipcRenderer.invoke('mover:move', data),
  undoMove: (data) => ipcRenderer.invoke('mover:undo', data),
  createDestination: (data) => ipcRenderer.invoke('directory:create-child', data),
  resolveUrl: (url) => ipcRenderer.invoke('url:resolve', url),
  openUrl: (url) => ipcRenderer.invoke('url:open', url),
  copyText: (text) => clipboard.writeText(text),
  getDownloads: () => ipcRenderer.invoke('downloads:state'),
  analyzeDownloads: (text) => ipcRenderer.invoke('downloads:analyze', text),
  addDownloads: (items) => ipcRenderer.invoke('downloads:add', items),
  updateDownload: (id, changes) => ipcRenderer.invoke('downloads:update', { id, changes }),
  controlDownload: (id, action) => ipcRenderer.invoke('downloads:control', { id, action }),
  clearCompletedDownloads: () => ipcRenderer.invoke('downloads:clear-completed'),
  setDownloadSettings: (settings) => ipcRenderer.invoke('downloads:settings', settings),
  retryExtraction: (id, password) =>
    ipcRenderer.invoke('downloads:retry-extraction', { id, password }),
  selectDownloadDirectory: () => ipcRenderer.invoke('downloads:select-directory'),
  showDownloadedFile: (filePath) => ipcRenderer.invoke('downloads:show-file', filePath),
  onDownloadsState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('downloads:state', listener);
    return () => ipcRenderer.removeListener('downloads:state', listener);
  },
  onClipboardLinks: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on('downloads:clipboard', listener);
    return () => ipcRenderer.removeListener('downloads:clipboard', listener);
  },
  list: (directory) => ipcRenderer.invoke('rename:list', directory),
  rename: (data) => ipcRenderer.invoke('rename:execute', data),
  selectVideoFolders: () => ipcRenderer.invoke('video:select-folders'),
  inspectVideoFolders: (data) => ipcRenderer.invoke('video:inspect', data),
  getVideoState: () => ipcRenderer.invoke('video:state'),
  startVideoConversion: (data) => ipcRenderer.invoke('video:start', data),
  cancelVideoConversion: () => ipcRenderer.invoke('video:cancel'),
  skipVideoFolder: (folder) => ipcRenderer.invoke('video:skip-folder', folder),
  appendVideoFolders: (data) => ipcRenderer.invoke('video:append-folders', data),
  onVideoProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('video:progress', listener);
    return () => ipcRenderer.removeListener('video:progress', listener);
  },
  onVideoState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('video:state-changed', listener);
    return () => ipcRenderer.removeListener('video:state-changed', listener);
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
