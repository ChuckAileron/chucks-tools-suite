const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installHooks, restoreHooks } = require('./helpers/moduleHooks.cjs');

const state = {
  fetchResponder: null,
  fetchCalls: [],
  sevenCmd: () => Promise.resolve(),
  sevenBinary: 'C:/fake/7za.exe',
  dlInstances: [],
  video: {
    isVideoLink: () => false,
    isPlaylistUrl: () => false,
    listVideoFormats: async () => [],
    listPlaylistVideos: async () => ({ videos: [] }),
    listVideoQualityOptions: async () => [],
    downloadVideo: () => ({ result: Promise.resolve({ filePath: '' }) }),
  },
  urlResolver: {
    resolveUrl: async () => ({
      finalUrl: 'https://cdn.example.com/file.mp4',
      domain: 'example.com',
      mode: 'direct',
      chain: [{ status: 200 }],
    }),
  },
  mega: {
    megaFileParts: () => '',
    megaFolderParts: () => '',
    megaFolderFileParts: () => '',
    isMegaUrl: () => false,
    resolveMegaFile: async () => ({
      url: 'https://dl.mega.nz/file',
      name: 'archivo.rar',
      size: 10,
      key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
    }),
    resolveMegaFolderTree: async () => ({ name: 'MEGA root', entries: [] }),
    resolveMegaFolderFile: async () => ({
      url: 'https://dl.mega.nz/file',
      name: 'archivo.rar',
      size: 10,
      key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
    }),
    MegaDownloader: null,
    instances: [],
  },
  terabox: {
    teraboxShareParts: () => '',
    teraboxDownloadUrl: (options) => `https://dl.terabox.com/api?fs_id=${options.fsId}`,
    expandTeraboxShare: async () => ({
      host: 'h',
      surl: 's',
      uk: 'u',
      shareid: 'i',
      name: 'T',
      files: [],
    }),
    refreshTeraboxFile: async () => '',
  },
};

class FakeMegaDownloader {
  constructor(options) {
    this.options = options;
    this.handlers = new Map();
    this.stopped = false;
    state.mega.instances.push(this);
  }
  on(event, fn) {
    this.handlers.set(event, fn);
    return this;
  }
  emit(event, payload) {
    const fn = this.handlers.get(event);
    if (fn) fn(payload);
  }
  start() {
    return Promise.resolve();
  }
  stop() {
    this.stopped = true;
    return Promise.resolve();
  }
}

function resetStubs() {
  state.fetchResponder = null;
  state.fetchCalls.length = 0;
  state.dlInstances.length = 0;
  state.sevenCmd = () => Promise.resolve();
  state.video.isVideoLink = () => false;
  state.video.isPlaylistUrl = () => false;
  state.video.listVideoFormats = async () => [];
  state.video.listPlaylistVideos = async () => ({ videos: [] });
  state.video.listVideoQualityOptions = async () => [];
  state.video.downloadVideo = () => ({ result: Promise.resolve({ filePath: '' }) });
  state.urlResolver.resolveUrl = async () => ({
    finalUrl: 'https://cdn.example.com/file.mp4',
    domain: 'example.com',
    mode: 'direct',
    chain: [{ status: 200 }],
  });
  state.mega.megaFileParts = () => '';
  state.mega.megaFolderParts = () => '';
  state.mega.megaFolderFileParts = () => '';
  state.mega.isMegaUrl = () => false;
  state.mega.resolveMegaFile = async () => ({
    url: 'https://dl.mega.nz/file',
    name: 'archivo.rar',
    size: 10,
    key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
  });
  state.mega.resolveMegaFolderTree = async () => ({ name: 'MEGA root', entries: [] });
  state.mega.resolveMegaFolderFile = async () => ({
    url: 'https://dl.mega.nz/file',
    name: 'archivo.rar',
    size: 10,
    key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
  });
  state.mega.MegaDownloader = FakeMegaDownloader;
  state.mega.instances.length = 0;
  state.terabox.teraboxShareParts = () => '';
  state.terabox.teraboxDownloadUrl = (options) =>
    `https://dl.terabox.com/api?fs_id=${options.fsId}`;
  state.terabox.expandTeraboxShare = async () => ({
    host: 'h',
    surl: 's',
    uk: 'u',
    shareid: 'i',
    name: 'T',
    files: [],
  });
  state.terabox.refreshTeraboxFile = async () => '';
}

class FakeDownloaderHelper {
  constructor(url, destination, options) {
    this.url = url;
    this.destination = destination;
    this.options = options;
    this.handlers = new Map();
    this.stopped = false;
    state.dlInstances.push(this);
  }
  on(event, fn) {
    this.handlers.set(event, fn);
    return this;
  }
  emit(event, payload) {
    const fn = this.handlers.get(event);
    if (fn) fn(payload);
  }
  start() {
    return Promise.resolve();
  }
  stop() {
    this.stopped = true;
    return Promise.resolve();
  }
}

installHooks({
  'node-downloader-helper': { DownloaderHelper: FakeDownloaderHelper },
  '7zip-min': {
    config() {},
    cmd(args) {
      state.sevenArgs = args;
      return state.sevenCmd(args);
    },
  },
  '7zip-bin': { path7za: state.sevenBinary },
  './urlResolver.cjs': {
    resolveUrl: (url) => state.urlResolver.resolveUrl(url),
  },
  './megaProvider.cjs': {
    megaFileParts: (url) => state.mega.megaFileParts(url),
    megaFolderParts: (url) => state.mega.megaFolderParts(url),
    megaFolderFileParts: (url) => state.mega.megaFolderFileParts(url),
    isMegaUrl: (url) => state.mega.isMegaUrl(url),
    resolveMegaFile: (...args) => state.mega.resolveMegaFile(...args),
    resolveMegaFolderTree: (...args) => state.mega.resolveMegaFolderTree(...args),
    resolveMegaFolderFile: (...args) => state.mega.resolveMegaFolderFile(...args),
    MegaDownloader: function MegaDownloader(options) {
      return new state.mega.MegaDownloader(options);
    },
  },
  './teraboxProvider.cjs': {
    teraboxShareParts: (url) => state.terabox.teraboxShareParts(url),
    teraboxDownloadUrl: (...args) => state.terabox.teraboxDownloadUrl(...args),
    expandTeraboxShare: (...args) => state.terabox.expandTeraboxShare(...args),
    refreshTeraboxFile: (...args) => state.terabox.refreshTeraboxFile(...args),
  },
  './videoProvider.cjs': {
    isVideoLink: (url) => state.video.isVideoLink(url),
    isPlaylistUrl: (url) => state.video.isPlaylistUrl(url),
    listVideoFormats: (url) => state.video.listVideoFormats(url),
    listPlaylistVideos: (url) => state.video.listPlaylistVideos(url),
    listVideoQualityOptions: (url) => state.video.listVideoQualityOptions(url),
    downloadVideo: (options) => state.video.downloadVideo(options),
  },
});

let { DownloadManager, archiveVolume } = require('../electron/downloadManager.cjs');
delete require.cache[require.resolve('../electron/downloadManager.cjs')];
({ DownloadManager, archiveVolume } = require('../electron/downloadManager.cjs'));

async function installFetch(responder) {
  state.fetchCalls.length = 0;
  global.fetch = async (url) => {
    const href = String(url);
    state.fetchCalls.push(href);
    const data = await responder(href);
    return { ok: true, status: 200, json: async () => data };
  };
}

async function installWebFetch(responder) {
  state.fetchCalls.length = 0;
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    state.fetchCalls.push(href);
    const data = await responder(href, options);
    const body = typeof data === 'string' ? data : (data?.body ?? '');
    const status =
      data && typeof data === 'object' && typeof data.status === 'number' ? data.status : 200;
    const headers = data && typeof data === 'object' && data.headers ? data.headers : {};
    const contentType =
      headers['content-type'] ||
      (typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json');
    return {
      ok: status >= 200 && status < 400,
      status,
      headers: {
        get: (name) => {
          const key = String(name).toLowerCase();
          if (key === 'content-type') return contentType;
          return headers[key] ?? headers[String(name)] ?? null;
        },
        getSetCookie: () => {
          const cookies = headers['set-cookie'] ?? headers['Set-Cookie'] ?? [];
          return Array.isArray(cookies) ? cookies : [cookies];
        },
      },
      json: async () => (typeof body === 'string' ? {} : body),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
}

function makeManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-shell-'));
  const manager = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  return { manager, dir };
}

async function waitUntil(condition, timeout = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('condición no alcanzada');
    await new Promise((r) => setImmediate(r));
  }
}

