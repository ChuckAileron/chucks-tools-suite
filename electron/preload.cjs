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
  getVideoQualityOptions: (url) => ipcRenderer.invoke('downloads:video-quality-options', url),
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
  showDownloadDirectory: (directory) => ipcRenderer.invoke('downloads:show-directory', directory),
  getDownloadDiskInfo: (directory) => ipcRenderer.invoke('downloads:disk-info', directory),
  getCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (data) => ipcRenderer.invoke('collections:create', data),
  updateCollection: (id, patch) => ipcRenderer.invoke('collections:update', { id, patch }),
  deleteCollection: (id) => ipcRenderer.invoke('collections:delete', id),
  reorderCollections: (ids) => ipcRenderer.invoke('collections:reorder', ids),
  getCollectionColumnTypes: () => ipcRenderer.invoke('collections:column-types'),
  getWikiPages: (query = '') => ipcRenderer.invoke('wiki:list', query),
  getWikiCategories: () => ipcRenderer.invoke('wiki:categories'),
  getWikiStats: () => ipcRenderer.invoke('wiki:stats'),
  getWikiPage: (id) => ipcRenderer.invoke('wiki:get', id),
  createWikiPage: (data) => ipcRenderer.invoke('wiki:create', data),
  updateWikiPage: (id, patch) => ipcRenderer.invoke('wiki:update', { id, patch }),
  deleteWikiPage: (id) => ipcRenderer.invoke('wiki:delete', id),
  hijitosList: () => ipcRenderer.invoke('hijitos:list'),
  hijitosGetBanner: () => ipcRenderer.invoke('hijitos:get-banner'),
  hijitosSetBanner: (banner) => ipcRenderer.invoke('hijitos:set-banner', banner),
  hijitosUpdateTrack: (slug, patch) => ipcRenderer.invoke('hijitos:update-track', { slug, patch }),
  hijitosCreateTask: (data) => ipcRenderer.invoke('hijitos:create-task', data),
  hijitosUpdateTask: (id, patch) => ipcRenderer.invoke('hijitos:update-task', { id, patch }),
  hijitosDeleteTask: (id) => ipcRenderer.invoke('hijitos:delete-task', id),
  hijitosCreateSubtask: (taskId, description) =>
    ipcRenderer.invoke('hijitos:create-subtask', { taskId, description }),
  hijitosUpdateSubtask: (id, patch) =>
    ipcRenderer.invoke('hijitos:update-subtask', { id, patch }),
  hijitosDeleteSubtask: (id) => ipcRenderer.invoke('hijitos:delete-subtask', id),
  hijitosSelectBanner: () => ipcRenderer.invoke('hijitos:select-banner'),
  hijitosReadBanner: (filePath) => ipcRenderer.invoke('hijitos:read-banner', filePath),
  imagesSelect: () => ipcRenderer.invoke('images:select'),
  imagesConvert: (format, files) => ipcRenderer.invoke('images:convert', { format, files }),
  getCollectionItems: (collectionId, q = '') =>
    ipcRenderer.invoke('collection-items:list', { collectionId, q }),
  createCollectionItem: (data) => ipcRenderer.invoke('collection-items:create', data),
  updateCollectionItem: (id, patch) => ipcRenderer.invoke('collection-items:update', { id, patch }),
  deleteCollectionItem: (id) => ipcRenderer.invoke('collection-items:delete', id),
  exportCollection: (id) => ipcRenderer.invoke('collections:export', id),
  importCollection: () => ipcRenderer.invoke('collections:import'),
  searchImages: (data) => ipcRenderer.invoke('images:search', data),
  launchboxSelectCsv: () => ipcRenderer.invoke('launchbox:select-csv'),
  launchboxMatchRows: (data) => ipcRenderer.invoke('launchbox:match-rows', data),
  launchboxSingle: (data) => ipcRenderer.invoke('launchbox:single', data),
  launchboxApplyOne: (data) => ipcRenderer.invoke('launchbox:apply-one', data),
  launchboxBulkSearch: (data) => ipcRenderer.invoke('launchbox:bulk-search', data),
  launchboxBulkCancel: () => ipcRenderer.invoke('launchbox:bulk-cancel'),
  launchboxApplyBulk: (data) => ipcRenderer.invoke('launchbox:apply-bulk', data),
  launchboxExportResults: (data) => ipcRenderer.invoke('launchbox:export-results', data),
  launchboxApplyResultsCsv: (data) => ipcRenderer.invoke('launchbox:apply-results-csv', data),
  onLaunchBoxBulkProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('launchbox:bulk-progress', listener);
    return () => ipcRenderer.removeListener('launchbox:bulk-progress', listener);
  },
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
  getRules: () => ipcRenderer.invoke('rules:list'),
  saveRule: (rule) => ipcRenderer.invoke('rules:save', rule),
  deleteRule: (id) => ipcRenderer.invoke('rules:delete', id),
  previewRule: (name, operations) => ipcRenderer.invoke('rules:preview', { name, operations }),
  onClipboardLinks: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on('downloads:clipboard', listener);
    return () => ipcRenderer.removeListener('downloads:clipboard', listener);
  },
  list: (folders) => ipcRenderer.invoke('rename:list', folders),
  listFolders: (folders) => ipcRenderer.invoke('rename:list-folders', folders),
  rename: (data) => ipcRenderer.invoke('rename:execute', data),
  selectRenameFolders: () => ipcRenderer.invoke('rename:select-folders'),
  selectVideoFolders: () => ipcRenderer.invoke('video:select-folders'),
  inspectVideoFolders: (data) => ipcRenderer.invoke('video:inspect', data),
  getVideoState: () => ipcRenderer.invoke('video:state'),
  getVideoCapacity: () => ipcRenderer.invoke('video:capacity'),
  startVideoConversion: (data) => ipcRenderer.invoke('video:start', data),
  cancelVideoConversion: () => ipcRenderer.invoke('video:cancel'),
  skipVideoFolder: (folder) => ipcRenderer.invoke('video:skip-folder', folder),
  appendVideoFolders: (data) => ipcRenderer.invoke('video:append-folders', data),
  clearVideoState: () => ipcRenderer.invoke('video:clear'),
  setVideoNormalize: (data) => ipcRenderer.invoke('video:set-normalize', data),
  setVideoConcurrency: (preference) => ipcRenderer.invoke('video:set-concurrency', preference),
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
  measureNormalizeLufs: (filePath) => ipcRenderer.invoke('normalizer:measure-lufs', filePath),
  cancelLufsScan: () => ipcRenderer.invoke('normalizer:cancel-lufs-scan'),
  resumeLufsScan: () => ipcRenderer.invoke('normalizer:resume-lufs'),
  getNormalizeConfig: () => ipcRenderer.invoke('normalizer:config'),
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
  selectTrimFolders: () => ipcRenderer.invoke('trim:select-folders'),
  scanTrimFiles: (data) => ipcRenderer.invoke('trim:scan', data),
  getTrimState: () => ipcRenderer.invoke('trim:state'),
  setTrimUi: (data) => ipcRenderer.invoke('trim:set-ui', data),
  startTrim: (data) => ipcRenderer.invoke('trim:start', data),
  skipTrimFolder: (folder) => ipcRenderer.invoke('trim:skip-folder', folder),
  cancelTrim: () => ipcRenderer.invoke('trim:cancel'),
  onTrimProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('trim:progress', listener);
    return () => ipcRenderer.removeListener('trim:progress', listener);
  },
  onTrimState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('trim:state-changed', listener);
    return () => ipcRenderer.removeListener('trim:state-changed', listener);
  },
  hddSelectRoot: () => ipcRenderer.invoke('hdd:select-root'),
  hddListVolumes: () => ipcRenderer.invoke('hdd:list-volumes'),
  hddList: () => ipcRenderer.invoke('hdd:list'),
  hddRegister: (data) => ipcRenderer.invoke('hdd:register', data),
  hddUpdate: (id, patch) => ipcRenderer.invoke('hdd:update', { id, patch }),
  hddRemove: (id) => ipcRenderer.invoke('hdd:remove', id),
  hddEntries: (driveId, parentPath) => ipcRenderer.invoke('hdd:entries', { driveId, parentPath }),
  hddEntry: (id) => ipcRenderer.invoke('hdd:entry', id),
  hddSearch: (driveId, query) => ipcRenderer.invoke('hdd:search', { driveId, query }),
  hddDescendantCount: (driveId, entryId) =>
    ipcRenderer.invoke('hdd:descendant-count', { driveId, entryId }),
  hddShowInFolder: (driveId, entryId) =>
    ipcRenderer.invoke('hdd:show-in-folder', { driveId, entryId }),
  hddThumbnail: (entryId) => ipcRenderer.invoke('hdd:thumbnail', entryId),
  hddRename: (data) => ipcRenderer.invoke('hdd:rename', data),
  hddScanState: () => ipcRenderer.invoke('hdd:scan-state'),
  hddStartScan: (driveId) => ipcRenderer.invoke('hdd:start-scan', driveId),
  hddCancelScan: () => ipcRenderer.invoke('hdd:cancel-scan'),
  onHddScanState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('hdd:scan-state', listener);
    return () => ipcRenderer.removeListener('hdd:scan-state', listener);
  },
  mediaDocumentText: (driveId, entryId) =>
    ipcRenderer.invoke('media:document-text', { driveId, entryId }),
  binderListSeries: () => ipcRenderer.invoke('binder:list-series'),
  binderListSubseries: (series) => ipcRenderer.invoke('binder:list-subseries', series),
  binderListSets: (filter) => ipcRenderer.invoke('binder:list-sets', filter),
  binderGetSet: (id) => ipcRenderer.invoke('binder:get-set', id),
  binderCreateSet: (data) => ipcRenderer.invoke('binder:create-set', data),
  binderUpdateSet: (id, patch) => ipcRenderer.invoke('binder:update-set', { id, patch }),
  binderDeleteSet: (id) => ipcRenderer.invoke('binder:delete-set', id),
  binderListCards: (setId) => ipcRenderer.invoke('binder:list-cards', setId),
  binderSearchCards: (query) => ipcRenderer.invoke('binder:search-cards', query),
  binderGetCard: (id) => ipcRenderer.invoke('binder:get-card', id),
  binderCreateCard: (data) => ipcRenderer.invoke('binder:create-card', data),
  binderUpdateCard: (id, patch) => ipcRenderer.invoke('binder:update-card', { id, patch }),
  binderDeleteCard: (id) => ipcRenderer.invoke('binder:delete-card', id),
  binderListVariants: (cardId) => ipcRenderer.invoke('binder:list-variants', cardId),
  binderCreateVariant: (data) => ipcRenderer.invoke('binder:create-variant', data),
  binderUpdateVariant: (id, patch) => ipcRenderer.invoke('binder:update-variant', { id, patch }),
  binderDeleteVariant: (id) => ipcRenderer.invoke('binder:delete-variant', id),
  binderListCustomLists: () => ipcRenderer.invoke('binder:list-custom-lists'),
  binderCreateCustomList: (data) => ipcRenderer.invoke('binder:create-custom-list', data),
  binderUpdateCustomList: (id, patch) =>
    ipcRenderer.invoke('binder:update-custom-list', { id, patch }),
  binderDeleteCustomList: (id) => ipcRenderer.invoke('binder:delete-custom-list', id),
  binderListCustomListCards: (listId) =>
    ipcRenderer.invoke('binder:list-custom-list-cards', listId),
  binderAddCardToList: (data) => ipcRenderer.invoke('binder:add-card-to-list', data),
  binderRemoveCardFromList: (id) => ipcRenderer.invoke('binder:remove-card-from-list', id),
  binderReorderCustomListCards: (listId, ids) =>
    ipcRenderer.invoke('binder:reorder-custom-list-cards', { listId, ids }),
  binderSelectImportFile: () => ipcRenderer.invoke('binder:select-import-file'),
  binderImportZip: (filePath) => ipcRenderer.invoke('binder:import-zip', filePath),
  binderSelectExportDestination: (defaultName) =>
    ipcRenderer.invoke('binder:select-export-destination', defaultName),
  binderExportCollection: (destination) =>
    ipcRenderer.invoke('binder:export-collection', destination),
  binderExportSet: (setId, destination) =>
    ipcRenderer.invoke('binder:export-set', { setId, destination }),
  binderExportCustomList: (listId, destination) =>
    ipcRenderer.invoke('binder:export-custom-list', { listId, destination }),
  binderAddCardToCollection: (data) => ipcRenderer.invoke('binder:add-card-to-collection', data),
  binderAddSetToCollection: (data) => ipcRenderer.invoke('binder:add-set-to-collection', data),
  chuckbotStatus: () => ipcRenderer.invoke('chuckbot:status'),
  chuckbotStart: () => ipcRenderer.invoke('chuckbot:start'),
  chuckbotStop: () => ipcRenderer.invoke('chuckbot:stop'),
  chuckbotOllamaStatus: () => ipcRenderer.invoke('chuckbot:ollama-status'),
  chuckbotOllamaStart: () => ipcRenderer.invoke('chuckbot:ollama-start'),
  chuckbotOllamaStop: () => ipcRenderer.invoke('chuckbot:ollama-stop'),
  chuckbotChat: (data) => ipcRenderer.invoke('chuckbot:chat', data),
  chuckbotCancelChat: () => ipcRenderer.invoke('chuckbot:chat-cancel'),
  chuckbotPushToVsCode: (data) => ipcRenderer.invoke('chuckbot:push-vscode', data),
  chuckbotSelectFolder: () => ipcRenderer.invoke('chuckbot:select-folder'),
  chuckbotSaveSolution: (data) => ipcRenderer.invoke('chuckbot:save-solution', data),
  chuckbotRevealFile: (filePath) => ipcRenderer.invoke('chuckbot:reveal-file', filePath),
  onChuckBotEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('chuckbot:event', listener);
    return () => ipcRenderer.removeListener('chuckbot:event', listener);
  },
});
