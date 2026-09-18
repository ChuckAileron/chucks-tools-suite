const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { inspectFolder, convertFolder } = require('./videoConversion.cjs');
const { scanMedia, normalizeMedia } = require('./audioNormalizer.cjs');
let videoCancelled = false;
let activeVideoProcess = null;
let videoQueue = [];
let activeVideoFolder = '';
let videoCompletedFiles = 0;
let videoTotalFiles = 0;
let videoProgressSender = null;
let normalizeCancelled = false;
let activeNormalizeProcess = null;
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
  return { moved, deletedFolders, errors, moves };
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
    const originalRelative = path.relative(source, original);
    if (
      currentRelative.startsWith('..') ||
      path.isAbsolute(currentRelative) ||
      originalRelative.startsWith('..') ||
      path.isAbsolute(originalRelative)
    ) {
      errors.push(`${path.basename(current)}: ruta inválida`);
      continue;
    }
    try {
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
    await fs.mkdir(destination, { recursive: true });
    return destination;
  });
  ipcMain.handle('rename:list', async (_e, directory) => {
    if (!directory) return [];
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((x) => x.isFile())
      .map((x) => x.name);
  });
  ipcMain.handle('rename:execute', async (_e, { directory, oldName, newName }) => {
    if (!directory || !oldName || !newName || path.basename(newName) !== newName)
      throw new Error('Nombre de archivo inválido.');
    await fs.rename(path.join(directory, oldName), path.join(directory, newName));
    return true;
  });
  ipcMain.handle('video:select-folders', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('video:inspect', (_event, { folders, codec }) =>
    Promise.all(folders.map((folder) => inspectFolder(path.resolve(folder), codec))),
  );
  ipcMain.handle('video:start', async (event, { folders, codec, trackSelections }) => {
    videoCancelled = false;
    videoCompletedFiles = 0;
    videoProgressSender = event.sender;
    videoQueue = await Promise.all(
      folders.map(async (folder) => {
        const absolute = path.resolve(folder);
        const info = await inspectFolder(absolute, codec);
        return { folder: absolute, total: info.videos.length };
      }),
    );
    videoTotalFiles = videoQueue.reduce((total, item) => total + item.total, 0);
    event.sender.send('video:progress', {
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
      event.sender.send('video:progress', { type: 'folder-start', folder: absolute });
      try {
        await convertFolder(
          absolute,
          codec,
          trackSelections,
          (data) => {
            if (data.type === 'file-done') {
              completedInFolder += 1;
              videoCompletedFiles += 1;
              event.sender.send('video:progress', {
                type: 'queue-progress',
                current: videoCompletedFiles,
                total: videoTotalFiles,
              });
            }
            event.sender.send('video:progress', data);
          },
          {
            isCancelled: () => videoCancelled,
            setProcess: (process) => {
              activeVideoProcess = process;
            },
          },
        );
        event.sender.send('video:progress', { type: 'folder-done', folder: absolute });
      } catch (error) {
        videoTotalFiles -= Math.max(0, item.total - completedInFolder);
        event.sender.send('video:progress', {
          type: 'queue-progress',
          current: videoCompletedFiles,
          total: videoTotalFiles,
        });
        if (error.code !== 'CANCELLED')
          event.sender.send('video:progress', {
            type: 'error',
            folder: absolute,
            message: error.message,
          });
      }
      activeVideoFolder = '';
    }
    activeVideoProcess = null;
    activeVideoFolder = '';
    videoProgressSender = null;
    event.sender.send('video:progress', { type: videoCancelled ? 'cancelled' : 'all-done' });
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
      videoProgressSender?.send('video:progress', {
        type: 'queue-progress',
        current: videoCompletedFiles,
        total: videoTotalFiles,
      });
    }
    return true;
  });
  ipcMain.handle('video:append-folders', async (_event, { folders, codec }) => {
    if (!videoProgressSender) return false;
    const known = new Set([activeVideoFolder, ...videoQueue.map((item) => item.folder)]);
    const additions = [];
    for (const folder of folders) {
      const absolute = path.resolve(folder);
      if (known.has(absolute)) continue;
      const info = await inspectFolder(absolute, codec);
      additions.push({ folder: absolute, total: info.videos.length });
      known.add(absolute);
    }
    videoQueue.push(...additions);
    videoTotalFiles += additions.reduce((total, item) => total + item.total, 0);
    videoProgressSender?.send('video:progress', {
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
