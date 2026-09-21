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
};

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

test('analyze marca carpetas MEGA como no soportadas', async () => {
  resetStubs();
  const { manager } = makeManager();
  const results = await manager.analyze('https://mega.nz/folder/abc');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, true);
  assert.match(results[0].host, /MEGA/);
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

test('analyze reporta errores de carpeta de Google Drive sin API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  const results = await manager.analyze('https://drive.google.com/drive/folders/FOLDER');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, true);
  assert.match(results[0].error, /API key/);
});

test('analyze reporta errores de archivo de Google Drive sin API key', async () => {
  resetStubs();
  const { manager } = makeManager();
  const results = await manager.analyze('https://drive.google.com/file/d/F1/view');
  assert.equal(results[0].online, false);
  assert.equal(results[0].folderLink, false);
  assert.equal(results[0].name, 'Archivo de Google Drive');
  assert.match(results[0].error, /API key/);
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