test('analyze resuelve enlaces directos y arma colección para lotes', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.urlResolver.resolveUrl = async (url) => ({
    finalUrl:
      url === 'https://cdn.example.com/a.zip'
        ? 'https://cdn.example.com/a.zip'
        : 'https://cdn.example.com/b.rar',
    domain: 'example.com',
    mode: 'direct',
    chain: [{ status: 200 }],
  });
  const results = await manager.analyze(
    'https://cdn.example.com/a.zip y https://cdn.example.com/b.rar',
  );
  assert.equal(results.length, 2);
  assert.ok(results[0].collection.startsWith('Colección '));
  assert.equal(results[0].online, true);
  assert.equal(results[0].name, 'a.zip');
});

test('analyze genera un candidato por video de una lista de YouTube', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.video.isVideoLink = () => true;
  state.video.isPlaylistUrl = () => true;
  state.video.listPlaylistVideos = async () => ({
    title: 'Mi lista',
    videos: [
      { url: 'https://youtube.com/watch?v=1', title: 'Cap 1' },
      { url: 'https://youtube.com/watch?v=2', title: 'Cap 2' },
    ],
  });
  const results = await manager.analyze('https://www.youtube.com/playlist?list=pl1');
  assert.equal(results.length, 2);
  assert.equal(results[0].mode, 'Playlist');
  assert.equal(results[0].videoFormat, 'video:best');
  assert.equal(results[0].collection, 'Mi lista');
  assert.equal(results[1].name, 'Cap 2');
});

test('analyze marca offline un playlist sin videos', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.video.isVideoLink = () => true;
  state.video.isPlaylistUrl = () => true;
  const results = await manager.analyze('https://www.youtube.com/playlist?list=pl1');
  assert.equal(results[0].online, false);
  assert.equal(results[0].mode, 'Playlist');
  assert.match(results[0].error, /no tiene videos/);
});

test('analyze descompone un video en formatos', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.video.isVideoLink = () => true;
  state.video.isPlaylistUrl = () => false;
  state.video.listVideoFormats = async () => [
    { videoFormat: 'video:1080', name: 'Cap [1080p]', mode: 'video', collection: 'Canal' },
    { videoFormat: 'audio', name: 'Cap [audio]', mode: 'audio', collection: 'Canal' },
  ];
  const results = await manager.analyze('https://www.youtube.com/watch?v=abc');
  assert.equal(results.length, 2);
  assert.equal(results[0].videoFormat, 'video:1080');
  assert.equal(results[1].collection, 'Canal');
});

test('analyze marca offline un video sin formatos', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.video.isVideoLink = () => true;
  state.video.isPlaylistUrl = () => false;
  const results = await manager.analyze('https://www.youtube.com/watch?v=abc');
  assert.equal(results[0].online, false);
  assert.match(results[0].error, /sin formatos/);
});

test('analyze expande una carpeta de MediaFire con la API', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.urlResolver.resolveUrl = async () => ({
    finalUrl: 'https://download1.mediafire.com/token/a.zip',
    domain: 'mediafire.com',
    mode: 'mediafire-direct',
    chain: [{ status: 200 }],
  });
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'Fotos' } } };
    if (url.includes('content_type=files'))
      return {
        response: {
          folder_content: {
            files: [
              {
                filename: 'foto 1.jpg',
                links: { normal_download: 'https://www.mediafire.com/file/a/foto%201.jpg' },
              },
            ],
          },
        },
      };
    return { response: { folder_content: { folders: [] } } };
  });
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results.length, 1);
  assert.equal(results[0].mode, 'mediafire-folder');
  assert.equal(results[0].online, true);
  assert.equal(results[0].name, 'foto 1.jpg');
  assert.equal(results[0].collection, 'Fotos');
});

test('analyze reporta carpetas de MediaFire que la API no deja leer', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installFetch(() => ({ response: { message: 'Acceso no autorizado' } }));
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, true);
  assert.match(results[0].error, /Acceso no autorizado/);
});

test('analyze expande una carpeta de Google Drive con API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  await installFetch((url) => {
    if (url.includes('/files/FOLDER')) return { name: 'Drive root' };
    return {
      files: [{ id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', size: 123 }],
      nextPageToken: '',
    };
  });
  const results = await manager.analyze('https://drive.google.com/drive/folders/FOLDER');
  assert.equal(results.length, 1);
  assert.equal(results[0].mode, 'google-drive-folder');
  assert.ok(results[0].url.includes('alt=media'));
  assert.ok(results[0].url.includes('key=KEY'));
  assert.equal(results[0].collection, 'Drive root');
});

test('analyze marca offline una carpeta de Google Drive vacía', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  await installFetch((url) => (url.includes('/files/FOLDER') ? { name: 'Vacia' } : { files: [] }));
  const results = await manager.analyze('https://drive.google.com/drive/folders/FOLDER');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, true);
  assert.match(results[0].error, /vacía|no es pública/);
});

test('analyze resuelve un archivo de Google Drive', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  await installFetch(() => ({ id: 'f1', name: 'guia.pdf', mimeType: 'application/pdf', size: 5 }));
  const results = await manager.analyze('https://drive.google.com/file/d/F1/view');
  assert.equal(results.length, 1);
  assert.equal(results[0].mode, 'google-drive-file');
  assert.equal(results[0].online, true);
  assert.equal(results[0].name, 'guia.pdf');
});

test('analyze reporta un enlace de MEGA sin clave de cifrado', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.mega.isMegaUrl = (url) => String(url).includes('mega.nz');
  const results = await manager.analyze('https://mega.nz/folder/abc');
  assert.equal(results[0].online, false);
  assert.match(results[0].host, /MEGA/);
  assert.match(results[0].error, /clave de cifrado/);
});

test('analyze expande un archivo de MEGA con su clave', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.mega.megaFileParts = (url) =>
    String(url).includes('/file/') ? { handle: 'H1', key: 'K1' } : '';
  state.mega.resolveMegaFile = async () => ({
    url: 'https://dl.mega.nz/file?x=1',
    name: 'capsula.rar',
    size: 42,
    key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
  });
  const results = await manager.analyze('https://mega.nz/file/H1#K1');
  assert.equal(results.length, 1);
  assert.equal(results[0].mode, 'mega-file');
  assert.equal(results[0].name, 'capsula.rar');
  assert.equal(results[0].url, 'https://dl.mega.nz/file?x=1');
  assert.equal(results[0].host, 'mega.nz');
});

test('analyze marca offline un archivo MEGA que no se puede resolver', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.mega.megaFileParts = (url) =>
    String(url).includes('/file/') ? { handle: 'H1', key: 'K1' } : '';
  state.mega.resolveMegaFile = async () => {
    throw new Error('El enlace de MEGA expiró');
  };
  const results = await manager.analyze('https://mega.nz/file/H1#K1');
  assert.equal(results[0].online, false);
  assert.match(results[0].error, /expiró/);
});

test('analyze expande una carpeta de MEGA recorriendo subcarpetas', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.mega.megaFolderParts = (url) =>
    String(url).includes('/folder/') ? { handle: 'F1', key: 'FK1' } : '';
  state.mega.resolveMegaFolderTree = async () => ({
    name: 'Fotos',
    entries: [
      { h: 'F1', p: '', t: 'folder', s: 0, key: 'FK1', name: 'Fotos' },
      { h: 'c1', p: 'F1', t: 'file', s: 5, key: 'CF1', name: 'foto 1.jpg' },
      { h: 'sub', p: 'F1', t: 'folder', s: 0, key: 'SUB', name: 'Album' },
      { h: 'c2', p: 'sub', t: 'file', s: 3, key: 'CF2', name: 'nested.txt' },
    ],
  });
  const results = await manager.analyze('https://mega.nz/folder/F1#FK1');
  assert.equal(results.length, 2);
  assert.equal(results[0].mode, 'mega-folder');
  assert.equal(results[0].originalUrl, 'https://mega.nz/folder/F1#FK1/file/c1');
  assert.equal(results[0].collection, 'Fotos');
  assert.equal(results[1].originalUrl, 'https://mega.nz/folder/F1#FK1/file/c2');
  assert.equal(results[1].collection, 'Fotos / Album');
});

