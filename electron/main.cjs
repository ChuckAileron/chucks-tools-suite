const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { inspectFolder, convertFolder } = require('./videoConversion.cjs');
let videoCancelled = false;
let activeVideoProcess = null;
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
  const relative = path.relative(path.resolve(source), path.resolve(destination));
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    throw new Error('El destino no puede estar dentro del origen.');
}
async function scan({ source, types, customExtensions }) {
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
      if (entry.isDirectory()) await walk(absolute);
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
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  let deletedFolders = 0;
  if (data.deleteChildFolders) {
    for (const entry of await fs.readdir(root, { withFileTypes: true }))
      if (entry.isDirectory()) {
        await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
        deletedFolders++;
      }
  }
  return { moved, deletedFolders, errors };
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
    for (const folder of folders) {
      if (videoCancelled) break;
      const absolute = path.resolve(folder);
      event.sender.send('video:progress', { type: 'folder-start', folder: absolute });
      try {
        await convertFolder(
          absolute,
          codec,
          trackSelections,
          (data) => event.sender.send('video:progress', data),
          {
            isCancelled: () => videoCancelled,
            setProcess: (process) => {
              activeVideoProcess = process;
            },
          },
        );
        event.sender.send('video:progress', { type: 'folder-done', folder: absolute });
      } catch (error) {
        if (error.code !== 'CANCELLED')
          event.sender.send('video:progress', {
            type: 'error',
            folder: absolute,
            message: error.message,
          });
      }
    }
    activeVideoProcess = null;
    event.sender.send('video:progress', { type: videoCancelled ? 'cancelled' : 'all-done' });
  });
  ipcMain.handle('video:cancel', () => {
    videoCancelled = true;
    if (activeVideoProcess && !activeVideoProcess.killed) {
      if (process.platform === 'win32')
        execFile('taskkill', ['/pid', String(activeVideoProcess.pid), '/T', '/F'], () => {});
      else activeVideoProcess.kill('SIGTERM');
    }
    return true;
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
