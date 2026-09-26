const { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, screen, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { inspectFolder, convertFolder, killProcess } = require('./videoConversion.cjs');
const {
  scanMedia,
  normalizeMedia,
  measureLufs,
  LUFS_TOLERANCE,
  EXCERPT_DURATION,
  EXCERPT_MIN_SOURCE_DURATION,
} = require('./audioNormalizer.cjs');
const { validatePublicUrl } = require('./urlResolver.cjs');
const { DownloadManager } = require('./downloadManager.cjs');
const { RuleManager, applyRule } = require('./rules.cjs');
const { CollectionManager, COLUMN_TYPES } = require('./collectionManager.cjs');
const { WikiManager } = require('./wikiManager.cjs');
const { HijitosManager } = require('./hijitosManager.cjs');
const { scrapeProduct } = require('./priceScraper.cjs');
const { searchImages } = require('./imageSearch.cjs');
const analogReplay = require('./analogReplay.cjs');
const { listFiles, listFolders, renameFile } = require('./renameManager.cjs');
const hddInventory = require('./hddInventory.cjs');
const mediaPlayer = require('./mediaPlayer.cjs');
const trimTool = require('./trim.cjs');
const binderTrack = require('./binderTrack.cjs');
const launchboxMetadata = require('./launchboxMetadata.cjs');
const chuckbot = require('./chuckbot.cjs');
const imageConverter = require('./imageConverter.cjs');
// Esquema privilegiado usado para transmitir video/audio/imágenes desde un
// HDD catalogado directamente al reproductor, con soporte de rango (Range)
// para permitir búsqueda (seek). Debe registrarse antes de que la app esté
// lista.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hddmedia',
    privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let downloadManager;
let rulesManager;
let collectionManager;
let wikiManager;
let hijitosManager;
let hddManager;
let hddThumbnailsDir;
let binderManager;
let binderTrackMediaDir;
let launchboxBulkCancelled = false;
function emitLaunchBoxBulkProgress(data) {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('launchbox:bulk-progress', data);
}
let hddScanCancelled = false;
let hddScanState = {
  running: false,
  driveId: null,
  processed: 0,
  thumbnails: 0,
  current: '',
  error: '',
};
function emitHddScanState() {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('hdd:scan-state', hddScanState);
}
let lastClipboard = '';
function looksLikeDownloadText(text) {
  return (
    !!text &&
    (/https?:\/\//i.test(text) ||
      /(?:mediafire\.com\/(?:file|folder)|download\d*\.mediafire\.com|drive\.google\.com|mega\.(?:nz|io)|terabox\.(?:com|app)|1024terabox\.com)/i.test(
        text,
      ))
  );
}
const createdDestinationFolders = new Set();
// Concurrencia de conversión de video: la transcodificación con x264/x265 es
// CPU-bound y ya aprovecha todos los hilos por proceso, así que el paralelismo
// solo aporta cuando sobran núcleos. Se recomienda ~1 proceso por cada 4
// núcleos lógicos, con un tope conservador de 3.
const VIDEO_CONCURRENCY_LIMIT = 3;
const detectVideoConcurrency = (cores = os.cpus().length) =>
  Math.max(1, Math.min(VIDEO_CONCURRENCY_LIMIT, Math.floor(cores / 4)));
const parseConcurrencyPreference = (preference) => {
  if (preference === 'auto' || preference == null || preference === '') return 'auto';
  const parsed = Math.floor(Number(preference));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(VIDEO_CONCURRENCY_LIMIT, parsed)) : 'auto';
};
const resolveVideoConcurrency = (preference, cores = os.cpus().length) => {
  const normalized = parseConcurrencyPreference(preference);
  return normalized === 'auto' ? detectVideoConcurrency(cores) : normalized;
};
let videoCancelled = false;
let activeVideoProcesses = new Set();
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
  activeFile: 'Sin procesos activos',
  activeFolder: '',
  logs: [],
  normalizeAudio: false,
  normalizeTarget: -16,
  concurrencyPreference: 'auto',
  concurrency: detectVideoConcurrency(),
};
const parseVideoTarget = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -50 && parsed <= -5
    ? parsed
    : (videoState.normalizeTarget ?? -16);
};
let normalizeCancelled = false;
let activeNormalizeProcess = null;
let normalizeQueue = [];
// Estado del análisis de LUFS en segundo plano (independiente de la
// normalización en sí): permite cancelar las mediciones en curso y evita
// reintentar archivos indefinidamente si el usuario cancela.
let lufsCancelled = false;
const activeLufsProcesses = new Set();
function killLufsProcess(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32')
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGTERM');
}
let normalizeCompleted = 0;
let activeNormalizeFilePath = '';
let normalizeState = {
  running: false,
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Sin procesos activos',
  message: '',
  targetDb: -16,
  folders: [],
  type: 'audio',
  files: [],
  selected: [],
  processed: [],
  logs: [],
  activeFolder: '',
};
const parseTargetDb = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -50 && parsed <= -5
    ? parsed
    : (normalizeState.targetDb ?? -16);
};
let trimCancelled = false;
let activeTrimProcess = null;
let trimQueue = [];
let trimCompleted = 0;
let activeTrimFilePath = '';
let trimState = {
  running: false,
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Sin procesos activos',
  message: '',
  folders: [],
  type: 'audio',
  files: [],
  selected: [],
  processed: [],
  settings: {},
  logs: [],
  activeFolder: '',
};
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
    videoState.folders = videoState.folders.map((folder) =>
      folder.folder === data.folder
        ? {
            ...folder,
            videos: folder.videos.map((video) =>
              video.file === data.file ? { ...video, processed: true } : video,
            ),
          }
        : folder,
    );
    addLog(`${data.file} completado`, 'success');
  } else if (data.type === 'folder-done') {
    videoState.activeFolder = '';
    videoState.folders = videoState.folders.map((folder) =>
      folder.folder === data.folder
        ? {
            ...folder,
            processed: true,
            videos: folder.videos.map((video) => ({ ...video, processed: true })),
          }
        : folder,
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
function emitNormalizeProgress(data) {
  const addLog = (text, tone) => {
    normalizeState = {
      ...normalizeState,
      logs: [...(normalizeState.logs || []).slice(-99), { text, tone }],
    };
  };
  if (data.type === 'file-start') {
    normalizeState = {
      ...normalizeState,
      running: true,
      fileProgress: 0,
      activeFile: data.file || 'Archivo',
      activeFolder: data.folder || '',
      globalProgress: data.total ? Math.floor(((data.current || 0) / data.total) * 100) : 0,
      message: `Procesando ${data.file}`,
    };
    addLog(`Convirtiendo ${data.file}`);
  } else if (data.type === 'file-progress') {
    normalizeState = { ...normalizeState, fileProgress: data.percent || 0 };
  } else if (data.type === 'file-done') {
    normalizeState = {
      ...normalizeState,
      fileProgress: 100,
      globalProgress: data.total ? Math.floor(((data.current || 0) / data.total) * 100) : 0,
      message: `${data.file} completado`,
      processed: data.path
        ? [...new Set([...(normalizeState.processed || []), data.path])]
        : normalizeState.processed || [],
    };
    addLog(`✓ ${data.file} completado`, 'success');
  } else if (data.type === 'file-skipped') {
    normalizeState = {
      ...normalizeState,
      fileProgress: 100,
      globalProgress: data.total ? Math.floor(((data.current || 0) / data.total) * 100) : 0,
      message: `${data.file} ya está en el objetivo (${data.measuredLufs} LUFS), se omitió`,
      processed: data.path
        ? [...new Set([...(normalizeState.processed || []), data.path])]
        : normalizeState.processed || [],
    };
    addLog(
      `≈ ${data.file} ya está en ${data.measuredLufs} LUFS; se omitió su procesamiento`,
      'success',
    );
  } else if (data.type === 'error') {
    normalizeState = {
      ...normalizeState,
      message: `Error en ${data.file}: ${data.message}`,
    };
    addLog(`Error en ${data.file || 'archivo'}: ${data.message || ''}`, 'error');
  } else if (data.type === 'done') {
    normalizeState = {
      ...normalizeState,
      running: false,
      fileProgress: 100,
      globalProgress: 100,
      activeFolder: '',
      message: `${data.completed} archivos normalizados`,
    };
    addLog(`${data.completed} archivos normalizados.`, 'success');
  } else if (data.type === 'cancelled') {
    normalizeState = {
      ...normalizeState,
      running: false,
      fileProgress: 0,
      globalProgress: 0,
      activeFolder: '',
      message: 'Proceso cancelado',
    };
    addLog('Proceso cancelado.', 'error');
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('normalizer:progress', data);
    window.webContents.send('normalizer:state-changed', normalizeState);
  }
}
function emitTrimProgress(data) {
  const addLog = (text, tone) => {
    trimState = { ...trimState, logs: [...(trimState.logs || []).slice(-99), { text, tone }] };
  };
  if (data.type === 'file-start') {
    trimState = {
      ...trimState,
      running: true,
      fileProgress: 0,
      activeFile: data.file || 'Archivo',
      activeFolder: data.folder || '',
      globalProgress: data.total ? Math.floor(((data.current || 0) / data.total) * 100) : 0,
      message: `Procesando ${data.file}`,
    };
    addLog(`Cortando ${data.file}`);
  } else if (data.type === 'file-progress') {
    trimState = { ...trimState, fileProgress: data.percent || 0 };
  } else if (data.type === 'file-done') {
    trimState = {
      ...trimState,
      fileProgress: 100,
      globalProgress: data.total ? Math.floor(((data.current || 0) / data.total) * 100) : 0,
      message: `${data.file} completado`,
      processed: data.path
        ? [...new Set([...(trimState.processed || []), data.path])]
        : trimState.processed || [],
    };
    const outputNames = (data.outputs || []).map((output) => path.basename(output)).join(', ');
    addLog(`✓ ${data.file} completado → ${outputNames}`, 'success');
  } else if (data.type === 'error') {
    trimState = { ...trimState, message: `Error en ${data.file}: ${data.message}` };
    addLog(`Error en ${data.file || 'archivo'}: ${data.message || ''}`, 'error');
  } else if (data.type === 'done') {
    trimState = {
      ...trimState,
      running: false,
      fileProgress: 100,
      globalProgress: 100,
      activeFolder: '',
      message: `${data.completed} archivos recortados`,
    };
    addLog(`${data.completed} archivos recortados.`, 'success');
  } else if (data.type === 'cancelled') {
    trimState = {
      ...trimState,
      running: false,
      fileProgress: 0,
      globalProgress: 0,
      activeFolder: '',
      message: 'Proceso cancelado',
    };
    addLog('Proceso cancelado.', 'error');
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('trim:progress', data);
    window.webContents.send('trim:state-changed', trimState);
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
// ── Tamaño y posición de la ventana ─────────────────────────────────────────
// Se persisten en window-state.json (userData) para que la app reabra con el
// mismo tamaño/posición/maximizado de la última sesión.
const DEFAULT_WINDOW_STATE = { width: 1440, height: 960, x: undefined, y: undefined, maximized: false };
function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadWindowState() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(windowStatePath(), 'utf8'));
    const state = { ...DEFAULT_WINDOW_STATE, ...saved };
    // Si la posición guardada quedó fuera de cualquier pantalla conectada
    // (p. ej. se desconectó un segundo monitor), se ignora para que la
    // ventana no se abra invisible fuera del área visible.
    if (typeof state.x === 'number' && typeof state.y === 'number') {
      const onScreen = screen.getAllDisplays().some((display) => {
        const area = display.workArea;
        return (
          state.x >= area.x &&
          state.y >= area.y &&
          state.x < area.x + area.width &&
          state.y < area.y + area.height
        );
      });
      if (!onScreen) {
        state.x = undefined;
        state.y = undefined;
      }
    }
    return state;
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}
function saveWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const state = { ...bounds, maximized: win.isMaximized() };
  try {
    fsSync.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fsSync.writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch {
    // Si no se puede escribir, la próxima sesión abre con el tamaño por defecto.
  }
}
function createWindow() {
  const state = loadWindowState();
  const win   = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
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
  if (state.maximized) win.maximize();
  // Debounce: resize/move disparan muchos eventos seguidos; se guarda solo
  // cuando el usuario deja de mover/redimensionar durante 400ms.
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState(win);
  });
  process.argv.includes('--dev')
    ? win.loadURL('http://localhost:5173')
    : win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(async () => {
    collectionManager = new CollectionManager(
      path.join(app.getPath('userData'), 'collections.sqlite'),
    );
    wikiManager = new WikiManager(path.join(app.getPath('userData'), 'wiki.sqlite'));
    hijitosManager = new HijitosManager(path.join(app.getPath('userData'), 'hijitos.sqlite'));
  hddThumbnailsDir = path.join(app.getPath('userData'), 'hdd-thumbnails');
  hddManager = new hddInventory.HddInventoryManager(
    path.join(app.getPath('userData'), 'hdd-inventory.sqlite'),
    hddThumbnailsDir,
  );
  binderTrackMediaDir = path.join(app.getPath('userData'), 'bindertrack-media');
  binderManager = new binderTrack.BinderTrackManager(
    path.join(app.getPath('userData'), 'bindertrack.sqlite'),
    binderTrackMediaDir,
  );
  rulesManager = new RuleManager(path.join(app.getPath('userData'), 'rules.json'));
  downloadManager = new DownloadManager(
    path.join(app.getPath('userData'), 'downloads.json'),
    (state) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('downloads:state', state);
    },
    rulesManager,
  );
  await downloadManager.recover();
  const { watcher, events } = require('./clipboardWatcher.cjs');
  events.on('change', async () => {
    if (!downloadManager.settings.clipboard) return;
    const text = await clipboard.readText();
    if (text !== lastClipboard && looksLikeDownloadText(text)) {
      lastClipboard = text;
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('downloads:clipboard', text);
    }
  });
  watcher.start();
  app.on('will-quit', () => watcher.stop());
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
  ipcMain.handle('url:open', async (_event, value) => {
    const url = await validatePublicUrl(value);
    await shell.openExternal(url.href);
    return true;
  });
  ipcMain.handle('downloads:state', () => downloadManager.snapshot());
  ipcMain.handle('downloads:analyze', (_event, text) => downloadManager.analyze(text));
  ipcMain.handle('downloads:video-quality-options', (_event, url) =>
    downloadManager.getVideoQualityOptions(url),
  );
  ipcMain.handle('downloads:add', (_event, items) => downloadManager.add(items));
  ipcMain.handle('downloads:update', (_event, { id, changes }) =>
    downloadManager.update(id, changes),
  );
  ipcMain.handle('downloads:control', (_event, { id, action }) =>
    downloadManager.control(id, action),
  );
  ipcMain.handle('downloads:control-many', (_event, { ids, action }) =>
    downloadManager.controlMany(ids, action),
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
  ipcMain.handle('downloads:show-directory', (_event, directory) => {
    if (directory) shell.openPath(path.resolve(directory));
    return true;
  });
  ipcMain.handle('downloads:disk-info', (_event, directory) => downloadManager.diskInfo(directory));
  ipcMain.handle('rules:list', () => rulesManager.list());
  ipcMain.handle('rules:save', (_event, rule) => rulesManager.save(rule));
  ipcMain.handle('rules:delete', (_event, id) => rulesManager.remove(id));
  ipcMain.handle('rules:preview', (_event, { name, operations }) =>
    applyRule(operations || [], String(name || 'archivo.rar')),
  );
  ipcMain.handle('collections:list', () => collectionManager.listCollections());
  ipcMain.handle('collections:create', (_event, data) => collectionManager.createCollection(data));
  ipcMain.handle('collections:update', (_event, { id, patch }) =>
    collectionManager.updateCollection(id, patch),
  );
  ipcMain.handle('collections:delete', (_event, id) => collectionManager.deleteCollection(id));
  ipcMain.handle('collections:reorder', (_event, ids) => collectionManager.reorderCollections(ids));
  ipcMain.handle('collections:column-types', () => COLUMN_TYPES);
  ipcMain.handle('wiki:list', (_event, query) => wikiManager.listPages(query));
  ipcMain.handle('wiki:categories', () => wikiManager.categories());
  ipcMain.handle('wiki:stats', () => wikiManager.stats());
  ipcMain.handle('wiki:get', (_event, id) => wikiManager.getPage(id));
  ipcMain.handle('wiki:create', (_event, data) => wikiManager.createPage(data));
  ipcMain.handle('wiki:update', (_event, { id, patch }) => wikiManager.updatePage(id, patch));
  ipcMain.handle('wiki:delete', (_event, id) => wikiManager.deletePage(id));
  ipcMain.handle('hijitos:list', () => hijitosManager.listTracks());
  ipcMain.handle('hijitos:get-banner', () => hijitosManager.getBanner());
  ipcMain.handle('hijitos:set-banner', (_event, banner) => hijitosManager.setBanner(banner));
  ipcMain.handle('hijitos:update-track', (_event, { slug, patch }) =>
    hijitosManager.updateTrack(slug, patch),
  );
  ipcMain.handle('hijitos:create-task', (_event, data) => hijitosManager.createTask(data));
  ipcMain.handle('images:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: imageConverter.INPUT_EXTENSIONS }],
    });
    if (result.canceled) return [];
    return result.filePaths.filter((filePath) => imageConverter.isSupportedImage(filePath));
  });
  ipcMain.handle('images:convert', async (_event, { format, files }) => {
    const selectedFormat = String(format ?? '');
    const validFiles     = Array.isArray(files) ? files.filter((file) => typeof file === 'string') : [];
    if (!imageConverter.isSupportedOutput(selectedFormat)) {
      throw new Error('El formato de salida no es soportado.');
    }
    const results = [];
    for (const filePath of validFiles) {
      try {
        const output = await imageConverter.convertFile(filePath, selectedFormat);
        results.push({ input: filePath, output, ok: true });
      } catch (error) {
        results.push({
          input: filePath,
          output: null,
          ok: false,
          error: (error && error.message) || String(error),
        });
      }
    }
    return { format: selectedFormat, results };
  });
  ipcMain.handle('hijitos:update-task', (_event, { id, patch }) =>
    hijitosManager.updateTask(id, patch),
  );
  ipcMain.handle('hijitos:delete-task', (_event, id) => hijitosManager.deleteTask(id));
  ipcMain.handle('hijitos:create-subtask', (_event, { taskId, description }) =>
    hijitosManager.createSubtask(taskId, description),
  );
  ipcMain.handle('hijitos:update-subtask', (_event, { id, patch }) =>
    hijitosManager.updateSubtask(id, patch),
  );
  ipcMain.handle('hijitos:delete-subtask', (_event, id) => hijitosManager.deleteSubtask(id));
  ipcMain.handle('hijitos:select-banner', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Imágenes',
          extensions: [...imageConverter.INPUT_EXTENSIONS, 'svg', 'bmp'],
        },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  // Lee un banner local y lo entrega como data URL re-codificada, de modo que
  // cualquier formato soportado se muestre en el renderer sin depender de los
  // codecs del navegador.
  ipcMain.handle('hijitos:read-banner', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return null;
    try {
      return await imageConverter.previewDataUrl(filePath);
    } catch {
      return null;
    }
  });
  ipcMain.handle('collection-items:list', (_event, { collectionId, q }) =>
    collectionManager.listItems(collectionId, q),
  );
  ipcMain.handle('collection-items:create', (_event, data) => collectionManager.addItem(data));
  ipcMain.handle('collection-items:update', (_event, { id, patch }) =>
    collectionManager.updateItem(id, patch),
  );
  ipcMain.handle('collection-items:delete', (_event, id) => collectionManager.deleteItem(id));
  ipcMain.handle(
    'launchbox:single',
    async (_event, { collectionId, platformColumn, name, platform }) => {
      const items = collectionManager.listItems(collectionId);
      const { matched } = launchboxMetadata.matchRowsToItems({
        items,
        rows: [{ name, platform }],
        platformColumn,
      });
      const item = matched[0] || null;
      const search = await launchboxMetadata.searchGameMetadata({ name, platform });
      return {
        inCollection: !!item,
        itemId: item ? item.id : null,
        found: search.found,
        title: search.title || '',
        platformLabel: search.platform || '',
        metadata: search.metadata || null,
      };
    },
  );
  ipcMain.handle('launchbox:apply-one', (_event, { mapping, itemId, metadata }) => {
    const current = collectionManager.getItem(itemId);
    if (!current) throw new Error(`No existe el ítem ${itemId}`);
    return collectionManager.updateItem(
      itemId,
      launchboxMetadata.buildItemPatch({ current, mapping, metadata }),
    );
  });
  ipcMain.handle('launchbox:select-csv', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const parsed = launchboxMetadata.parseCsv(await fs.readFile(filePath, 'utf8'));
    const keys = launchboxMetadata.detectCsvKeyColumns(parsed.headers);
    if (!keys)
      throw new Error(
        'El CSV debe tener columnas de "nombre" y "plataforma" (p. ej. "Name" y "Platform").',
      );
    const rows = parsed.rows
      .map((row) => ({ name: row[keys.nameColumn], platform: row[keys.platformColumn] }))
      .filter((row) => String(row.name || '').trim() !== '');
    if (!rows.length) throw new Error('El CSV no contiene filas con nombre.');
    return { fileName: path.basename(filePath), rows };
  });
  ipcMain.handle('launchbox:match-rows', (_event, { collectionId, platformColumn, rows }) => {
    const items = collectionManager.listItems(collectionId);
    const { matched, missing } = launchboxMetadata.matchRowsToItems({
      items,
      rows,
      platformColumn,
    });
    return {
      matched: matched.map(({ name, platform, itemId }) => ({ name, platform, itemId })),
      missing: missing.map(({ name, platform }) => ({ name, platform })),
    };
  });
  ipcMain.handle('launchbox:bulk-search', async (_event, { rows }) => {
    launchboxBulkCancelled = false;
    const results = [];
    const total = rows.length;
    let current = 0;
    for (const row of rows) {
      if (launchboxBulkCancelled) break;
      emitLaunchBoxBulkProgress({
        type: 'progress',
        current,
        total,
        name: row.name,
        message: `Consultando "${row.name}"`,
      });
      let entry = { name: row.name, platform: row.platform, itemId: row.itemId, found: false };
      try {
        const search = await launchboxMetadata.searchGameMetadata(
          { name: row.name, platform: row.platform },
          () => launchboxBulkCancelled,
        );
        entry = {
          ...entry,
          found: search.found,
          title: search.title || '',
          platformLabel: search.platform || '',
          metadata: search.metadata || null,
        };
      } catch (error) {
        if (error.message === 'CANCELLED') break;
        entry.error = error.message;
      }
      results.push(entry);
      current += 1;
      emitLaunchBoxBulkProgress({
        type: 'item-done',
        current,
        total,
        name: row.name,
        found: entry.found,
      });
      if (!launchboxBulkCancelled && current < total)
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    emitLaunchBoxBulkProgress({
      type: launchboxBulkCancelled ? 'cancelled' : 'done',
      current,
      total,
    });
    return results;
  });
  ipcMain.handle('launchbox:bulk-cancel', () => {
    launchboxBulkCancelled = true;
    return true;
  });
  ipcMain.handle('launchbox:apply-bulk', (_event, { collectionId, mapping, results }) => {
    let applied = 0;
    let missing = 0;
    let skipped = 0;
    let failed = 0;
    for (const entry of results) {
      if (!entry.found || !entry.itemId) {
        skipped += 1;
        continue;
      }
      const current = collectionManager.getItem(entry.itemId);
      if (!current) {
        missing += 1;
        continue;
      }
      try {
        collectionManager.updateItem(
          entry.itemId,
          launchboxMetadata.buildItemPatch({ current, mapping, metadata: entry.metadata }),
        );
        applied += 1;
      } catch (error) {
        failed += 1;
      }
    }
    return { applied, missing, skipped, failed };
  });
  ipcMain.handle('launchbox:export-results', async (_event, { results }) => {
    const csv = launchboxMetadata.stringifyCsv(
      launchboxMetadata.buildResultCsvRows(results),
      launchboxMetadata.RESULT_CSV_HEADERS,
    );
    const save = await dialog.showSaveDialog({
      defaultPath: `launchbox-metadata-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (save.canceled || !save.filePath) return null;
    await fs.writeFile(save.filePath, csv, 'utf8');
    return save.filePath;
  });
  ipcMain.handle('launchbox:apply-results-csv', async (_event, { collectionId, mapping }) => {
    const open = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (open.canceled || !open.filePaths[0]) return null;
    const filePath = open.filePaths[0];
    const parsed = launchboxMetadata.parseCsv(await fs.readFile(filePath, 'utf8'));
    const keys = launchboxMetadata.detectCsvKeyColumns(parsed.headers);
    if (!keys)
      throw new Error(
        'El CSV debe tener columnas de "nombre" y "plataforma" (p. ej. "Name" y "Platform").',
      );
    const metadataCols = launchboxMetadata.detectMetadataColumns(parsed.headers);
    const rows = parsed.rows.map((row) => ({
      name: row[keys.nameColumn],
      platform: row[keys.platformColumn],
      metadata: {
        boxartUrl: metadataCols.boxartColumn ? row[metadataCols.boxartColumn] || '' : '',
        releaseDate: metadataCols.releaseDateColumn
          ? row[metadataCols.releaseDateColumn] || ''
          : '',
        publisher: metadataCols.publisherColumn ? row[metadataCols.publisherColumn] || '' : '',
        developer: metadataCols.developerColumn ? row[metadataCols.developerColumn] || '' : '',
      },
    }));
    const items = collectionManager.listItems(collectionId);
    let applied = 0;
    let missing = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      if (String(row.name || '').trim() === '') continue;
      const { matched } = launchboxMetadata.matchRowsToItems({
        items,
        rows: [{ name: row.name, platform: row.platform }],
        platformColumn: mapping.platformColumn,
      });
      const item = matched[0];
      if (!item) {
        missing += 1;
        continue;
      }
      if (
        !row.metadata.boxartUrl &&
        !row.metadata.releaseDate &&
        !row.metadata.publisher &&
        !row.metadata.developer
      ) {
        skipped += 1;
        continue;
      }
      try {
        collectionManager.updateItem(
          item.id,
          launchboxMetadata.buildItemPatch({ current: item, mapping, metadata: row.metadata }),
        );
        applied += 1;
      } catch (error) {
        failed += 1;
      }
    }
    return { fileName: path.basename(filePath), applied, missing, skipped, failed };
  });
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
  ipcMain.handle('images:search', (_event, data) => searchImages(data || {}));
  ipcMain.handle('analog:channels:list', () => analogReplay.listChannels());
  ipcMain.handle('analog:channels:create', (_event, data) => analogReplay.createChannel(data));
  ipcMain.handle('analog:channels:update', (_event, { id, patch }) =>
    analogReplay.updateChannel(id, patch),
  );
  ipcMain.handle('analog:channels:delete', (_event, id) => analogReplay.deleteChannel(id));
  ipcMain.handle('analog:shows:list', () => analogReplay.listShows());
  ipcMain.handle('analog:shows:create', (_event, data) => analogReplay.createShow(data));
  ipcMain.handle('analog:shows:update', (_event, { id, patch }) =>
    analogReplay.updateShow(id, patch),
  );
  ipcMain.handle('analog:shows:delete', (_event, id) => analogReplay.deleteShow(id));
  ipcMain.handle('analog:select-json', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('analog:channels:import', (_event, filePath) =>
    analogReplay.importChannelsFile(filePath),
  );
  ipcMain.handle('analog:shows:import', (_event, filePath) =>
    analogReplay.importShowFile(filePath),
  );
  ipcMain.handle('analog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('analog:folder-videos', (_event, folderPath) =>
    analogReplay.getFolderVideos(folderPath),
  );
  ipcMain.handle('analog:folder-match', (_event, { folderPath, episodes }) =>
    analogReplay.matchFolderEpisodes(folderPath, episodes),
  );
  ipcMain.handle('analog:schedule:status', () => analogReplay.scheduleStatus());
  ipcMain.handle('analog:schedule:config', () => analogReplay.loadScheduleConfig());
  ipcMain.handle('analog:schedule:generate', (_event, year) => analogReplay.generateYear(year));
  ipcMain.handle('analog:schedule:month', (_event, { year, month }) =>
    analogReplay.getMonthSchedule(year, month),
  );
  ipcMain.handle('analog:schedule:reset', () => analogReplay.resetSchedule());
  ipcMain.handle('wishlist:list', (_event, q) => collectionManager.listWishlist(q));
  ipcMain.handle('wishlist:create', (_event, data) => collectionManager.createWishlistItem(data));
  ipcMain.handle('wishlist:update', (_event, { id, patch }) =>
    collectionManager.updateWishlistItem(id, patch),
  );
  ipcMain.handle('wishlist:delete', (_event, id) => collectionManager.deleteWishlistItem(id));
  ipcMain.handle('wishlist-prices:create', async (_event, { wishlistId, data }) => {
    const source = collectionManager.addWishlistPrice(wishlistId, data);
    try {
      return collectionManager.updateWishlistPriceResult(source.id, await scrapeProduct(source.url));
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
      const result = await scrapeProduct(source.url);
      collectionManager.updateWishlistPriceResult(id, result);
      if (result.error) throw new Error(result.error);
      return collectionManager.getWishlistPrice(id);
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
        const result = await scrapeProduct(source.url);
        collectionManager.updateWishlistPriceResult(source.id, result);
        if (result.error) failed += 1;
        else updated += 1;
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
  ipcMain.handle('rename:list-folders', (_e, folders) => listFolders(folders || []));
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
  ipcMain.handle('video:capacity', () => ({
    cores: os.cpus().length,
    detected: detectVideoConcurrency(),
    max: VIDEO_CONCURRENCY_LIMIT,
  }));
  ipcMain.handle('video:set-concurrency', (_event, preference) => {
    videoState.concurrencyPreference = parseConcurrencyPreference(preference);
    videoState.concurrency = resolveVideoConcurrency(videoState.concurrencyPreference);
    return true;
  });
  ipcMain.handle(
    'video:start',
    async (
      _event,
      {
        folders,
        codec,
        trackSelections,
        normalizeAudio = false,
        normalizeTarget = -16,
        concurrency = 'auto',
      },
    ) => {
      if (videoState.running) throw new Error('Ya hay una conversión de video en curso.');
      videoCancelled = false;
      activeVideoProcesses.clear();
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
        activeFile: 'Sin procesos activos',
        activeFolder: '',
        logs: [],
        normalizeAudio: !!normalizeAudio,
        normalizeTarget,
        concurrencyPreference: parseConcurrencyPreference(concurrency),
        concurrency: resolveVideoConcurrency(concurrency),
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
              processes: activeVideoProcesses,
            },
            videoState.normalizeAudio
              ? { normalize: true, targetDb: videoState.normalizeTarget }
              : null,
            videoState.concurrency,
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
      activeVideoProcesses.clear();
      activeVideoFolder = '';
      emitVideoProgress({ type: videoCancelled ? 'cancelled' : 'all-done' });
    },
  );
  ipcMain.handle('video:cancel', () => {
    videoCancelled = true;
    for (const active of activeVideoProcesses) killProcess(active);
    activeVideoProcesses.clear();
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
  ipcMain.handle('video:clear', () => {
    if (videoState.running) return false;
    videoQueue = [];
    activeVideoFolder = '';
    videoCompletedFiles = 0;
    videoTotalFiles = 0;
    videoState = {
      ...videoState,
      folders: [],
      trackSelections: {},
      globalProgress: 0,
      fileProgress: 0,
      activeFile: 'Sin procesos activos',
      activeFolder: '',
      logs: [],
    };
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('video:state-changed', videoState);
    return true;
  });
  ipcMain.handle('video:set-normalize', (_event, { normalizeAudio, normalizeTarget }) => {
    if (typeof normalizeAudio === 'boolean') videoState.normalizeAudio = normalizeAudio;
    if (typeof normalizeTarget === 'number')
      videoState.normalizeTarget = parseVideoTarget(normalizeTarget);
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
  ipcMain.handle('normalizer:scan', async (_event, data) => {
    // Un nuevo listado habilita de nuevo el cálculo de LUFS por si el
    // usuario había cancelado el análisis de una exploración anterior.
    lufsCancelled = false;
    const files = await scanMedia(data.folders, data.type);
    normalizeState = {
      ...normalizeState,
      running: false,
      folders: data.folders,
      type: data.type,
      files,
      selected: files.map((file) => file.path),
      processed: files.filter((file) => file.processed).map((file) => file.path),
    };
    return files;
  });
  ipcMain.handle('normalizer:measure-lufs', async (_event, filePath) => {
    if (lufsCancelled) return null;
    const attemptMeasure = () => {
      let activeChild = null;
      return measureLufs(
        filePath,
        () => lufsCancelled,
        (child) => {
          if (child) {
            activeChild = child;
            activeLufsProcesses.add(child);
          } else if (activeChild) {
            activeLufsProcesses.delete(activeChild);
            activeChild = null;
          }
        },
      );
    };
    let lufs = null;
    try {
      lufs = await attemptMeasure();
    } catch (error) {
      // Un solo reintento automático: con muchos archivos en paralelo, un
      // spawn de FFmpeg puede fallar de forma transitoria (antivirus,
      // saturación momentánea de procesos, etc.). Si el archivo realmente no
      // tiene pista de audio o está dañado, el reintento también fallará y
      // quedará marcado como "Sin medir".
      if (error.code === 'CANCELLED' || lufsCancelled) lufs = null;
      else {
        try {
          lufs = await attemptMeasure();
        } catch {
          lufs = null;
        }
      }
    }
    // Se guarda el resultado (incluso null tras un fallo o cancelación) para
    // no reintentar el mismo archivo en un bucle infinito.
    normalizeState = {
      ...normalizeState,
      files: normalizeState.files.map((file) =>
        file.path === filePath ? { ...file, lufs } : file,
      ),
    };
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('normalizer:state-changed', normalizeState);
    return lufs;
  });
  ipcMain.handle('normalizer:cancel-lufs-scan', () => {
    lufsCancelled = true;
    for (const child of activeLufsProcesses) killLufsProcess(child);
    activeLufsProcesses.clear();
    return true;
  });
  ipcMain.handle('normalizer:resume-lufs', () => {
    lufsCancelled = false;
    return true;
  });
  ipcMain.handle('normalizer:config', () => ({
    lufsTolerance: LUFS_TOLERANCE,
    excerptDuration: EXCERPT_DURATION,
    excerptMinDuration: EXCERPT_MIN_SOURCE_DURATION,
  }));
  ipcMain.handle('normalizer:state', () => normalizeState);
  ipcMain.handle('normalizer:set-target', (_event, targetDb) => {
    normalizeState = { ...normalizeState, targetDb: parseTargetDb(targetDb) };
    return normalizeState.targetDb;
  });
  ipcMain.handle('normalizer:set-ui', (_event, data) => {
    const next = { ...normalizeState };
    if (Array.isArray(data?.folders)) next.folders = data.folders;
    if (data?.type === 'audio' || data?.type === 'video') next.type = data.type;
    if (Array.isArray(data?.files)) next.files = data.files;
    if (Array.isArray(data?.selected)) next.selected = data.selected;
    if (Array.isArray(data?.processed)) next.processed = data.processed;
    if (Array.isArray(data?.logs)) next.logs = data.logs;
    if (typeof data?.running === 'boolean') next.running = data.running;
    if (typeof data?.globalProgress === 'number') next.globalProgress = data.globalProgress;
    if (typeof data?.fileProgress === 'number') next.fileProgress = data.fileProgress;
    if (typeof data?.message === 'string') next.message = data.message;
    if (typeof data?.activeFile === 'string') next.activeFile = data.activeFile;
    if (typeof data?.activeFolder === 'string') next.activeFolder = data.activeFolder;
    normalizeState = next;
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('normalizer:state-changed', normalizeState);
    return true;
  });
  ipcMain.handle('normalizer:start', async (_event, { files, type, targetDb }) => {
    normalizeCancelled = false;
    activeNormalizeFilePath = '';
    normalizeQueue = [...files];
    normalizeCompleted = 0;
    normalizeState = {
      ...normalizeState,
      targetDb: parseTargetDb(targetDb),
      running: true,
      globalProgress: 0,
      fileProgress: 0,
      activeFile: 'Iniciando normalización',
      activeFolder: '',
      message: 'Iniciando normalización',
      selected: files.map((file) => file.path),
      logs: [],
    };
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('normalizer:state-changed', normalizeState);
    while (normalizeQueue.length) {
      if (normalizeCancelled) break;
      const file = normalizeQueue.shift();
      activeNormalizeFilePath = file.path;
      const total = normalizeCompleted + normalizeQueue.length + 1;
      emitNormalizeProgress({
        type: 'file-start',
        file: file.name,
        path: file.path,
        folder: file.folder,
        current: normalizeCompleted,
        total,
      });
      try {
        const result = await normalizeMedia({
          input: file.path,
          type,
          targetDb,
          knownLufs: Number.isFinite(file.lufs) ? file.lufs : undefined,
          isCancelled: () => normalizeCancelled,
          onProcess: (process) => {
            activeNormalizeProcess = process;
          },
          onProgress: (percent) =>
            emitNormalizeProgress({
              type: 'file-progress',
              file: file.name,
              path: file.path,
              percent,
            }),
        });
        normalizeCompleted += 1;
        emitNormalizeProgress(
          result.skipped
            ? {
                type: 'file-skipped',
                file: file.name,
                path: file.path,
                current: normalizeCompleted,
                total: normalizeCompleted + normalizeQueue.length,
                measuredLufs: result.measuredLufs,
              }
            : {
                type: 'file-done',
                file: file.name,
                path: file.path,
                current: normalizeCompleted,
                total: normalizeCompleted + normalizeQueue.length,
              },
        );
      } catch (error) {
        if (error.code !== 'CANCELLED')
          emitNormalizeProgress({
            type: 'error',
            file: file.name,
            message: error.message,
          });
      }
      activeNormalizeFilePath = '';
    }
    normalizeQueue = [];
    activeNormalizeProcess = null;
    emitNormalizeProgress({
      type: normalizeCancelled ? 'cancelled' : 'done',
      completed: normalizeCompleted,
      total: normalizeCompleted,
    });
  });
  ipcMain.handle('normalizer:skip-folder', (_event, folder) => {
    const activeFile = normalizeState.files.find((file) => file.path === activeNormalizeFilePath);
    if (normalizeState.running && activeFile && activeFile.folder === folder) return false;
    normalizeQueue = normalizeQueue.filter((file) => file.folder !== folder);
    const removed = new Set(
      normalizeState.files.filter((file) => file.folder === folder).map((file) => file.path),
    );
    normalizeState = {
      ...normalizeState,
      folders: normalizeState.folders.filter((item) => item !== folder),
      files: normalizeState.files.filter((file) => file.folder !== folder),
      selected: normalizeState.selected.filter((path) => !removed.has(path)),
      processed: normalizeState.processed.filter((path) => !removed.has(path)),
    };
    const remaining = normalizeCompleted + normalizeQueue.length;
    normalizeState = {
      ...normalizeState,
      globalProgress: remaining ? Math.floor((normalizeCompleted / remaining) * 100) : 100,
    };
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('normalizer:state-changed', normalizeState);
    return true;
  });
  ipcMain.handle('normalizer:cancel', () => {
    normalizeCancelled = true;
    normalizeQueue = [];
    if (activeNormalizeProcess && !activeNormalizeProcess.killed) {
      if (process.platform === 'win32')
        execFile('taskkill', ['/pid', String(activeNormalizeProcess.pid), '/T', '/F'], () => {});
      else activeNormalizeProcess.kill('SIGTERM');
    }
    return true;
  });
  // --- Cortar audio/video --------------------------------------------------
  ipcMain.handle('trim:select-folders', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('trim:scan', async (_event, data) => {
    const files = await trimTool.scanMedia(data.folders, data.type);
    trimState = {
      ...trimState,
      running: false,
      folders: data.folders,
      type: data.type,
      files,
      selected: files.map((file) => file.path),
      processed: [],
    };
    return files;
  });
  ipcMain.handle('trim:state', () => trimState);
  ipcMain.handle('trim:set-ui', (_event, data) => {
    const next = { ...trimState };
    if (Array.isArray(data?.folders)) next.folders = data.folders;
    if (data?.type === 'audio' || data?.type === 'video') next.type = data.type;
    if (Array.isArray(data?.files)) next.files = data.files;
    if (Array.isArray(data?.selected)) next.selected = data.selected;
    if (Array.isArray(data?.processed)) next.processed = data.processed;
    if (data?.settings && typeof data.settings === 'object') next.settings = data.settings;
    if (Array.isArray(data?.logs)) next.logs = data.logs;
    if (typeof data?.running === 'boolean') next.running = data.running;
    if (typeof data?.globalProgress === 'number') next.globalProgress = data.globalProgress;
    if (typeof data?.fileProgress === 'number') next.fileProgress = data.fileProgress;
    if (typeof data?.message === 'string') next.message = data.message;
    if (typeof data?.activeFile === 'string') next.activeFile = data.activeFile;
    if (typeof data?.activeFolder === 'string') next.activeFolder = data.activeFolder;
    trimState = next;
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('trim:state-changed', trimState);
    return true;
  });
  ipcMain.handle('trim:start', async (_event, { jobs, type }) => {
    trimCancelled = false;
    activeTrimFilePath = '';
    trimQueue = [...jobs];
    trimCompleted = 0;
    trimState = {
      ...trimState,
      running: true,
      globalProgress: 0,
      fileProgress: 0,
      activeFile: 'Iniciando recorte',
      activeFolder: '',
      message: 'Iniciando recorte',
      logs: [],
    };
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('trim:state-changed', trimState);
    while (trimQueue.length) {
      if (trimCancelled) break;
      const job = trimQueue.shift();
      activeTrimFilePath = job.path;
      const total = trimCompleted + trimQueue.length + 1;
      const fileRecord = trimState.files.find((file) => file.path === job.path);
      const duration = fileRecord ? fileRecord.duration : 0;
      emitTrimProgress({
        type: 'file-start',
        file: job.name,
        path: job.path,
        folder: job.folder,
        current: trimCompleted,
        total,
      });
      try {
        const result = await trimTool.trimMedia({
          input: job.path,
          type,
          mode: job.mode,
          start: job.start,
          end: job.end,
          duration,
          split: job.split,
          isCancelled: () => trimCancelled,
          onProcess: (childProcess) => {
            activeTrimProcess = childProcess;
          },
          onProgress: (percent) =>
            emitTrimProgress({
              type: 'file-progress',
              file: job.name,
              path: job.path,
              percent,
            }),
        });
        trimCompleted += 1;
        emitTrimProgress({
          type: 'file-done',
          file: job.name,
          path: job.path,
          current: trimCompleted,
          total: trimCompleted + trimQueue.length,
          outputs: result.outputs,
        });
      } catch (error) {
        if (error.code !== 'CANCELLED')
          emitTrimProgress({ type: 'error', file: job.name, message: error.message });
      }
      activeTrimFilePath = '';
    }
    trimQueue = [];
    activeTrimProcess = null;
    emitTrimProgress({
      type: trimCancelled ? 'cancelled' : 'done',
      completed: trimCompleted,
      total: trimCompleted,
    });
  });
  ipcMain.handle('trim:skip-folder', (_event, folder) => {
    const activeFile = trimState.files.find((file) => file.path === activeTrimFilePath);
    if (trimState.running && activeFile && activeFile.folder === folder) return false;
    trimQueue = trimQueue.filter((job) => job.folder !== folder);
    const removed = new Set(
      trimState.files.filter((file) => file.folder === folder).map((file) => file.path),
    );
    const nextSettings = { ...trimState.settings };
    for (const filePath of removed) delete nextSettings[filePath];
    trimState = {
      ...trimState,
      folders: trimState.folders.filter((item) => item !== folder),
      files: trimState.files.filter((file) => file.folder !== folder),
      selected: trimState.selected.filter((filePath) => !removed.has(filePath)),
      processed: trimState.processed.filter((filePath) => !removed.has(filePath)),
      settings: nextSettings,
    };
    const remaining = trimCompleted + trimQueue.length;
    trimState = {
      ...trimState,
      globalProgress: remaining ? Math.floor((trimCompleted / remaining) * 100) : 100,
    };
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('trim:state-changed', trimState);
    return true;
  });
  ipcMain.handle('trim:cancel', () => {
    trimCancelled = true;
    trimQueue = [];
    if (activeTrimProcess && !activeTrimProcess.killed) {
      if (process.platform === 'win32')
        execFile('taskkill', ['/pid', String(activeTrimProcess.pid), '/T', '/F'], () => {});
      else activeTrimProcess.kill('SIGTERM');
    }
    return true;
  });
  // --- Inventario HDD -----------------------------------------------------
  const decorateDrive = (drive, volumes) => {
    const connection = hddInventory.resolveConnection(drive, volumes);
    if (connection.connected)
      hddManager.touchDriveConnection(drive.id, {
        volumeId: connection.volume.volumeId,
        volumeLabel: connection.volume.label,
        totalBytes: connection.volume.totalBytes,
        mountPoint: connection.volume.mountPoint,
      });
    return {
      ...drive,
      connected: connection.connected,
      mountPoint: connection.mountPoint,
      stats: hddManager.countEntries(drive.id),
    };
  };
  ipcMain.handle('hdd:select-root', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('hdd:list-volumes', () => hddInventory.listSystemVolumes());
  ipcMain.handle('hdd:list', async () => {
    const volumes = await hddInventory.listSystemVolumes();
    return hddManager.listDrives().map((drive) => decorateDrive(drive, volumes));
  });
  ipcMain.handle('hdd:register', async (_event, { rootPath, code, label }) => {
    const volumes = await hddInventory.listSystemVolumes();
    const root = hddInventory.driveRootFromPath(rootPath);
    const matched = volumes.find((v) => path.resolve(v.mountPoint) === path.resolve(root));
    const drive = hddManager.registerDrive({
      code,
      label,
      volumeId: matched?.volumeId || null,
      volumeLabel: matched?.label || '',
      totalBytes: matched?.totalBytes || 0,
      mountPoint: root,
    });
    return decorateDrive(drive, volumes);
  });
  ipcMain.handle('hdd:update', async (_event, { id, patch }) => {
    const drive = hddManager.updateDrive(id, patch || {});
    const volumes = await hddInventory.listSystemVolumes();
    return decorateDrive(drive, volumes);
  });
  ipcMain.handle('hdd:remove', (_event, id) => {
    const removed = hddManager.deleteDrive(id);
    fsSync.rmSync(path.join(hddThumbnailsDir, String(id)), { recursive: true, force: true });
    return removed;
  });
  ipcMain.handle('hdd:entries', (_event, { driveId, parentPath }) =>
    hddManager.listEntries(driveId, parentPath || ''),
  );
  ipcMain.handle('hdd:entry', (_event, id) => hddManager.getEntry(id));
  ipcMain.handle('hdd:search', (_event, { driveId, query }) =>
    hddManager.searchEntries(driveId, query),
  );
  ipcMain.handle('hdd:descendant-count', (_event, { driveId, entryId }) => {
    const entry = hddManager.getEntry(entryId);
    if (!entry || entry.driveId !== driveId || !entry.isDirectory) return 0;
    return hddManager.descendantsOf(driveId, entry.relativePath).length;
  });
  ipcMain.handle('hdd:show-in-folder', async (_event, { driveId, entryId }) => {
    const entry = hddManager.getEntry(entryId);
    if (!entry || entry.driveId !== driveId) throw new Error('El elemento no existe en este HDD.');
    const drive = hddManager.getDrive(driveId);
    const volumes = await hddInventory.listSystemVolumes();
    const connection = hddInventory.resolveConnection(drive, volumes);
    if (!connection.connected)
      throw new Error('El HDD no está conectado; no se puede abrir la carpeta real.');
    const absolute = path.join(connection.mountPoint, entry.relativePath);
    shell.showItemInFolder(absolute);
    return true;
  });
  ipcMain.handle('hdd:thumbnail', async (_event, entryId) => {
    const thumbnailPath = hddManager.getThumbnailFile(entryId);
    if (!thumbnailPath || !fsSync.existsSync(thumbnailPath)) return null;
    const data = await fs.readFile(thumbnailPath);
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  });
  ipcMain.handle('hdd:rename', async (_event, { driveId, entryId, newName, applyToDisk }) => {
    const entry = hddManager.getEntry(entryId);
    if (!entry || entry.driveId !== driveId) throw new Error('El elemento no existe en este HDD.');
    if (applyToDisk) {
      const drive = hddManager.getDrive(driveId);
      const volumes = await hddInventory.listSystemVolumes();
      const connection = hddInventory.resolveConnection(drive, volumes);
      if (!connection.connected)
        throw new Error('El HDD no está conectado; no se puede renombrar el archivo real.');
      const oldAbsolute = path.join(connection.mountPoint, entry.relativePath);
      const newAbsolute = path.join(connection.mountPoint, entry.parentPath, newName);
      await fs.rename(oldAbsolute, newAbsolute);
    }
    return hddManager.renameEntryInDb(driveId, entryId, newName);
  });
  ipcMain.handle('hdd:scan-state', () => hddScanState);
  ipcMain.handle('hdd:cancel-scan', () => {
    hddScanCancelled = true;
    return true;
  });
  ipcMain.handle('hdd:start-scan', async (_event, driveId) => {
    if (hddScanState.running) throw new Error('Ya hay un análisis de HDD en curso.');
    const drive = hddManager.getDrive(driveId);
    if (!drive) throw new Error('El HDD no existe.');
    const volumes = await hddInventory.listSystemVolumes();
    const connection = hddInventory.resolveConnection(drive, volumes);
    if (!connection.connected) throw new Error('El HDD no está conectado.');
    if (connection.volume)
      hddManager.touchDriveConnection(drive.id, {
        volumeId: connection.volume.volumeId,
        volumeLabel: connection.volume.label,
        totalBytes: connection.volume.totalBytes,
        mountPoint: connection.volume.mountPoint,
      });
    hddScanCancelled = false;
    hddScanState = { running: true, driveId, processed: 0, thumbnails: 0, current: '', error: '' };
    emitHddScanState();
    (async () => {
      try {
        await hddInventory.scanDrive({
          manager: hddManager,
          driveId,
          mountPoint: connection.mountPoint,
          isCancelled: () => hddScanCancelled,
          onProgress: ({ processed, thumbnails, current }) => {
            hddScanState = { ...hddScanState, processed, thumbnails, current };
            emitHddScanState();
          },
        });
      } catch (error) {
        hddScanState = { ...hddScanState, error: error.message };
      } finally {
        hddScanState = { ...hddScanState, running: false };
        emitHddScanState();
      }
    })();
    return true;
  });
  // --- Reproductor de media --------------------------------------------
  protocol.handle(
    'hddmedia',
    mediaPlayer.createStreamHandler({
      getEntry: (id) => hddManager.getEntry(id),
      getDrive: (id) => hddManager.getDrive(id),
      resolveConnection: async (drive) => {
        const volumes = await hddInventory.listSystemVolumes();
        return hddInventory.resolveConnection(drive, volumes);
      },
    }),
  );
  ipcMain.handle('media:document-text', async (_event, { driveId, entryId }) => {
    const entry = hddManager.getEntry(entryId);
    if (!entry || entry.driveId !== driveId) throw new Error('El elemento no existe en este HDD.');
    const drive = hddManager.getDrive(driveId);
    const volumes = await hddInventory.listSystemVolumes();
    const connection = hddInventory.resolveConnection(drive, volumes);
    if (!connection.connected) throw new Error('El HDD no está conectado.');
    const absolute = path.join(connection.mountPoint, entry.relativePath);
    const text = await mediaPlayer.extractDocumentText(absolute, entry.extension);
    return { text: String(text || '') };
  });
  // --- Mantenedor de BinderTrack -------------------------------------------
  ipcMain.handle('binder:list-series', () => binderManager.listSeries());
  ipcMain.handle('binder:list-subseries', (_event, series) => binderManager.listSubseries(series));
  ipcMain.handle('binder:list-sets', (_event, filter) => binderManager.listSets(filter || {}));
  ipcMain.handle('binder:get-set', (_event, id) => binderManager.getSet(id));
  ipcMain.handle('binder:create-set', (_event, data) => binderManager.createSet(data));
  ipcMain.handle('binder:update-set', (_event, { id, patch }) =>
    binderManager.updateSet(id, patch),
  );
  ipcMain.handle('binder:delete-set', (_event, id) => binderManager.deleteSet(id));
  ipcMain.handle('binder:list-cards', (_event, setId) => binderManager.listCards(setId));
  ipcMain.handle('binder:search-cards', (_event, query) => binderManager.searchCards(query));
  ipcMain.handle('binder:get-card', (_event, id) => binderManager.getCard(id));
  ipcMain.handle('binder:create-card', (_event, data) => binderManager.createCard(data));
  ipcMain.handle('binder:update-card', (_event, { id, patch }) =>
    binderManager.updateCard(id, patch),
  );
  ipcMain.handle('binder:delete-card', (_event, id) => binderManager.deleteCard(id));
  ipcMain.handle('binder:list-variants', (_event, cardId) => binderManager.listVariants(cardId));
  ipcMain.handle('binder:create-variant', (_event, data) => binderManager.createVariant(data));
  ipcMain.handle('binder:update-variant', (_event, { id, patch }) =>
    binderManager.updateVariant(id, patch),
  );
  ipcMain.handle('binder:delete-variant', (_event, id) => binderManager.deleteVariant(id));
  ipcMain.handle('binder:list-custom-lists', () => binderManager.listCustomLists());
  ipcMain.handle('binder:create-custom-list', (_event, data) =>
    binderManager.createCustomList(data),
  );
  ipcMain.handle('binder:update-custom-list', (_event, { id, patch }) =>
    binderManager.updateCustomList(id, patch),
  );
  ipcMain.handle('binder:delete-custom-list', (_event, id) => binderManager.deleteCustomList(id));
  ipcMain.handle('binder:list-custom-list-cards', (_event, listId) =>
    binderManager.listCustomListCards(listId),
  );
  ipcMain.handle('binder:add-card-to-list', (_event, data) => binderManager.addCardToList(data));
  ipcMain.handle('binder:remove-card-from-list', (_event, id) =>
    binderManager.removeCardFromList(id),
  );
  ipcMain.handle('binder:reorder-custom-list-cards', (_event, { listId, ids }) =>
    binderManager.reorderCustomListCards(listId, ids),
  );
  ipcMain.handle('binder:select-import-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'BinderTrack ZIP', extensions: ['zip'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('binder:import-zip', async (_event, filePath) =>
    binderTrack.importZip(binderManager, filePath, binderTrackMediaDir),
  );
  ipcMain.handle('binder:select-export-destination', async (_event, defaultName) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'BinderTrack ZIP', extensions: ['zip'] }],
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('binder:export-collection', async (_event, destination) => {
    await binderTrack.exportCollectionZip(binderManager, destination);
    return true;
  });
  ipcMain.handle('binder:export-set', async (_event, { setId, destination }) => {
    await binderTrack.exportSetZip(binderManager, setId, destination);
    return true;
  });
  ipcMain.handle('binder:export-custom-list', async (_event, { listId, destination }) => {
    await binderTrack.exportCustomListZip(binderManager, listId, destination);
    return true;
  });
  // Integración con la sección "Colección": vuelca cartas unitarias o el set
  // completo como ítems de una colección genérica ya existente.
  ipcMain.handle('binder:add-card-to-collection', (_event, { cardId, collectionId, variantId }) => {
    const card = binderManager.getCard(cardId);
    if (!card) throw new Error('La carta no existe.');
    const collection = collectionManager.getCollection(collectionId);
    if (!collection) throw new Error('La colección no existe.');
    const set = card.setId ? binderManager.getSet(card.setId) : null;
    const variant = variantId ? binderManager.getVariant(variantId) : null;
    const values = binderTrack.mapCardToCollectionValues(card, set, variant, collection.columns);
    collectionManager.addItem({
      collectionId,
      name: variant ? `${card.name} (${variant.type || 'Variante'})` : card.name,
      imageUrl: binderTrack.asCollectionImageUrl(variant?.img || card.img),
      tags: set ? [set.name] : [],
      values,
    });
    return { added: 1 };
  });
  ipcMain.handle('binder:add-set-to-collection', (_event, { setId, collectionId }) => {
    const set = binderManager.getSet(setId);
    if (!set) throw new Error('El set no existe.');
    const collection = collectionManager.getCollection(collectionId);
    if (!collection) throw new Error('La colección no existe.');
    let added = 0;
    for (const card of binderManager.listCards(setId)) {
      const values = binderTrack.mapCardToCollectionValues(card, set, null, collection.columns);
      collectionManager.addItem({
        collectionId,
        name: card.name,
        imageUrl: binderTrack.asCollectionImageUrl(card.img),
        tags: [set.name],
        values,
      });
      added += 1;
    }
    return { added };
  });
  // ── ChuckBot ─────────────────────────────────────────────────────────────
  const sendChuckBotEvent = (event) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('chuckbot:event', event);
  };
  ipcMain.handle('chuckbot:status', () => chuckbot.status());
  ipcMain.handle('chuckbot:start', () => chuckbot.startServer());
  ipcMain.handle('chuckbot:stop', () => chuckbot.stopServer());
  ipcMain.handle('chuckbot:ollama-status', () => chuckbot.ollamaAction('status'));
  ipcMain.handle('chuckbot:ollama-start', () => chuckbot.ollamaAction('start'));
  ipcMain.handle('chuckbot:ollama-stop', () => chuckbot.ollamaAction('stop'));
  ipcMain.handle('chuckbot:chat', (_event, data) => chuckbot.chat(data, sendChuckBotEvent));
  ipcMain.handle('chuckbot:chat-cancel', () => chuckbot.cancelChats());
  ipcMain.handle('chuckbot:push-vscode', (_event, data) => chuckbot.pushToVsCode(data));
  ipcMain.handle('chuckbot:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('chuckbot:save-solution', (_event, data) => chuckbot.saveSolution(data));
  ipcMain.handle('chuckbot:reveal-file', (_event, filePath) => {
    if (filePath) shell.showItemInFolder(path.resolve(filePath));
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
    if (wikiManager) {
      wikiManager.close();
      wikiManager = null;
    }
    if (hijitosManager) {
      hijitosManager.close();
      hijitosManager = null;
    }
  if (hddManager) {
    hddManager.close();
    hddManager = null;
  }
  void chuckbot.stopServer();
});