test('start descarga un archivo dentro de una carpeta de MEGA (enlace carpeta+archivo)', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  state.mega.megaFolderFileParts = (url) =>
    String(url).includes('/file/')
      ? { folderHandle: 'F1', folderKey: 'FK1', fileHandle: 'c1' }
      : '';
  state.mega.resolveMegaFolderFile = async (folderHandle, folderKey, fileHandle) => ({
    url: `https://dl.mega.nz/file?h=${fileHandle}`,
    name: 'foto 1.jpg',
    size: 5,
    key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
  });
  manager.add([
    {
      originalUrl: 'https://mega.nz/folder/F1#FK1/file/c1',
      url: 'https://mega.nz/folder/F1#FK1/file/c1',
      name: 'foto 1.jpg',
      destination: dir,
      host: 'mega.nz',
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const downloader = state.mega.instances[0];
  assert.equal(downloader.options.downloadUrl, 'https://dl.mega.nz/file?h=c1');
  const task = [...manager.tasks.values()][0];
  downloader.emit('end', { filePath: path.join(dir, 'foto 1.jpg') });
  await waitUntil(() => manager.active.size === 0 && task.status === 'completed');
});

test('analyze expande un enlace compartido de TeraBox con archivos', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.terabox.teraboxShareParts = (url) =>
    String(url).includes('terabox.com') ? { host: 'https://www.1024terabox.com', surl: 's1' } : '';
  state.terabox.expandTeraboxShare = async () => ({
    host: 'https://www.1024terabox.com',
    surl: 's1',
    uk: 'UK',
    shareid: 'SID',
    name: 'Fotos de la boda',
    files: [
      { fs_id: '11', name: 'boda.rar', size: 10, dlink: '', fromFolder: false },
      {
        fs_id: '22',
        name: 'carpeta/logo.png',
        size: 5,
        dlink: 'https://dl.terabox.com/x',
        fromFolder: true,
      },
    ],
  });
  const results = await manager.analyze('https://www.1024terabox.com/s/1abc');
  assert.equal(results.length, 2);
  assert.equal(results[0].mode, 'terabox-file');
  assert.equal(results[1].mode, 'terabox-folder');
  assert.equal(results[1].name, 'carpeta/logo.png'.split('/').pop());
  assert.equal(results[0].providerData.terabox.fsId, '11');
  assert.match(results[0].url, /^https:\/\/dl\.terabox\.com\/api\?/);
  assert.equal(results[1].url, 'https://dl.terabox.com/x');
  assert.equal(results[0].collection, 'Fotos de la boda');
});

test('analyze marca offline un enlace de TeraBox que no se puede leer', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.terabox.teraboxShareParts = (url) =>
    String(url).includes('terabox.com') ? { host: 'https://www.1024terabox.com', surl: 's1' } : '';
  state.terabox.expandTeraboxShare = async () => {
    throw new Error('El enlace caducó');
  };
  const results = await manager.analyze('https://www.1024terabox.com/s/1abc');
  assert.equal(results[0].online, false);
  assert.match(results[0].error, /caducó/);
});

test('start descarga un archivo MEGA re-resolviendo el enlace y usando MegaDownloader', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  state.mega.megaFileParts = (url) =>
    String(url).includes('/file/') ? { handle: 'H1', key: 'K1' } : '';
  state.mega.resolveMegaFile = async () => ({
    url: 'https://dl.mega.nz/file?ref=1',
    name: 'capsula.rar',
    size: 42,
    key: { k: Buffer.alloc(16), iv: Buffer.alloc(8), metaMac: Buffer.alloc(8) },
  });
  manager.add([
    {
      originalUrl: 'https://mega.nz/file/H1#K1',
      url: 'https://mega.nz/file/H1#K1',
      name: 'capsula.rar',
      destination: dir,
      host: 'mega.nz',
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const downloader = state.mega.instances[0];
  assert.ok(downloader.options.downloadUrl.includes('ref=1'));
  const task = [...manager.tasks.values()][0];
  downloader.emit('end', { filePath: path.join(dir, 'capsula.rar') });
  await waitUntil(() => manager.active.size === 0 && task.status === 'completed');
  assert.equal(task.progress, 100);
});

test('start refresca el enlace directo de un archivo de TeraBox al reanudar', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  const task = {
    id: 't1',
    originalUrl: 'https://www.1024terabox.com/s/1abc',
    url: 'https://dl.terabox.com/old',
    name: 'boda.rar',
    destination: dir,
    host: 'terabox.com',
    providerData: { terabox: { host: 'h', surl: 's', uk: 'u', shareid: 'i', fsId: '11' } },
    status: 'pending',
    startedOnce: true,
    priority: 'medium',
    extract: false,
  };
  state.terabox.refreshTeraboxFile = async (url, fsId) => 'https://dl.terabox.com/new?fs=' + fsId;
  manager.tasks.set(task.id, task);
  manager.start(task);
  await waitUntil(() => manager.active.size === 1);
  assert.equal(task.url, 'https://dl.terabox.com/new?fs=11');
  const downloader = state.dlInstances[0];
  assert.ok(String(downloader.url).includes('dl.terabox.com/new'));
});

test('start marca error si re-resolver el archivo MEGA falla', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  state.mega.megaFileParts = (url) =>
    String(url).includes('/file/') ? { handle: 'H1', key: 'K1' } : '';
  state.mega.resolveMegaFile = async () => {
    throw new Error('MEGA no encontró el archivo');
  };
  manager.add([
    {
      originalUrl: 'https://mega.nz/file/H1#K1',
      url: 'https://mega.nz/file/H1#K1',
      name: 'capsula.rar',
      destination: dir,
      host: 'mega.nz',
    },
  ]);
  const task = [...manager.tasks.values()][0];
  await waitUntil(() => task.status === 'error');
  assert.match(task.error, /no encontró/);
});

test('analyze propaga el error de resolución de un enlace directo', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.urlResolver.resolveUrl = async () => {
    throw new Error('URL expiró');
  };
  const results = await manager.analyze('https://example.com/archivo.rar');
  assert.equal(results[0].online, false);
  assert.match(results[0].error, /URL expiró/);
});

test('googleDriveRequest rechaza sin API key y con respuesta de error', async () => {
  resetStubs();
  const { manager } = makeManager();
  await assert.rejects(manager.googleDriveRequest('files/x'), /API key/);
  manager.settings.googleDriveApiKey = 'KEY';
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { message: 'Forbidden' } }),
  });
  await assert.rejects(manager.googleDriveRequest('files/x'), /Forbidden/);
});

test('googleDownloadUrl usa export para documentos y media para archivos', () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  const doc = manager.googleDownloadUrl({
    id: 'd1',
    mimeType: 'application/vnd.google-apps.document',
  });
  assert.ok(doc.url.includes('/export'));
  assert.ok(
    doc.url.includes(
      'mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
  );
  assert.equal(doc.extension, '.docx');
  const file = manager.googleDownloadUrl({ id: 'f1', mimeType: 'application/pdf' });
  assert.ok(file.url.includes('alt=media'));
  assert.equal(file.extension, '');
});

test('expandGoogleDriveFile rechaza enlaces que apuntan a carpetas', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: 'F',
      name: 'Carpeta',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  await assert.rejects(
    manager.expandGoogleDriveFile('F', 'https://drive.google.com/file/d/F/view'),
    /carpeta, no a un archivo/,
  );
});

test('expandGoogleDriveFolder recorre subcarpetas y omite otros tipos de Google', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  await installFetch((url) => {
    if (url.includes('/files/ROOT')) {
      return { id: 'ROOT', name: 'Raiz', mimeType: 'application/vnd.google-apps.folder' };
    }
    if (url.includes('/files?')) {
      const calls = state.fetchCalls.filter((c) => c.includes('/files?'));
      if (calls.length === 1)
        return {
          files: [
            { id: 'sub', name: 'Sub', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'pdf', name: 'doc.pdf', mimeType: 'application/pdf' },
            { id: 'acd', name: 'mov', mimeType: 'application/vnd.google-apps.script' },
          ],
          nextPageToken: '',
        };
      return { files: [{ id: 'p2', name: 'nota', mimeType: 'text/plain' }], nextPageToken: '' };
    }
    return { name: 'x' };
  });
  const results = await manager.expandGoogleDriveFolder(
    'ROOT',
    'https://drive.google.com/drive/folders/ROOT',
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'nota');
  assert.equal(results[0].collection, 'Raiz / Sub');
  assert.equal(results[1].name, 'doc.pdf');
  assert.equal(results[1].collection, 'Raiz');
});

test('retryExtraction completa la extracción con contraseña correcta', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'datos.zip');
  fs.writeFileSync(file, 'zip-content');
  manager.tasks.set('t1', {
    id: 't1',
    filePath: file,
    deleteArchive: true,
    destination: dir,
    status: 'password-required',
    password: '',
  });
  state.sevenCmd = async () => {};
  const completed = await manager.retryExtraction('t1', 'clave');
  assert.equal(completed, true);
  assert.equal(manager.tasks.get('t1').status, 'completed');
  assert.equal(fs.existsSync(file), false);
});

