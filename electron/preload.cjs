const { clipboard, contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tools', {
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  scan: (data) => ipcRenderer.invoke('mover:scan', data),
  move: (data) => ipcRenderer.invoke('mover:move', data),
  undoMove: (data) => ipcRenderer.invoke('mover:undo', data),
  createDestination: (data) => ipcRenderer.invoke('directory:create-child', data),
  resolveUrl: (url) => ipcRenderer.invoke('url:resolve', url),
  openUrl: (url) => ipcRenderer.invoke('url:open', url),
  copyText: async (text) => {
    await clipboard.writeText(text);
  },
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
  getCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (data) => ipcRenderer.invoke('collections:create', data),
  updateCollection: (id, patch) => ipcRenderer.invoke('collections:update', { id, patch }),
  deleteCollection: (id) => ipcRenderer.invoke('collections:delete', id),
  reorderCollections: (ids) => ipcRenderer.invoke('collections:reorder', ids),
  getCollectionColumnTypes: () => ipcRenderer.invoke('collections:column-types'),
  getCollectionItems: (collectionId, q = '') =>
    ipcRenderer.invoke('collection-items:list', { collectionId, q }),
  createCollectionItem: (data) => ipcRenderer.invoke('collection-items:create', data),
  updateCollectionItem: (id, patch) => ipcRenderer.invoke('collection-items:update', { id, patch }),
  deleteCollectionItem: (id) => ipcRenderer.invoke('collection-items:delete', id),
  exportCollection: (id) => ipcRenderer.invoke('collections:export', id),
  importCollection: () => ipcRenderer.invoke('collections:import'),
  getWishlist: (q = '') => ipcRenderer.invoke('wishlist:list', q),
  createWishlistItem: (data) => ipcRenderer.invoke('wishlist:create', data),
  updateWishlistItem: (id, patch) => ipcRenderer.invoke('wishlist:update', { id, patch }),
  deleteWishlistItem: (id) => ipcRenderer.invoke('wishlist:delete', id),
  addWishlistPrice: (wishlistId, data) =>
    ipcRenderer.invoke('wishlist-prices:create', { wishlistId, data }),
  deleteWishlistPrice: (id) => ipcRenderer.invoke('wishlist-prices:delete', id),
  refreshWishlistPrice: (id) => ipcRenderer.invoke('wishlist-prices:refresh', id),
  refreshWishlist: () => ipcRenderer.invoke('wishlist:refresh'),
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
  list: (folders) => ipcRenderer.invoke('rename:list', folders),
  rename: (data) => ipcRenderer.invoke('rename:execute', data),
  selectRenameFolders: () => ipcRenderer.invoke('rename:select-folders'),
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
  getNormalizeState: () => ipcRenderer.invoke('normalizer:state'),
  onNormalizeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('normalizer:progress', listener);
    return () => ipcRenderer.removeListener('normalizer:progress', listener);
  },
  onNormalizeState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('normalizer:state-changed', listener);
    return () => ipcRenderer.removeListener('normalizer:state-changed', listener);
  },
});
