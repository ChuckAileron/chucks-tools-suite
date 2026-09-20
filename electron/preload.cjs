const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tools', {
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  scan: (data) => ipcRenderer.invoke('mover:scan', data),
  move: (data) => ipcRenderer.invoke('mover:move', data),
  undoMove: (data) => ipcRenderer.invoke('mover:undo', data),
  createDestination: (data) => ipcRenderer.invoke('directory:create-child', data),
  openUrl: (url) => ipcRenderer.invoke('url:open', url),
  getDownloads: () => ipcRenderer.invoke('downloads:state'),
  analyzeDownloads: (text) => ipcRenderer.invoke('downloads:analyze', text),
  addDownloads: (items) => ipcRenderer.invoke('downloads:add', items),
  updateDownload: (id, changes) => ipcRenderer.invoke('downloads:update', { id, changes }),
  controlDownload: (id, action) => ipcRenderer.invoke('downloads:control', { id, action }),
  controlDownloads: (ids, action) => ipcRenderer.invoke('downloads:control-many', { ids, action }),
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
  searchImages: (data) => ipcRenderer.invoke('images:search', data),
  analogListChannels: () => ipcRenderer.invoke('analog:channels:list'),
  analogCreateChannel: (data) => ipcRenderer.invoke('analog:channels:create', data),
  analogUpdateChannel: (id, patch) => ipcRenderer.invoke('analog:channels:update', { id, patch }),
  analogDeleteChannel: (id) => ipcRenderer.invoke('analog:channels:delete', id),
  analogListShows: () => ipcRenderer.invoke('analog:shows:list'),
  analogCreateShow: (data) => ipcRenderer.invoke('analog:shows:create', data),
  analogUpdateShow: (id, patch) => ipcRenderer.invoke('analog:shows:update', { id, patch }),
  analogDeleteShow: (id) => ipcRenderer.invoke('analog:shows:delete', id),
  analogSelectJson: () => ipcRenderer.invoke('analog:select-json'),
  analogImportChannels: (filePath) => ipcRenderer.invoke('analog:channels:import', filePath),
  analogImportShows: (filePath) => ipcRenderer.invoke('analog:shows:import', filePath),
  analogSelectFolder: () => ipcRenderer.invoke('analog:select-folder'),
  analogFolderVideos: (folderPath) => ipcRenderer.invoke('analog:folder-videos', folderPath),
  analogFolderMatch: (folderPath, episodes) =>
    ipcRenderer.invoke('analog:folder-match', { folderPath, episodes }),
  analogScheduleStatus: () => ipcRenderer.invoke('analog:schedule:status'),
  analogScheduleConfig: () => ipcRenderer.invoke('analog:schedule:config'),
  analogScheduleGenerate: (year) => ipcRenderer.invoke('analog:schedule:generate', year),
  analogScheduleMonth: (year, month) =>
    ipcRenderer.invoke('analog:schedule:month', { year, month }),
  analogScheduleReset: () => ipcRenderer.invoke('analog:schedule:reset'),
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
  clearVideoState: () => ipcRenderer.invoke('video:clear'),
  setVideoNormalize: (data) => ipcRenderer.invoke('video:set-normalize', data),
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
  setNormalizeTarget: (targetDb) => ipcRenderer.invoke('normalizer:set-target', targetDb),
  setNormalizeUi: (data) => ipcRenderer.invoke('normalizer:set-ui', data),
  skipNormalizeFolder: (folder) => ipcRenderer.invoke('normalizer:skip-folder', folder),
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