test('retryExtraction pasa a password-required si 7-Zip rechaza la clave', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'datos.zip');
  fs.writeFileSync(file, 'zip-content');
  manager.tasks.set('t1', { id: 't1', filePath: file, deleteArchive: true, destination: dir });
  state.sevenCmd = async () => {
    const error = new Error('Failed');
    error.stderr = 'Wrong password';
    throw error;
  };
  const completed = await manager.retryExtraction('t1', 'mala');
  assert.equal(completed, false);
  assert.equal(manager.tasks.get('t1').status, 'password-required');
});

test('retryExtraction devuelve false sin tarea o sin archivo', async () => {
  resetStubs();
  const { manager } = makeManager();
  assert.equal(await manager.retryExtraction('no-existe', 'x'), false);
  manager.tasks.set('t1', { id: 't1' });
  assert.equal(await manager.retryExtraction('t1', 'x'), false);
});

test('extract crea la carpeta de salida y registra extractedTo', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'datos.rar');
  fs.writeFileSync(file, 'x');
  manager.tasks.set('t1', {
    id: 't1',
    filePath: file,
    destination: dir,
    password: 'x',
    deleteArchive: true,
  });
  state.sevenCmd = async () => {};
  await manager.extract(manager.tasks.get('t1'));
  assert.equal(manager.tasks.get('t1').extractedTo, path.join(dir, 'datos'));
  assert.ok(fs.existsSync(path.join(dir, 'datos')));
  assert.ok(state.sevenArgs.includes(`-o${path.join(dir, 'datos')}`));
  assert.ok(state.sevenArgs.some((a) => a.startsWith('-p')));
});

test('extract usa el nombre base del volumen multiparte como salida', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'Serie.part1.rar');
  fs.writeFileSync(file, 'x');
  manager.tasks.set('t1', { id: 't1', filePath: file, destination: dir, password: '' });
  state.sevenCmd = async () => {};
  await manager.extract(manager.tasks.get('t1'));
  assert.equal(manager.tasks.get('t1').extractedTo, path.join(dir, 'Serie'));
});

test('recover marca como error las extracciones sin archivo en disco', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.tasks.set('t1', {
    id: 't1',
    status: 'extracting',
    filePath: path.join('X:', 'no-existe.zip'),
  });
  await manager.recover();
  assert.equal(manager.tasks.get('t1').status, 'error');
  assert.match(manager.tasks.get('t1').error, /ya no existe/);
});

test('recover completa extracciones pendientes', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'ok.7z');
  fs.writeFileSync(file, 'x');
  manager.tasks.set('t1', {
    id: 't1',
    status: 'extracting',
    filePath: file,
    destination: dir,
    deleteArchive: true,
    password: '',
  });
  state.sevenCmd = async () => {};
  await manager.recover();
  const task = manager.tasks.get('t1');
  assert.equal(task.status, 'completed');
  assert.equal(task.error, '');
});

test('recover conserva el estado de error de contraseña', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'ok.zip');
  fs.writeFileSync(file, 'x');
  manager.tasks.set('t1', {
    id: 't1',
    status: 'extracting',
    filePath: file,
    destination: dir,
    deleteArchive: true,
    password: '',
  });
  state.sevenCmd = async () => {
    const error = new Error('Failed');
    error.stderr = 'data error';
    throw error;
  };
  await manager.recover();
  assert.equal(manager.tasks.get('t1').status, 'password-required');
});

test('start completa una descarga de archivo reenviando el evento end', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  const taskFile = path.join(dir, 'cap.zip');
  manager.add([
    {
      originalUrl: 'https://cdn.example.com/cap.zip',
      url: 'https://cdn.example.com/cap.zip',
      name: 'cap.zip',
      destination: dir,
      host: 'example.com',
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const task = [...manager.tasks.values()][0];
  state.dlInstances[0].emit('end', { filePath: taskFile });
  await waitUntil(() => manager.active.size === 0 && task.status === 'completed');
  assert.equal(task.progress, 100);
  assert.equal(task.filePath, taskFile);
});

test('start marca error si el descargador falla', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  manager.add([
    {
      originalUrl: 'https://cdn.example.com/bad.zip',
      url: 'https://cdn.example.com/bad.zip',
      name: 'bad.zip',
      destination: dir,
      host: 'example.com',
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const task = [...manager.tasks.values()][0];
  state.dlInstances[0].emit('error', new Error('conexión caída'));
  await waitUntil(() => manager.active.size === 0 && task.status === 'error');
  assert.match(task.error, /conexión caída/);
});

test('startVideo completa cuando el descargador de video resuelve', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  state.video.downloadVideo = () => ({
    result: Promise.resolve({ filePath: path.join(dir, 'cap.mp4') }),
  });
  manager.settings.concurrency = 0;
  const task = {
    id: 'v1',
    videoUrl: 'https://youtube.com/watch?v=abc',
    videoFormat: 'video:best',
    name: 'cap',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  await waitUntil(() => task.status === 'completed');
  assert.equal(task.filePath, path.join(dir, 'cap.mp4'));
});

test('startVideo marca error si el descargador de video rechaza', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  state.video.downloadVideo = () => ({ result: Promise.reject(new Error('video privado')) });
  manager.settings.concurrency = 0;
  const task = {
    id: 'v2',
    videoUrl: 'https://youtube.com/watch?v=abc',
    videoFormat: 'video:best',
    name: 'cap',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  await waitUntil(() => task.status === 'error');
  assert.match(task.error, /video privado/);
});

test('getVideoQualityOptions delega solo para enlaces de video', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.video.isVideoLink = () => false;
  assert.deepEqual(await manager.getVideoQualityOptions('https://example.com/a.zip'), []);
  state.video.isVideoLink = () => true;
  state.video.listVideoQualityOptions = async () => [
    { label: 'Mejor calidad', videoFormat: 'video:best' },
  ];
  const options = await manager.getVideoQualityOptions('https://youtube.com/watch?v=abc');
  assert.equal(options[0].videoFormat, 'video:best');
});

test('maybeExtractVolume extrae el volumen completo y borra todas las partes', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const part1 = path.join(dir, 'Serie.part1.rar');
  const part2 = path.join(dir, 'Serie.part2.rar');
  fs.writeFileSync(part1, 'p1');
  fs.writeFileSync(part2, 'p2');
  manager.settings.autoExtract = true;
  manager.tasks.set('p1', {
    id: 'p1',
    status: 'completed',
    filePath: part1,
    name: 'Serie.part1.rar',
    destination: dir,
    deleteArchive: true,
    extract: true,
    password: '',
  });
  manager.tasks.set('p2', {
    id: 'p2',
    status: 'completed',
    filePath: part2,
    name: 'Serie.part2.rar',
    destination: dir,
    deleteArchive: true,
    extract: true,
    password: '',
  });
  state.sevenCmd = async () => {};
  await manager.maybeExtractVolume(archiveVolume('Serie.part1.rar'));
  assert.equal(manager.tasks.get('p1').status, 'completed');
  assert.equal(fs.existsSync(part1), false);
  assert.equal(fs.existsSync(part2), false);
  assert.equal(manager.tasks.get('p1').extractedTo, path.join(dir, 'Serie'));
});

test('maybeExtractVolume marca error cuando 7-Zip rechaza el volumen', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const part1 = path.join(dir, 'Serie.part1.rar');
  const part2 = path.join(dir, 'Serie.part2.rar');
  fs.writeFileSync(part1, 'p1');
  fs.writeFileSync(part2, 'p2');
  manager.settings.autoExtract = true;
  manager.tasks.set('p1', {
    id: 'p1',
    status: 'completed',
    filePath: part1,
    name: 'Serie.part1.rar',
    destination: dir,
    deleteArchive: true,
    extract: true,
    password: '',
  });
  manager.tasks.set('p2', {
    id: 'p2',
    status: 'completed',
    filePath: part2,
    name: 'Serie.part2.rar',
    destination: dir,
    deleteArchive: true,
    extract: true,
    password: '',
  });
  state.sevenCmd = async () => {
    const error = new Error('Failed');
    error.stderr = 'Wrong password';
    throw error;
  };
  await manager.maybeExtractVolume(archiveVolume('Serie.part1.rar'));
  assert.equal(manager.tasks.get('p1').status, 'password-required');
  assert.match(manager.tasks.get('p1').error, /Wrong password/);
});

const embedHtml = (title, entries) => `<html><head><title>${title}</title></head><body>
${entries
  .map(
    ([id, kind, name, mime]) =>
      `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/${kind === 'folder' ? `drive/folders/${id}` : `file/d/${id}/view`}?usp=drive_web" target="_blank"><div class="flip-entry-visual"><div class="flip-entry-visual-card"><div class="flip-entry-thumb"><img src="https://lh3.googleusercontent.com/x=s190" alt=""/></div></div></div><div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/${mime}" alt=""/></div><div class="flip-entry-title">${name}</div></a></div><div class="flip-entry-last-modified"><div>May 28</div></div></div>`,
  )
  .join('\n')}
