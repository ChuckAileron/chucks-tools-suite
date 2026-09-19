const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { inspectFolder, convertFolder } = require('./videoConversion.cjs');
const { scanMedia, normalizeMedia } = require('./audioNormalizer.cjs');
const { resolveUrl, validatePublicUrl } = require('./urlResolver.cjs');
const { DownloadManager } = require('./downloadManager.cjs');
const { CollectionManager, COLUMN_TYPES } = require('./collectionManager.cjs');
const { scrapePrice } = require('./priceScraper.cjs');
const { listFiles, renameFile } = require('./renameManager.cjs');
let downloadManager;
let collectionManager;
let lastClipboard = '';
const createdDestinationFolders = new Set();
let videoCancelled = false;
let activeVideoProcess = null;
let videoQueue = [];
let activeVideoFolder = '';
let videoCompletedFiles = 0;
let videoTotalFiles = 0;
let videoState = {
  running: false,
  codec: 'h264',
  folders: [],
  trackSelections: {},
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Ningún archivo en proceso',
  activeFolder: '',
  logs: [],
};
let normalizeCancelled = false;
let activeNormalizeProcess = null;
function emitVideoProgress(data) {
  const addLog = (text, tone) => {
    videoState.logs = [...videoState.logs.slice(-99), { text, tone }];
  };
  if (data.type === 'folder-start') {
    videoState.activeFolder = data.folder || '';
    addLog(`Procesando: ${data.folder}`);
  } else if (data.type === 'info' && data.message) addLog(data.message);
  else if (data.type === 'queue-progress')
    videoState.globalProgress = data.total
      ? Math.floor(((data.current || 0) / data.total) * 100)
      : 0;
  else if (data.type === 'file-start') {
    videoState.activeFile = data.file || 'Archivo';
    videoState.fileProgress = 0;
    addLog(`Convirtiendo ${data.file}`);
  } else if (data.type === 'file-progress') videoState.fileProgress = data.percent || 0;
  else if (data.type === 'file-done') {
    videoState.fileProgress = 100;
    addLog(`${data.file} completado`, 'success');
  } else if (data.type === 'folder-done') {
    videoState.activeFolder = '';
    videoState.folders = videoState.folders.map((folder) =>
      folder.folder === data.folder ? { ...folder, processed: true } : folder,
    );
    addLog(`Carpeta completada: ${data.folder}`, 'success');
  } else if (data.type === 'error') addLog(`Error: ${data.message}`, 'error');
  else if (data.type === 'cancelled' || data.type === 'all-done') {
    videoState.running = false;
    videoState.activeFolder = '';
    if (data.type === 'all-done') videoState.globalProgress = 100;
    addLog(
      data.type === 'cancelled' ? 'Conversión cancelada.' : 'Conversión finalizada.',
      data.type === 'cancelled' ? 'error' : 'success',
    );
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('video:progress', data);
    window.webContents.send('video:state-changed', videoState);
  }
}
const TYPES = {
  video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.flv'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.heic'],
  document: [
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.txt',
    '.rtf',
    '.odt',
    '.csv',
  ],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
};
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function validate(source, destination) {
  if (!source || !destination) throw new Error('Selecciona las carpetas de origen y destino.');
  if (same(source, destination))
    throw new Error('Las carpetas de origen y destino deben ser diferentes.');
}
async function scan({ source, destination, types, customExtensions }) {
  if (!source) throw new Error('Selecciona una carpeta de origen.');
  const allowed = new Set([
    ...types.flatMap((type) => TYPES[type] || []),
    ...customExtensions.map((value) => value.toLowerCase().replace(/^([^\.])/, '.$1')),
  ]);
  const root = path.resolve(source),
    result = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory() && (!destination || !same(absolute, destination)))
        await walk(absolute);
      else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(absolute);
        result.push({
          path: absolute,
          relativePath: path.relative(root, absolute),
          name: entry.name,
          extension: path.extname(entry.name).toLowerCase(),
          size: stat.size,
        });
      }
    }
  }
  await walk(root);
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
async function targetPath(destination, name) {
  const ext = path.extname(name),
    base = path.basename(name, ext);
  let target = path.join(destination, name),
    i = 2;
  while (true) {
    try {
      await fs.access(target);
      target = path.join(destination, `${base} (${i++})${ext}`);
    } catch {
      return target;
    }
  }
}
async function move(data) {
  validate(data.source, data.destination);
  const root = path.resolve(data.source),
    destination = path.resolve(data.destination);
  await fs.mkdir(destination, { recursive: true });
  let moved = 0;
  const moves = [];
  const errors = [];
  for (const file of data.files) {
    const absolute = path.resolve(file.path),
      relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      errors.push(`${file.name}: ruta inválida`);
      continue;
    }
    try {
      const target = await targetPath(destination, path.basename(absolute));
      try {
        await fs.rename(absolute, target);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        await fs.copyFile(absolute, target);
        await fs.unlink(absolute);
      }
      moved++;
      moves.push({ originalPath: absolute, movedPath: target });
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  let deletedFolders = 0;
  if (data.deleteChildFolders) {
    for (const entry of await fs.readdir(root, { withFileTypes: true }))
      if (entry.isDirectory()) {
        const child = path.join(root, entry.name);
        const destinationRelative = path.relative(child, destination);
        if (!destinationRelative.startsWith('..') && !path.isAbsolute(destinationRelative))
          continue;
        await fs.rm(child, { recursive: true, force: true });
        deletedFolders++;
      }
  }
  let returned = 0;
  if (data.returnToSource) {
    for (const record of moves) {
      try {
        const target = await targetPath(root, path.basename(record.movedPath));
        try {
          await fs.rename(record.movedPath, target);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await fs.copyFile(record.movedPath, target);
          await fs.unlink(record.movedPath);
        }
        record.movedPath = target;
        returned++;
      } catch (error) {
        errors.push(
          `${path.basename(record.movedPath)}: no se pudo devolver al origen: ${error.message}`,
        );
      }
    }
  }
  let deletedDestination = false;
  if (data.returnToSource && data.deleteCreatedDestination) {
    const destinationRelative = path.relative(root, destination);
    if (
      createdDestinationFolders.has(destination) &&
      destinationRelative &&
      !destinationRelative.startsWith('..') &&
      !path.isAbsolute(destinationRelative)
    ) {
      try {
        await fs.rmdir(destination);
        createdDestinationFolders.delete(destination);
        deletedDestination = true;
      } catch (error) {
        errors.push(
          `No se pudo eliminar la carpeta temporal porque no quedó vacía: ${error.message}`,
        );
      }
    }
  }
  return { moved, returned, deletedFolders, deletedDestination, errors, moves };
}
async function undoMove(data) {
  validate(data.source, data.destination);
  const source = path.resolve(data.source);
  const destination = path.resolve(data.destination);
  let moved = 0;
  const errors = [];
  for (const record of data.moves) {
    const current = path.resolve(record.movedPath);
    const original = path.resolve(record.originalPath);
    const currentRelative = path.relative(destination, current);
    const currentSourceRelative = path.relative(source, current);
    const originalRelative = path.relative(source, original);
    const currentIsInDestination =
      !currentRelative.startsWith('..') && !path.isAbsolute(currentRelative);
    const currentIsInSource =
      !currentSourceRelative.startsWith('..') && !path.isAbsolute(currentSourceRelative);
    if (
      (!currentIsInDestination && !currentIsInSource) ||
      originalRelative.startsWith('..') ||
      path.isAbsolute(originalRelative)
    ) {
      errors.push(`${path.basename(current)}: ruta inválida`);
      continue;
    }
    try {
      if (same(current, original)) {
        moved++;
        continue;
      }
      await fs.mkdir(path.dirname(original), { recursive: true });
      const target = await targetPath(path.dirname(original), path.basename(original));
      try {
        await fs.rename(current, target);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        await fs.copyFile(current, target);
        await fs.unlink(current);
      }
      moved++;
    } catch (error) {
      errors.push(`${path.basename(current)}: ${error.message}`);
    }
  }
  return { moved, errors };
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 820,
    minHeight: 620,
    autoHideMenuBar: true,
    backgroundColor: '#f1f0eb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  process.argv.includes('--dev')
    ? win.loadURL('http://localhost:5173')
    : win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(() => {
  collectionManager = new CollectionManager(
    path.join(app.getPath('userData'), 'collections.sqlite'),
  );
  downloadManager = new DownloadManager(
    path.join(app.getPath('userData'), 'downloads.json'),
    (state) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('downloads:state', state);
    },
  );
  setInterval(() => {
    if (!downloadManager.settings.clipboard) return;
    const text = clipboard.readText();
    if (text !== lastClipboard && /https?:\/\//i.test(text)) {
      lastClipboard = text;
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('downloads:clipboard', text);
    }
  }, 1200).unref();
  ipcMain.handle('directory:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('mover:scan', (_e, data) => scan(data));
  ipcMain.handle('mover:move', (_e, data) => move(data));
  ipcMain.handle('mover:undo', (_e, data) => undoMove(data));
  ipcMain.handle('directory:create-child', async (_event, { source, name }) => {
    if (!source) throw new Error('Selecciona primero una carpeta de origen.');
    const normalized = name.trim();
    if (
      !normalized ||
      normalized === '.' ||
      normalized === '..' ||
      path.basename(normalized) !== normalized ||
      /[<>:"/\\|?*]/.test(normalized) ||
      /[. ]$/.test(normalized) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)
    )
      throw new Error('Ingresa un nombre de carpeta válido.');
    const destination = path.join(path.resolve(source), normalized);
    let created = false;
    try {
      await fs.access(destination);
    } catch {
      created = true;
    }
    await fs.mkdir(destination, { recursive: true });
    if (created) createdDestinationFolders.add(destination);
    return { path: destination, created };
  });
  ipcMain.handle('url:resolve', (_event, url) => resolveUrl(url));
  ipcMain.handle('url:open', async (_event, value) => {
    const url = await validatePublicUrl(value);
    await shell.openExternal(url.href);
    return true;
  });
  ipcMain.handle('downloads:state', () => downloadManager.snapshot());
  ipcMain.handle('downloads:analyze', (_event, text) => downloadManager.analyze(text));
  ipcMain.handle('downloads:add', (_event, items) => downloadManager.add(items));
  ipcMain.handle('downloads:update', (_event, { id, changes }) =>
    downloadManager.update(id, changes),
  );
  ipcMain.handle('downloads:control', (_event, { id, action }) =>
    downloadManager.control(id, action),
  );
  ipcMain.handle('downloads:clear-completed', () => downloadManager.clearCompleted());
  ipcMain.handle('downloads:settings', (_event, settings) => downloadManager.setSettings(settings));
  ipcMain.handle('downloads:retry-extraction', (_event, { id, password }) =>
    downloadManager.retryExtraction(id, password),
  );
  ipcMain.handle('downloads:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('downloads:show-file', (_event, filePath) => {
    if (filePath) shell.showItemInFolder(path.resolve(filePath));
    return true;
  });
  ipcMain.handle('collections:list', () => collectionManager.listCollections());
  ipcMain.handle('collections:create', (_event, data) => collectionManager.createCollection(data));
  ipcMain.handle('collections:update', (_event, { id, patch }) =>
    collectionManager.updateCollection(id, patch),
  );
  ipcMain.handle('collections:delete', (_event, id) => collectionManager.deleteCollection(id));
  ipcMain.handle('collections:column-types', () => COLUMN_TYPES);
  ipcMain.handle('collection-items:list', (_event, { collectionId, q }) =>
    collectionManager.listItems(collectionId, q),
  );
  ipcMain.handle('collection-items:create', (_event, data) => collectionManager.addItem(data));
  ipcMain.handle('collection-items:update', (_event, { id, patch }) =>
    collectionManager.updateItem(id, patch),
  );
  ipcMain.handle('collection-items:delete', (_event, id) => collectionManager.deleteItem(id));
  ipcMain.handle('collections:export', async (_event, id) => {
    const data = collectionManager.exportCollection(id);
    const result = await dialog.showSaveDialog({
      defaultPath: `${data.collection.name.replace(/[<>:"/\\|?*]/g, '_')}.json`,
      filters: [{ name: 'Colección CHUCK', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('collections:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Colección CHUCK', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const payload = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    return collectionManager.importCollection(payload, 'rename');
  });
  ipcMain.handle('wishlist:list', (_event, q) => collectionManager.listWishlist(q));
  ipcMain.handle('wishlist:create', (_event, data) => collectionManager.createWishlistItem(data));
  ipcMain.handle('wishlist:update', (_event, { id, patch }) =>
    collectionManager.updateWishlistItem(id, patch),
  );
  ipcMain.handle('wishlist:delete', (_event, id) => collectionManager.deleteWishlistItem(id));
  ipcMain.handle('wishlist-prices:create', async (_event, { wishlistId, data }) => {
    const source = collectionManager.addWishlistPrice(wishlistId, data);
    try {
      return collectionManager.updateWishlistPriceResult(source.id, await scrapePrice(source.url));
    } catch (error) {
      return collectionManager.updateWishlistPriceResult(source.id, { error: error.message });
    }
  });
  ipcMain.handle('wishlist-prices:delete', (_event, id) =>
    collectionManager.deleteWishlistPrice(id),
  );
  ipcMain.handle('wishlist-prices:refresh', async (_event, id) => {
    const source = collectionManager.getWishlistPrice(id);
    if (!source) throw new Error('La página de tienda no existe.');
    try {
      return collectionManager.updateWishlistPriceResult(id, await scrapePrice(source.url));
    } catch (error) {
      collectionManager.updateWishlistPriceResult(id, { error: error.message });
      throw error;
    }
  });
  ipcMain.handle('wishlist:refresh', async () => {
    const items = collectionManager.listWishlist();
    let updated = 0;
    let failed = 0;
    for (const source of items.flatMap((item) => item.prices)) {
      try {
        collectionManager.updateWishlistPriceResult(source.id, await scrapePrice(source.url));
        updated += 1;
      } catch (error) {
        collectionManager.updateWishlistPriceResult(source.id, { error: error.message });
        failed += 1;
      }
    }
    return { updated, failed, items: collectionManager.listWishlist() };
  });
  ipcMain.handle('rename:select-folders', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('rename:list', (_e, folders) => listFiles(folders || []));
  ipcMain.handle('rename:execute', (_e, data) => renameFile(data));
  ipcMain.handle('video:select-folders', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('video:inspect', (_event, { folders, codec }) =>
    Promise.all(folders.map((folder) => inspectFolder(path.resolve(folder), codec))),
  );
  ipcMain.handle('video:state', () => videoState);
  ipcMain.handle('video:start', async (_event, { folders, codec, trackSelections }) => {
    if (videoState.running) throw new Error('Ya hay una conversión de video en curso.');
    videoCancelled = false;
    videoCompletedFiles = 0;
    const inspectedFolders = await Promise.all(
      folders.map(async (folder) => {
        const absolute = path.resolve(folder);
        const info = await inspectFolder(absolute, codec);
        return info;
      }),
    );
    videoQueue = inspectedFolders.map((info) => ({
      folder: info.folder,
      total: info.videos.length,
    }));
    videoTotalFiles = videoQueue.reduce((total, item) => total + item.total, 0);
    videoState = {
      running: true,
      codec,
      folders: inspectedFolders,
      trackSelections,
      globalProgress: 0,
      fileProgress: 0,
      activeFile: 'Ningún archivo en proceso',
      activeFolder: '',
      logs: [],
    };
    emitVideoProgress({
      type: 'queue-progress',
      current: 0,
      total: videoTotalFiles,
    });
    while (videoQueue.length) {
      if (videoCancelled) break;
      const item = videoQueue.shift();
      const absolute = item.folder;
      activeVideoFolder = absolute;
      let completedInFolder = 0;
      emitVideoProgress({ type: 'folder-start', folder: absolute });
      try {
        await convertFolder(
          absolute,
          codec,
          trackSelections,
          (data) => {
            if (data.type === 'file-done') {
              completedInFolder += 1;
              videoCompletedFiles += 1;
              emitVideoProgress({
                type: 'queue-progress',
                current: videoCompletedFiles,
                total: videoTotalFiles,
              });
            }
            emitVideoProgress(data);
          },
          {
            isCancelled: () => videoCancelled,
            setProcess: (process) => {
              activeVideoProcess = process;
            },
          },
        );
        emitVideoProgress({ type: 'folder-done', folder: absolute });
      } catch (error) {
        videoTotalFiles -= Math.max(0, item.total - completedInFolder);
        emitVideoProgress({
          type: 'queue-progress',
          current: videoCompletedFiles,
          total: videoTotalFiles,
        });
        if (error.code !== 'CANCELLED')
          emitVideoProgress({
            type: 'error',
            folder: absolute,
            message: error.message,
          });
      }
      activeVideoFolder = '';
    }
    activeVideoProcess = null;
    activeVideoFolder = '';
    emitVideoProgress({ type: videoCancelled ? 'cancelled' : 'all-done' });
  });
  ipcMain.handle('video:cancel', () => {
    videoCancelled = true;
    if (activeVideoProcess && !activeVideoProcess.killed) {
      if (typeof activeVideoProcess.cancel === 'function') activeVideoProcess.cancel();
      else if (process.platform === 'win32')
        execFile('taskkill', ['/pid', String(activeVideoProcess.pid), '/T', '/F'], () => {});
      else activeVideoProcess.kill('SIGTERM');
    }
    return true;
  });
  ipcMain.handle('video:skip-folder', (_event, folder) => {
    const absolute = path.resolve(folder);
    if (absolute === activeVideoFolder) return false;
    const index = videoQueue.findIndex((item) => item.folder === absolute);
    if (index >= 0) {
      const [removed] = videoQueue.splice(index, 1);
      videoTotalFiles -= removed.total;
    }
    videoState.folders = videoState.folders.filter((item) => item.folder !== absolute);
    emitVideoProgress({
      type: 'queue-progress',
      current: videoCompletedFiles,
      total: videoTotalFiles,
    });
    return true;
  });
  ipcMain.handle('video:append-folders', async (_event, { folders, codec }) => {
    if (!videoState.running) return false;
    const known = new Set([activeVideoFolder, ...videoQueue.map((item) => item.folder)]);
    const additions = [];
    for (const folder of folders) {
      const absolute = path.resolve(folder);
      if (known.has(absolute)) continue;
      const info = await inspectFolder(absolute, codec);
      additions.push({ folder: absolute, total: info.videos.length, info });
      known.add(absolute);
    }
    videoQueue.push(...additions.map(({ folder, total }) => ({ folder, total })));
    videoState.folders.push(...additions.map(({ info }) => info));
    videoTotalFiles += additions.reduce((total, item) => total + item.total, 0);
    emitVideoProgress({
      type: 'queue-progress',
      current: videoCompletedFiles,
      total: videoTotalFiles,
    });
    return true;
  });
  ipcMain.handle('normalizer:select-folders', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('normalizer:scan', (_event, data) => scanMedia(data.folders, data.type));
  ipcMain.handle('normalizer:start', async (event, { files, type, targetDb }) => {
    normalizeCancelled = false;
    let completed = 0;
    for (const file of files) {
      if (normalizeCancelled) break;
      event.sender.send('normalizer:progress', {
        type: 'file-start',
        file: file.name,
        current: completed,
        total: files.length,
      });
      try {
        await normalizeMedia({
          input: file.path,
          type,
          targetDb,
          isCancelled: () => normalizeCancelled,
          onProcess: (process) => {
            activeNormalizeProcess = process;
          },
          onProgress: (percent) =>
            event.sender.send('normalizer:progress', {
              type: 'file-progress',
              file: file.name,
              percent,
            }),
        });
        completed += 1;
        event.sender.send('normalizer:progress', {
          type: 'file-done',
          file: file.name,
          current: completed,
          total: files.length,
        });
      } catch (error) {
        if (error.code !== 'CANCELLED')
          event.sender.send('normalizer:progress', {
            type: 'error',
            file: file.name,
            message: error.message,
          });
      }
    }
    activeNormalizeProcess = null;
    event.sender.send('normalizer:progress', {
      type: normalizeCancelled ? 'cancelled' : 'done',
      completed,
      total: files.length,
    });
  });
  ipcMain.handle('normalizer:cancel', () => {
    normalizeCancelled = true;
    if (activeNormalizeProcess && !activeNormalizeProcess.killed) {
      if (process.platform === 'win32')
        execFile('taskkill', ['/pid', String(activeNormalizeProcess.pid), '/T', '/F'], () => {});
      else activeNormalizeProcess.kill('SIGTERM');
    }
    return true;
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('before-quit', () => {
  if (collectionManager) {
    collectionManager.close();
    collectionManager = null;
  }
});