</body></html>`;

test('analyze expande una carpeta pública de Google Drive sin API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch((url) => {
    if (url.includes('embeddedfolderview?id=ROOT'))
      return embedHtml('S1', [
        ['f1', 'file', 'Cap 1.mkv', 'video/x-matroska'],
        ['f2', 'file', 'Cap 2.mp4', 'video/mp4'],
        ['sub', 'folder', 'Subtítulos', 'application/vnd.google-apps.folder'],
      ]);
    if (url.includes('embeddedfolderview?id=sub'))
      return embedHtml('Subtítulos', [['f3', 'file', 'Ep 3.avi', 'video/x-msvideo']]);
    return embedHtml('Root', []);
  });
  const results = await manager.analyze('https://drive.google.com/drive/folders/ROOT');
  assert.equal(results.length, 3);
  assert.equal(results[0].name, 'Cap 1.mkv');
  assert.equal(results[0].mode, 'google-drive-folder');
  assert.equal(results[0].online, true);
  assert.equal(results[0].collection, 'S1');
  assert.ok(results[0].url.includes('/uc?export=download&id=f1'));
  assert.ok(results[0].originalUrl.includes('/file/d/f1/view'));
  assert.equal(results[2].name, 'Ep 3.avi');
  assert.equal(results[2].collection, 'S1 / Subtítulos');
});

test('analyze omite carpetas sin archivos descargables sin API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch(() => embedHtml('Vacia', []));
  const results = await manager.analyze('https://drive.google.com/drive/folders/ROOT');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, true);
  assert.match(results[0].error, /vacía|no es pública/);
});

const warningForm = (
  fileId,
) => `<html><head><title>Google Drive - Virus scan warning</title></head><body>
<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="submit" id="uc-download-link" value="Download anyway"/><input type="hidden" name="id" value="${fileId}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="abc-123"></form></body></html>`;

test('analyze resuelve un archivo de Google Drive sin API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch((url) => {
    if (url.includes('/uc?export=download&id=f1')) return warningForm('f1');
    return '<html><head><title>guia.pdf - Google Drive</title></head><body>x</body></html>';
  });
  const results = await manager.analyze('https://drive.google.com/file/d/f1/view');
  assert.equal(results.length, 1);
  assert.equal(results[0].mode, 'google-drive-file');
  assert.equal(results[0].online, true);
  assert.equal(results[0].name, 'guia.pdf');
  assert.ok(results[0].url.includes('drive.usercontent.google.com/download?id=f1'));
  assert.ok(results[0].url.includes('confirm=t'));
  assert.ok(results[0].url.includes('uuid=abc-123'));
});

test('analyze marca offline un archivo de Drive con cuota superada sin API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch(
    () =>
      '<html><head><title>Google Drive - Quota exceeded</title></head><body>Sorry, you can\u2019t view or download this file at this time. Too many users have viewed or downloaded this file recently.</body></html>',
  );
  const results = await manager.analyze('https://drive.google.com/file/d/f1/view');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, false);
  assert.equal(results[0].name, 'Archivo de Google Drive');
  assert.match(results[0].error, /cuota|saturado|demasiados/);
});

test('resolveGoogleDriveUrl sigue la redirección de archivos pequeños', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch((url) => {
    if (url.includes('/uc?export=download'))
      return {
        status: 302,
        headers: {
          location:
            'https://drive.usercontent.google.com/download?id=f1&export=download&authuser=0&confirm=t&uuid=x',
        },
      };
    return { body: 'BINARY', headers: { 'content-type': 'video/mp4' } };
  });
  const resolved = await manager.resolveGoogleDriveUrl('f1');
  assert.equal(
    resolved.url,
    'https://drive.usercontent.google.com/download?id=f1&export=download&authuser=0&confirm=t&uuid=x',
  );
  assert.equal(resolved.error, undefined);
});

test('googleDriveErrorInFile detecta páginas HTML de error de Google', () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const html = path.join(dir, 'cap.mkv');
  fs.writeFileSync(
    html,
    '<html><head><title>Google Drive - Quota exceeded</title></head><body>Too many users have viewed or downloaded this file recently</body></html>',
  );
  assert.match(manager.googleDriveErrorInFile(html), /cuota/);
  fs.writeFileSync(
    html,
    '<html><head><title>Google Drive - Virus scan warning</title></head><body>x</body></html>',
  );
  assert.match(manager.googleDriveErrorInFile(html), /escaneo/);
  fs.writeFileSync(html, 'MZ\x90\x00 binary fake');
  assert.equal(manager.googleDriveErrorInFile(html), '');
  fs.writeFileSync(html, Buffer.alloc(2 * 1024 * 1024, 65));
  assert.equal(manager.googleDriveErrorInFile(html), '');
});

test('start falla temprano por cuota al refrescar la URL de Drive', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  await installWebFetch(
    () =>
      '<html><head><title>Google Drive - Quota exceeded</title></head><body>Too many users are currently viewing this file</body></html>',
  );
  manager.settings.concurrency = 0;
  const task = {
    id: 'd1',
    originalUrl: 'https://drive.google.com/file/d/f1/view',
    url: 'https://drive.google.com/uc?export=download&id=f1',
    name: 'cap.mkv',
    destination: dir,
    host: 'drive.google.com',
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  await manager.start(task);
  assert.equal(task.status, 'error');
  assert.match(task.error, /saturado|cuota/);
  assert.equal(state.dlInstances.length, 0);
});

test('la cola continúa tras un refresco de Drive bloqueado por cuota', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  await installWebFetch(
    () =>
      '<html><head><title>Google Drive - Quota exceeded</title></head><body>Too many users are currently viewing this file</body></html>',
  );
  manager.settings.concurrency = 1;
  const driveTask = {
    id: 'fd1',
    originalUrl: 'https://drive.google.com/file/d/f1/view',
    url: 'https://drive.google.com/uc?export=download&id=f1',
    name: 'cap.mkv',
    destination: dir,
    host: 'drive.google.com',
    status: 'pending',
    createdAt: 1,
  };
  const nextTask = {
    id: 'fd2',
    originalUrl: 'https://ejemplo.com/archivo.zip',
    url: 'https://ejemplo.com/archivo.zip',
    name: 'archivo.zip',
    destination: dir,
    host: 'ejemplo.com',
    status: 'pending',
    createdAt: 2,
  };
  manager.tasks.set(driveTask.id, driveTask);
  manager.tasks.set(nextTask.id, nextTask);
  manager.process();
  await waitUntil(() => state.dlInstances.length === 1);
  assert.equal(driveTask.status, 'error');
  assert.equal(nextTask.status, 'downloading');
  assert.equal(state.dlInstances[0].url, 'https://ejemplo.com/archivo.zip');
});

test('start descarta un archivo de Drive que bajó como página HTML de cuota', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 0;
  const taskFile = path.join(dir, 'cap.mkv');
  fs.writeFileSync(
    taskFile,
    '<html><head><title>Google Drive - Quota exceeded</title></head><body>Too many users have viewed this file</body></html>',
  );
  const task = {
    id: 'd2',
    originalUrl: 'https://drive.google.com/a',
    url: 'https://drive.usercontent.google.com/download?id=f1&export=download',
    name: 'cap.mkv',
    destination: dir,
    host: 'drive.google.com',
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  await waitUntil(() => state.dlInstances.length === 1);
  state.dlInstances[0].emit('end', { filePath: taskFile });
  await waitUntil(() => task.status === 'error');
  assert.match(task.error, /cuota/);
  assert.equal(fs.existsSync(taskFile), false);
  assert.equal(task.filePath, '');
});

test('resolveGoogleDriveUrl captura la cookie de confirmación de archivos grandes', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch((url) => {
    if (url.includes('/uc?export=download'))
      return {
        body: warningForm('f1'),
        headers: {
          'set-cookie': [
            'download_warning_1r-Itj=DLTNvUx; expires=Thu, 01-Jan-2037 00:00:00 GMT; path=/; HttpOnly',
            'NID=xyz123; expires=Thu, 01-Jan-2037 00:00:00 GMT; path=/; HttpOnly',
          ],
        },
      };
    return '<html><head><title>x</title></head></html>';
  });
  const resolved = await manager.resolveGoogleDriveUrl('f1');
  assert.ok(resolved.url.includes('confirm=t'));
  assert.ok(resolved.url.includes('uuid=abc-123'));
  assert.match(resolved.cookie, /download_warning_1r-Itj=DLTNvUx/);
  assert.ok(!resolved.cookie.includes('NID=xyz123'));
});

test('resolveGoogleDriveUrl resuelve el flujo clásico solo con confirm', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installWebFetch((url) => {
    if (url.includes('/uc?export=download&id=legacy&confirm=t'))
      return {
        status: 302,
        headers: {
          location:
            'https://drive.usercontent.google.com/download?id=legacy&export=download&authuser=0&confirm=t&uuid=x',
        },
      };
    if (url.includes('/uc?export=download'))
      return {
        body:
          '<html><body><form id="download-form" action="/uc?export=download" method="get">' +
          '<input type="hidden" name="id" value="legacy">' +
          '<input type="hidden" name="confirm" value="t"></form></body></html>',
        headers: { 'set-cookie': ['download_warning_legacy=ABC; path=/'] },
      };
    return { body: 'BINARY', headers: { 'content-type': 'video/mp4' } };
  });
  const resolved = await manager.resolveGoogleDriveUrl('legacy');
  assert.ok(resolved.url.includes('drive.usercontent.google.com/download?id=legacy'));
  assert.match(resolved.cookie, /download_warning_legacy=ABC/);
});

test('resolveGoogleDriveUrl reenvía las cookies capturadas durante la resolución', async () => {
  resetStubs();
  const { manager } = makeManager();
  let confirmCookieSeen = false;
  await installWebFetch((url, options) => {
    if (url.includes('confirm=t'))
      confirmCookieSeen = String(options?.headers?.Cookie || '').includes('download_warning_c2=42');
    if (url.includes('/uc?export=download&id=c2&confirm=t'))
      return {
        status: 302,
        headers: { location: 'https://drive.usercontent.google.com/download?id=c2' },
      };
    if (url.includes('/uc?export=download'))
      return {
        body: '<html><body><form id="download-form" action="/uc?export=download"><input type="hidden" name="id" value="c2"><input type="hidden" name="confirm" value="t"></form></body></html>',
        headers: { 'set-cookie': ['download_warning_c2=42; path=/'] },
      };
    return { body: 'BINARY', headers: { 'content-type': 'video/mp4' } };
  });
  await manager.resolveGoogleDriveUrl('c2');
  assert.equal(confirmCookieSeen, true);
});

test('parseDriveConfirmation tolera comillas simples y orden de atributos', () => {
  resetStubs();
  const { manager } = makeManager();
  const html =
    '<html><body><form id="download-form" action=\'https://drive.usercontent.google.com/download\' method="get">' +
    '<input type="hidden" value="v1" name="id">' +
    '<input name="confirm" value="tok">' +
    '<input type="hidden" name="uuid" value="u-7"></form></body></html>';
  const parsed = manager.parseDriveConfirmation(
    html,
    'https://drive.google.com/uc?export=download&id=v1',
    'v1',
  );
  assert.ok(parsed.url.includes('?id=v1'));
  assert.ok(parsed.url.includes('confirm=tok'));
  assert.ok(parsed.url.includes('uuid=u-7'));
});

test('start envía la cookie de confirmación al descargador de Drive', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  await installWebFetch((url) => {
    if (url.includes('/uc?export=download'))
      return {
        body: warningForm('f1'),
        headers: { 'set-cookie': ['download_warning_1r-Itj=DLTNvUx; path=/; HttpOnly'] },
      };
    return '<html><head><title>guia.pdf - Google Drive</title></head></html>';
  });
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 0;
  const task = {
    id: 'd4',
    originalUrl: 'https://drive.google.com/file/d/f1/view',
    url: 'https://drive.google.com/uc?export=download&id=f1',
    name: 'guia.pdf',
    destination: dir,
    host: 'drive.google.com',
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  await waitUntil(() => state.dlInstances.length === 1);
  assert.equal(state.dlInstances[0].options.headers.Cookie, 'download_warning_1r-Itj=DLTNvUx');
  assert.equal(
    state.dlInstances[0].options.headers['User-Agent'],
    'Mozilla/5.0 Chrome/140 Safari/537.36',
  );
});

test('start completa un archivo de Drive que no es HTML', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 0;
  const taskFile = path.join(dir, 'cap.mkv');
  fs.writeFileSync(taskFile, 'MZ binary content');
  const task = {
    id: 'd3',
    originalUrl: 'https://drive.google.com/a',
    url: 'https://drive.usercontent.google.com/download?id=f1&export=download',
    name: 'cap.mkv',
    destination: dir,
    host: 'drive.google.com',
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  await waitUntil(() => state.dlInstances.length === 1);
  state.dlInstances[0].emit('end', { filePath: taskFile });
  await waitUntil(() => task.status === 'completed');
  assert.equal(task.filePath, taskFile);
});

test('analyze compone el nombre de enlaces directos a partir del título', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.urlResolver.resolveUrl = async (url) => ({
    finalUrl: 'https://cdn.example.com/dir/archivo.pdf',
    domain: 'example.com',
    mode: 'direct',
    chain: [{ status: 200 }],
    title: url.endsWith('std.pdf') ? 'Archivo PDF' : 'archivo.pdf',
  });
  const conSufijo = await manager.analyze('https://cdn.example.com/dir/archivo-std.pdf');
  const exacto = await manager.analyze('https://cdn.example.com/dir/archivo.pdf');
  assert.equal(conSufijo[0].name, 'Archivo PDF.pdf');
  assert.equal(exacto[0].name, 'archivo.pdf');
});

test('analyze marca offline un archivo de una carpeta MediaFire que no resuelve', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.urlResolver.resolveUrl = async () => {
    throw new Error('el enlace expiró');
  };
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'Fotos' } } };
    if (url.includes('content_type=files'))
      return {
        response: {
          folder_content: {
            files: [
              {
                filename: 'foto.jpg',
                links: { normal_download: 'https://www.mediafire.com/file/x/foto.jpg' },
              },
              { filename: 'sin-enlace.jpg' },
            ],
          },
        },
      };
    return { response: { folder_content: { folders: [] } } };
  });
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results.length, 1);
  assert.equal(results[0].online, false);
  assert.equal(results[0].selected, false);
  assert.match(results[0].error, /enlace expiró/);
});

test('start refresca la URL de tareas ya iniciadas', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  state.urlResolver.resolveUrl = async () => ({
    finalUrl: 'https://newcdn.example.com/fresh.zip',
    domain: 'example.com',
    mode: 'direct',
    chain: [{ status: 200 }],
  });
  manager.tasks.set('t1', {
    id: 't1',
    originalUrl: 'https://cdn.example.com/original.zip',
    url: 'https://oldcdn.example.com/x.zip',
    name: 'fresh.zip',
    destination: dir,
    host: 'example.com',
    status: 'pending',
    startedOnce: true,
  });
  manager.start(manager.tasks.get('t1'));
  await waitUntil(() => [...manager.tasks.values()][0].status === 'downloading');
  assert.equal(manager.tasks.get('t1').url, 'https://newcdn.example.com/fresh.zip');
  state.dlInstances[0].emit('stop');
  await waitUntil(() => manager.active.size === 0 && manager.tasks.get('t1').status === 'stopped');
});

test('start conserva la URL si refrescar el enlace falla', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  state.urlResolver.resolveUrl = async () => {
    throw new Error('expiró');
  };
  manager.tasks.set('t1', {
    id: 't1',
    originalUrl: 'https://cdn.example.com/original.zip',
    url: 'https://oldcdn.example.com/x.zip',
    name: 'fresh.zip',
    destination: dir,
    host: 'example.com',
    status: 'pending',
    startedOnce: true,
  });
  manager.start(manager.tasks.get('t1'));
  await waitUntil(() => [...manager.tasks.values()][0].status === 'downloading');
  assert.equal(manager.tasks.get('t1').url, 'https://oldcdn.example.com/x.zip');
  state.dlInstances[0].emit('stop');
  await waitUntil(() => manager.active.size === 0 && manager.tasks.get('t1').status === 'stopped');
});

test('start actualiza el progreso con los eventos throttled', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  manager.tasks.set('t1', {
    id: 't1',
    originalUrl: 'https://cdn.example.com/fresh.zip',
    url: 'https://cdn.example.com/fresh.zip',
    name: 'fresh.zip',
    destination: dir,
    host: 'example.com',
    status: 'pending',
  });
  manager.start(manager.tasks.get('t1'));
  await waitUntil(() => manager.active.size === 1);
  state.dlInstances[0].emit('progress.throttled', {
    progress: 50,
    speed: 120,
    downloaded: 1024,
    total: 2048,
  });
  const task = manager.tasks.get('t1');
  assert.equal(task.progress, 50);
  assert.equal(task.speed, 120);
  assert.equal(task.downloaded, 1024);
  assert.equal(task.total, 2048);
  // Sin estadísticas completas se rellenan con ceros.
  state.dlInstances[0].emit('progress.throttled', {});
  assert.equal(task.progress, 0);
  assert.equal(task.speed, 0);
  assert.equal(task.downloaded, 0);
  assert.equal(task.total, 0);
  state.dlInstances[0].emit('stop');
  await waitUntil(() => manager.active.size === 0 && task.status === 'stopped');
});

test('end marca lista la parte y difiere la extracción de un volumen multiparte', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = true;
  manager.settings.concurrency = 1;
  const part1 = path.join(dir, 'Serie.part1.rar');
  const part2 = path.join(dir, 'Serie.part2.rar');
  fs.writeFileSync(part1, 'p1');
  manager.tasks.set('p2', {
    id: 'p2',
    status: 'downloading',
    name: 'Serie.part2.rar',
    filePath: '',
    destination: dir,
  });
  manager.tasks.set('extra', { id: 'extra' });
  manager.add([
    {
      originalUrl: 'https://cdn.example.com/Serie.part1.rar',
      url: 'https://cdn.example.com/Serie.part1.rar',
      name: 'Serie.part1.rar',
      host: 'example.com',
      destination: dir,
      extract: true,
      deleteArchive: false,
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const task = [...manager.tasks.values()].find((item) => item.name === 'Serie.part1.rar');
  state.dlInstances[0].emit('end', { filePath: part1 });
  await waitUntil(() => manager.active.size === 0 && task.status === 'completed');
  assert.equal(task.progress, 100);
  assert.equal(fs.existsSync(part1), true);
  assert.equal(manager.volumeExtracting.has(archiveVolume('Serie.part1.rar').key), false);
});

test('end extrae y elimina un comprimido simple tras descargarlo', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = true;
  manager.settings.concurrency = 1;
  const file = path.join(dir, 'datos.zip');
  fs.writeFileSync(file, 'zip-content');
  manager.add([
    {
      originalUrl: 'https://cdn.example.com/datos.zip',
      url: 'https://cdn.example.com/datos.zip',
      name: 'datos.zip',
      host: 'example.com',
      destination: dir,
      extract: true,
      deleteArchive: true,
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const task = [...manager.tasks.values()][0];
  state.sevenCmd = async () => {};
  state.dlInstances[0].emit('end', { filePath: file });
  await waitUntil(() => task.status === 'completed');
  assert.equal(fs.existsSync(file), false);
  assert.equal(task.extractedTo, path.join(dir, 'datos'));
});

test('end marca password-required si la extracción rechaza la contraseña', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = true;
  manager.settings.concurrency = 1;
  const file = path.join(dir, 'datos.zip');
  fs.writeFileSync(file, 'zip-content');
  manager.add([
    {
      originalUrl: 'https://cdn.example.com/datos.zip',
      url: 'https://cdn.example.com/datos.zip',
      name: 'datos.zip',
      host: 'example.com',
      destination: dir,
      extract: true,
      deleteArchive: false,
    },
  ]);
  await waitUntil(() => manager.active.size === 1);
  const task = [...manager.tasks.values()][0];
  state.sevenCmd = async () => {
    const error = new Error('Failed');
    error.stderr = 'Wrong password';
    throw error;
  };
  state.dlInstances[0].emit('end', { filePath: file });
  await waitUntil(() => task.status === 'password-required');
  assert.match(task.error, /Wrong password/);
});

test('startVideo refleja el progreso reportado por el descargador', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.concurrency = 0;
  let onProgress = null;
  let videoOptions = null;
  state.video.downloadVideo = (options) => {
    videoOptions = options;
    onProgress = options.onProgress;
    return { result: Promise.resolve({ filePath: path.join(dir, 'cap.mp4') }) };
  };
  const task = {
    id: 'v3',
    originalUrl: 'https://youtube.com/watch?v=abc',
    videoFormat: 'video:best',
    name: 'cap',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  // Sin videoUrl propia descarga desde la URL original.
  assert.equal(videoOptions.url, task.originalUrl);
  onProgress({ progress: 55, speed: 30, downloaded: 5, total: 10 });
  assert.equal(task.progress, 55);
  assert.equal(task.speed, 30);
  await waitUntil(() => task.status === 'completed');
  assert.equal(task.filePath, path.join(dir, 'cap.mp4'));
});

test('analyze acepta enlaces sin cadena de redirección', async () => {
  resetStubs();
  const { manager } = makeManager();
  state.urlResolver.resolveUrl = async () => ({
    finalUrl: 'https://cdn.example.com/x.zip',
    domain: 'example.com',
    mode: 'direct',
    chain: [],
  });
  const results = await manager.analyze('https://cdn.example.com/x.zip');
  assert.equal(results[0].online, true);
});

test('analyze usa el mensaje de carpetas como error de MediaFire', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'F' } } };
    if (url.includes('content_type=files')) return { response: {} };
    return { response: { message: 'Error de carpetas' } };
  });
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results[0].online, false);
  assert.match(results[0].error, /Error de carpetas/);
});

test('analyze reporta el error genérico cuando MediaFire no responde', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'F' } } };
    return { response: {} };
  });
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results[0].online, false);
  assert.match(results[0].error, /MediaFire no permitió leer/);
});

test('analyze devuelve la carpeta MediaFire no soportada si está vacía', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'F' } } };
    if (url.includes('content_type=files')) return { response: { folder_content: { files: [] } } };
    return { response: { folder_content: {} } };
  });
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, true);
});

test('analyze recorre carpetas de MediaFire sin archivos en la raíz', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'F' } } };
    if (url.includes('content_type=files')) return { response: { folder_content: {} } };
    return { response: { folder_content: { folders: [] } } };
  });
  const results = await manager.analyze('https://www.mediafire.com/folder/abc123');
  assert.equal(results[0].online, false);
});

test('expandGoogleDriveFolder recorre varias páginas de resultados', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  await installFetch((url) => {
    if (url.includes('/files/ROOT')) {
      return { id: 'ROOT', name: 'Raiz', mimeType: 'application/vnd.google-apps.folder' };
    }
    if (url.includes('/files?')) {
      const calls = state.fetchCalls.filter((c) => c.includes('/files?'));
      if (calls.length === 1)
        return {
          files: [{ id: 'a', name: 'a.txt', mimeType: 'text/plain' }],
          nextPageToken: 'TOK',
        };
      return {};
    }
    return { name: 'x' };
  });
  const results = await manager.expandGoogleDriveFolder(
    'ROOT',
    'https://drive.google.com/drive/folders/ROOT',
  );
  assert.equal(results.length, 1);
  assert.equal(state.fetchCalls.filter((c) => c.includes('/files?')).length, 2);
});

test('googleDriveRequest incluye el código de estado sin mensaje', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({}),
  });
  await assert.rejects(manager.googleDriveRequest('files/x'), /403/);
});

test('recover ignora extracciones sin archivo en disco', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.tasks.set('t1', { id: 't1', status: 'extracting' });
  await manager.recover();
  assert.equal(manager.tasks.get('t1').status, 'extracting');
});

test('startVideo ignora el resultado si la tarea ya no está activa', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.concurrency = 0;
  state.video.downloadVideo = () => ({
    result: Promise.resolve({ filePath: path.join(dir, 'cap.mp4') }),
  });
  const task = {
    id: 'v4',
    videoUrl: 'https://youtube.com/watch?v=abc',
    videoFormat: 'video:best',
    name: 'cap',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  manager.active.delete(task.id);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(task.status, 'downloading');
});

test('startVideo ignora el fallo si la tarea ya no está activa', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.concurrency = 0;
  state.video.downloadVideo = () => ({ result: Promise.reject(new Error('falló')) });
  const task = {
    id: 'v5',
    videoUrl: 'https://youtube.com/watch?v=abc',
    videoFormat: 'video:best',
    name: 'cap',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(task.id, task);
  manager.start(task);
  manager.active.delete(task.id);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(task.status, 'downloading');
});

test('startVideo conserva el filePath previo cuando no lo reporta', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.concurrency = 0;
  state.video.downloadVideo = () => ({ result: Promise.resolve({}) });
  const keep = {
    id: 'v6',
    videoUrl: 'https://youtube.com/watch?v=abc',
    videoFormat: 'video:best',
    name: 'keep',
    filePath: 'prev.mp4',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(keep.id, keep);
  manager.start(keep);
  await waitUntil(() => keep.status === 'completed');
  assert.equal(keep.filePath, 'prev.mp4');
  const empty = {
    id: 'v7',
    videoUrl: 'https://youtube.com/watch?v=def',
    videoFormat: 'video:best',
    name: 'empty',
    destination: dir,
    status: 'pending',
  };
  manager.tasks.set(empty.id, empty);
  manager.start(empty);
  await waitUntil(() => empty.status === 'completed');
  assert.equal(empty.filePath, '');
});

test('expandMediafireFolder limita el resultado a 500 elementos', async () => {
  resetStubs();
  const { manager } = makeManager();
  await installFetch((url) => {
    if (url.includes('get_info')) return { response: { folder_info: { name: 'Grande' } } };
    if (url.includes('content_type=files'))
      return {
        response: {
          folder_content: {
            files: Array.from({ length: 500 }, (_, i) => ({
              filename: `archivo${i}.bin`,
              links: { normal_download: `https://www.mediafire.com/file/${i}` },
            })),
          },
        },
      };
    return { response: { folder_content: { folders: [{ folderkey: 'SUB', name: 'Sub' }] } } };
  });
  const results = await manager.expandMediafireFolder(
    'ROOT',
    'https://www.mediafire.com/folder/ROOT',
  );
  assert.equal(results.length, 500);
});

test('expandGoogleDriveFolder limita el resultado a 500 elementos', async () => {
  resetStubs();
  const { manager } = makeManager();
  manager.settings.googleDriveApiKey = 'KEY';
  await installFetch((url) => {
    if (url.includes('/files/ROOT')) {
      return { id: 'ROOT', name: 'Grande', mimeType: 'application/vnd.google-apps.folder' };
    }
    if (url.includes('/files?'))
      return {
        files: Array.from({ length: 501 }, (_, i) => ({
          id: `f${i}`,
          name: `f${i}.txt`,
          mimeType: 'text/plain',
        })),
        nextPageToken: '',
      };
    return { name: 'x' };
  });
  const results = await manager.expandGoogleDriveFolder(
    'ROOT',
    'https://drive.google.com/drive/folders/ROOT',
  );
  assert.equal(results.length, 500);
});

test('start reacciona al evento pause del descargador', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  manager.settings.autoExtract = false;
  manager.settings.concurrency = 1;
  manager.tasks.set('t1', {
    id: 't1',
    url: 'https://cdn.example.com/a.bin',
    name: 'a.bin',
    destination: dir,
    status: 'pending',
  });
  manager.start(manager.tasks.get('t1'));
  await waitUntil(() => manager.active.size === 1);
  const task = manager.tasks.get('t1');
  state.dlInstances[0].emit('pause');
  await waitUntil(() => manager.active.size === 0 && task.status === 'paused');
});

test('extract rechaza si la extracción excede el tiempo de espera', async () => {
  resetStubs();
  const { manager, dir } = makeManager();
  const file = path.join(dir, 'solo.zip');
  fs.writeFileSync(file, 'x');
  const task = {
    id: 't1',
    name: 'solo.zip',
    filePath: file,
    destination: dir,
    status: 'completed',
  };
  let timerCallback = null;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => {
    timerCallback = callback;
    return { unref() {} };
  };
  try {
    state.sevenCmd = () => new Promise(() => {});
    const extraction = manager.extract(task);
    await new Promise((resolve) => setImmediate(resolve));
    global.setTimeout = originalSetTimeout;
    const rejection = assert.rejects(extraction, /superó el tiempo máximo de espera/);
    timerCallback();
    await rejection;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test('resolveSevenZa busca binarios alternativos cuando no hay 7zip empotrado', () => {
  let fsExists = () => false;
  let binaryPath = 'C:/fake/7za.exe';
  let lastBinaryPath = null;
  installHooks({
    'node:fs': { ...fs, existsSync: (p) => fsExists(p) },
    'node-downloader-helper': { DownloaderHelper: FakeDownloaderHelper },
    '7zip-min': {
      config(props) {
        lastBinaryPath = props.binaryPath;
      },
      cmd(args) {
        state.sevenArgs = args;
        return Promise.resolve();
      },
    },
    '7zip-bin': {
      get path7za() {
        return binaryPath;
      },
    },
    './urlResolver.cjs': { resolveUrl: (url) => state.urlResolver.resolveUrl(url) },
    './videoProvider.cjs': {
      isVideoLink: (url) => state.video.isVideoLink(url),
      isPlaylistUrl: (url) => state.video.isPlaylistUrl(url),
      listVideoFormats: (url) => state.video.listVideoFormats(url),
      listPlaylistVideos: (url) => state.video.listPlaylistVideos(url),
      listVideoQualityOptions: (url) => state.video.listVideoQualityOptions(url),
      downloadVideo: (options) => state.video.downloadVideo(options),
    },
  });
  try {
    const fromResources = path.join(
      '',
      'app.asar.unpacked',
      'node_modules',
      '7zip-bin',
      'win',
      process.arch,
      '7za.exe',
    );
    const scenarios = [
      {
        binaryPath: 'C:/resources/app.asar/vendor/7za.exe',
        fsExists: (p) => p === 'C:/resources/app.asar.unpacked/vendor/7za.exe',
        expected: 'C:/resources/app.asar.unpacked/vendor/7za.exe',
      },
      {
        binaryPath: 'C:/tools/app.asar/bin/7za.exe',
        fsExists: (p) => p === 'C:/tools/app.asar/bin/7za.exe',
        expected: 'C:/tools/app.asar/bin/7za.exe',
      },
      {
        binaryPath: 'C:/tools/7za.exe',
        fsExists: (p) => p === fromResources,
        expected: fromResources,
      },
      {
        binaryPath: 'C:/tools/7za.exe',
        fsExists: () => false,
        expected: 'C:/tools/7za.exe',
      },
    ];
    for (const scenario of scenarios) {
      binaryPath = scenario.binaryPath;
      fsExists = scenario.fsExists;
      delete require.cache[require.resolve('../electron/downloadManager.cjs')];
      require('../electron/downloadManager.cjs');
      assert.equal(lastBinaryPath, scenario.expected);
    }
  } finally {
    restoreHooks();
    delete require.cache[require.resolve('../electron/downloadManager.cjs')];
  }
});

test('diskInfo usa el respaldo de PowerShell si statfs no está disponible', () => {
  let statfsError = new Error('sin statfs');
  let statfsResult = null;
  let execThrows = false;
  let execOutput = '';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-fs-test-'));
  installHooks({
    'node:fs': {
      ...fs,
      statfsSync(...args) {
        if (statfsError) throw statfsError;
        if (statfsResult) return statfsResult;
        return fs.statfsSync(...args);
      },
    },
    'node:child_process': {
      execFileSync() {
        if (execThrows) throw new Error('powershell falló');
        return execOutput;
      },
    },
    'node-downloader-helper': { DownloaderHelper: FakeDownloaderHelper },
    '7zip-min': { config() {}, cmd: () => Promise.resolve() },
    '7zip-bin': {
      get path7za() {
        return state.sevenBinary;
      },
    },
    './urlResolver.cjs': { resolveUrl: (url) => state.urlResolver.resolveUrl(url) },
    './videoProvider.cjs': {
      isVideoLink: (url) => state.video.isVideoLink(url),
      isPlaylistUrl: (url) => state.video.isPlaylistUrl(url),
      listVideoFormats: (url) => state.video.listVideoFormats(url),
      listPlaylistVideos: (url) => state.video.listPlaylistVideos(url),
      listVideoQualityOptions: (url) => state.video.listVideoQualityOptions(url),
      downloadVideo: (options) => state.video.downloadVideo(options),
    },
  });
  try {
    delete require.cache[require.resolve('../electron/downloadManager.cjs')];
    const { DownloadManager: FreshDownloadManager } = require('../electron/downloadManager.cjs');
    const inst = new FreshDownloadManager(path.join(dataDir, 'downloads.json'), () => {});
    execThrows = false;
    execOutput = '100 50';
    assert.deepEqual(inst.diskInfo('C:\\'), { drive: 'C:', total: 100, free: 50 });
    execThrows = true;
    assert.deepEqual(inst.diskInfo('C:\\'), { drive: 'C:', total: 0, free: 0 });
    execThrows = false;
    execOutput = 'abc xyz';
    assert.deepEqual(inst.diskInfo('C:\\'), { drive: 'C:', total: 0, free: 0 });
    statfsError = null;
    statfsResult = { blocks: 200, bfree: 100, bsize: 0 };
    assert.deepEqual(inst.diskInfo('C:\\'), { drive: 'C:', total: 102400, free: 51200 });
  } finally {
    restoreHooks();
    delete require.cache[require.resolve('../electron/downloadManager.cjs')];
  }
});
