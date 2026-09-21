const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DownloadManager,
  extractLinks,
  archiveVolume,
  extractionFailureStatus,
  extractionErrorMessage,
} = require('../electron/downloadManager.cjs');

const manager = new DownloadManager('unused-download-test.json', () => {});

test('reconoce claves de carpetas MediaFire modernas y antiguas', () => {
  assert.equal(
    manager.mediafireFolderKey('https://www.mediafire.com/folder/abc123/photos'),
    'abc123',
  );
  assert.equal(
    manager.mediafireFolderKey('https://www.mediafire.com/folder/name#xyz789'),
    'xyz789',
  );
  assert.equal(manager.mediafireFolderKey('https://example.com/folder/abc123'), '');
  assert.equal(manager.mediafireFolderKey('https://www.mediafire.com/folder/'), '');
});

test('extrae IDs de carpetas de Google Drive', () => {
  assert.equal(
    manager.googleDriveFolderId('https://drive.google.com/drive/folders/abc-123?usp=sharing'),
    'abc-123',
  );
  assert.equal(manager.googleDriveFolderId('https://example.com/folders/abc-123'), '');
});

test('extrae IDs de archivos individuales de Google Drive', () => {
  assert.equal(
    manager.googleDriveFileId('https://drive.google.com/file/d/file-123/view?usp=drive_link'),
    'file-123',
  );
  assert.equal(manager.googleDriveFileId('https://drive.google.com/open?id=file-456'), 'file-456');
  assert.equal(manager.googleDriveFileId('https://drive.google.com/xyz'), '');
});

test('sanea nombres de descarga sin permitir rutas', () => {
  assert.equal(manager.sanitize('../bad:name.zip'), 'bad_name.zip');
});

test('extrae URLs de hipervínculos con esquema', () => {
  assert.deepEqual(
    extractLinks('Descarga: https://www.mediafire.com/file/2y8ej9vblr9jj9p/a.rar/file'),
    ['https://www.mediafire.com/file/2y8ej9vblr9jj9p/a.rar/file'],
  );
});

test('extrae URLs de descarga sin esquema de servidores compatibles', () => {
  assert.deepEqual(extractLinks('mediafire.com/file/2y8ej9vblr9jj9p/a.rar/file'), [
    'https://mediafire.com/file/2y8ej9vblr9jj9p/a.rar/file',
  ]);
  assert.deepEqual(extractLinks('www.mediafire.com/folder/z9poqwy3abryr/Anime'), [
    'https://www.mediafire.com/folder/z9poqwy3abryr/Anime',
  ]);
  assert.deepEqual(extractLinks('drive.google.com/drive/folders/abc-123'), [
    'https://drive.google.com/drive/folders/abc-123',
  ]);
  assert.deepEqual(extractLinks('mega.nz/file/xyz'), ['https://mega.nz/file/xyz']);
});

test('extrae URLs directas de descarga sin esquema', () => {
  assert.deepEqual(extractLinks('download3456.mediafire.com/xyz/a.bin'), [
    'https://download3456.mediafire.com/xyz/a.bin',
  ]);
});

test('extrae múltiples enlaces de texto mixto y limpia puntuación final', () => {
  const links = extractLinks(
    'Mira https://www.mediafire.com/file/a1b2c3/x.rar/file, y mega.nz/file/zzz. Termina.',
  );
  assert.deepEqual(links, [
    'https://www.mediafire.com/file/a1b2c3/x.rar/file',
    'https://mega.nz/file/zzz',
  ]);
});

test('deduplica enlaces repetidos y no captura texto sin URLs', () => {
  assert.deepEqual(extractLinks('hola mundo sin enlaces'), []);
  assert.deepEqual(extractLinks('https://a.com/1 https://a.com/1'), ['https://a.com/1']);
});

test('permite cambiar la contraseña de una tarea activa (descargando)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-update-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.tasks.set('t1', { id: 't1', status: 'downloading', password: '' });
  isolated.active.set('t1', {});
  assert.equal(isolated.update('t1', { password: 'secreta' }), true);
  assert.equal(isolated.tasks.get('t1').password, 'secreta');
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'downloads.json'), 'utf8'));
  assert.equal(persisted.tasks[0].password, 'secreta');
});

test('sigue bloqueando otros cambios en tareas activas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-update-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.tasks.set('t1', { id: 't1', status: 'downloading', progress: 10 });
  isolated.active.set('t1', {});
  assert.equal(isolated.update('t1', { progress: 99 }), false);
  assert.equal(isolated.tasks.get('t1').progress, 10);
  assert.equal(isolated.update('no-existe', { password: 'x' }), false);
});

test('pausar una descarga la detiene y libera el cupo de concurrencia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-pause-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.tasks.set('t1', { id: 't1', status: 'downloading', progress: 40 });
  let stopped = 0;
  let paused = 0;
  isolated.active.set('t1', {
    stop: () => stopped++,
    pause: () => paused++,
  });
  assert.equal(isolated.control('t1', 'pause'), true);
  assert.equal(isolated.tasks.get('t1').status, 'paused');
  // Debe detener el descargador (no solo "pausarlo") para que la conexión se
  // corte de verdad, y borrarlo de "active" para liberar el cupo.
  assert.equal(stopped, 1);
  assert.equal(paused, 0);
  assert.equal(isolated.active.has('t1'), false);
});

test('reanudar una descarga pausada la vuelve a poner en cola', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-resume-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  // Se pone la concurrencia en 0 para que control() no intente arrancar de
  // verdad la descarga (process()) al reanudarla; solo interesa el cambio
  // de estado que hace applyControl().
  isolated.settings.concurrency = 0;
  isolated.tasks.set('t1', { id: 't1', status: 'paused', progress: 40, error: 'x' });
  assert.equal(isolated.control('t1', 'resume'), true);
  const task = isolated.tasks.get('t1');
  assert.equal(task.status, 'pending');
  assert.equal(task.error, '');
});

test('guarda la preferencia de eliminar comprimido al agregar tareas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-add-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  const destination = path.join(dir, 'dest');
  isolated.add([
    {
      originalUrl: 'https://a.com/x.zip',
      url: 'https://a.com/x.zip',
      name: 'x.zip',
      host: 'a.com',
      destination,
      deleteArchive: false,
    },
    {
      originalUrl: 'https://b.com/y.zip',
      url: 'https://b.com/y.zip',
      name: 'y.zip',
      host: 'b.com',
      destination,
      deleteArchive: true,
    },
  ]);
  const tasks = [...isolated.tasks.values()];
  assert.equal(tasks[0].deleteArchive, false);
  assert.equal(tasks[1].deleteArchive, true);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'downloads.json'), 'utf8'));
  assert.equal(persisted.tasks[0].deleteArchive, false);
});

test('elimina el comprimido tras extraer solo cuando la tarea lo pide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-archive-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  const file = path.join(dir, 'x.zip');
  fs.writeFileSync(file, 'data');
  isolated.removeArchive({ id: 't1', deleteArchive: false, filePath: file });
  assert.equal(fs.existsSync(file), true);
  isolated.removeArchive({ id: 't2', deleteArchive: true, filePath: file });
  assert.equal(fs.existsSync(file), false);
});

test('reporta tamaño total y disponible del disco predeterminado', () => {
  const info = manager.diskInfo(process.platform === 'win32' ? 'C:\\' : '/');
  assert.ok(typeof info.drive === 'string' && info.drive.length > 0);
  assert.ok(Number.isFinite(info.total) && info.total >= 0);
  assert.ok(Number.isFinite(info.free) && info.free >= 0);
  // Sin ruta usa el disco actual.
  const defaults = manager.diskInfo();
  assert.ok(Number.isFinite(defaults.total) && Number.isFinite(defaults.free));
});

test('detecta comprimidos por partes estilo partN', () => {
  assert.deepEqual(archiveVolume('Serie.part1.rar'), {
    key: 'serie|rar|part',
    first: true,
    index: 1,
    baseName: 'Serie',
  });
  assert.deepEqual(archiveVolume('Serie.part12.rar'), {
    key: 'serie|rar|part',
    first: false,
    index: 12,
    baseName: 'Serie',
  });
  assert.deepEqual(archiveVolume('SHOW.PART2.RAR'), {
    key: 'show|rar|part',
    first: false,
    index: 2,
    baseName: 'SHOW',
  });
  // Solo usa el nombre base aunque venga con ruta completa.
  assert.equal(archiveVolume('/descargas/Peli.part1.7z').key, 'peli|7z|part');
});

test('detecta comprimidos por partes estilo numerado', () => {
  assert.deepEqual(archiveVolume('Movie.7z.001'), {
    key: 'movie|7z|num',
    first: true,
    index: 1,
    baseName: 'Movie',
  });
  assert.deepEqual(archiveVolume('Movie.ZIP.003'), {
    key: 'movie|zip|num',
    first: false,
    index: 3,
    baseName: 'Movie',
  });
});

test('ignora archivos que no son volúmenes multiparte', () => {
  assert.equal(archiveVolume('video.mp4'), null);
  assert.equal(archiveVolume('backup.rar'), null);
  assert.equal(archiveVolume('file.part1.mp4'), null);
  assert.equal(archiveVolume(''), null);
  assert.equal(archiveVolume(null), null);
});

test('clasifica errores de extracción por contraseña', () => {
  assert.equal(extractionFailureStatus({ stderr: 'ERROR: Wrong password' }), 'password-required');
  assert.equal(
    extractionFailureStatus({ message: 'Headers Error Data Error in encrypted file' }),
    'password-required',
  );
  assert.equal(
    extractionFailureStatus({ message: 'Ingrese la contraseña del archivo' }),
    'password-required',
  );
  assert.equal(extractionFailureStatus({ message: 'Cannot open file as archive' }), 'error');
  assert.equal(extractionFailureStatus({}), 'error');
  assert.equal(extractionFailureStatus(null), 'error');
  assert.equal(extractionFailureStatus(undefined), 'error');
});

test('extrae el mensaje de error de extracción', () => {
  assert.equal(extractionErrorMessage({ stderr: '  Wrong password  ' }), 'Wrong password');
  assert.equal(extractionErrorMessage({ message: 'falló 7z' }), 'falló 7z');
  assert.equal(extractionErrorMessage({}), 'No se pudo extraer el archivo.');
  assert.equal(extractionErrorMessage(null), 'No se pudo extraer el archivo.');
});

test('sanea nombres sin permitir rutas ni vacíos', () => {
  assert.ok(manager.sanitize('...').startsWith('download-'));
  assert.equal(manager.sanitize('archi?vo:final*2024'), 'archi_vo_final_2024');
  assert.equal(manager.sanitize('  hola mundo  '), '  hola mundo');
});

test('devuelve una carpeta no soportada con forma estable', () => {
  const folder = manager.unsupportedFolder('https://mega.nz/folder/abc', 'MEGA');
  assert.equal(folder.originalUrl, 'https://mega.nz/folder/abc');
  assert.equal(folder.url, 'https://mega.nz/folder/abc');
  assert.equal(folder.name, 'MEGA folder');
  assert.equal(folder.online, false);
  assert.equal(folder.selected, false);
  assert.equal(folder.folderLink, true);
  assert.ok(folder.error.length > 0);
});

test('rechaza claves de carpeta con entradas inválidas', () => {
  assert.equal(manager.mediafireFolderKey('no-es-url'), '');
  assert.equal(manager.googleDriveFolderId('no-es-url'), '');
  assert.equal(manager.googleDriveFileId('no-es-url'), '');
  assert.equal(manager.googleDriveFileId('https://drive.google.com/open?id=ABC123'), 'ABC123');
});

test('agregar tareas exige carpeta de destino', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-add-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  assert.throws(
    () => isolated.add([{ originalUrl: 'https://a.com/x.zip' }]),
    /carpeta de descarga/,
  );
  assert.equal(isolated.tasks.size, 0);
});

test('control rechaza ids y acciones inválidas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-control-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  assert.equal(isolated.control('no-existe', 'pause'), false);
  isolated.tasks.set('t1', { id: 't1', status: 'pending' });
  assert.equal(isolated.control('t1', 'inventado'), false);
  assert.equal(isolated.control('t1', 'pause'), false);
  // Detener una tarea en cola sí está permitido: pasa a detenida.
  assert.equal(isolated.control('t1', 'stop'), true);
  assert.equal(isolated.tasks.get('t1').status, 'stopped');
});

test('detener y eliminar tareas limpia el descargador activo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-stop-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  let stopped = 0;
  isolated.tasks.set('t1', { id: 't1', status: 'downloading' });
  isolated.active.set('t1', { stop: () => stopped++ });
  assert.equal(isolated.control('t1', 'stop'), true);
  assert.equal(isolated.tasks.get('t1').status, 'stopped');
  assert.equal(stopped, 1);
  assert.equal(isolated.active.has('t1'), false);
  assert.equal(isolated.control('t1', 'resume'), true);
  assert.equal(isolated.tasks.get('t1').status, 'pending');
  assert.equal(isolated.control('t1', 'remove'), true);
  assert.equal(isolated.tasks.has('t1'), false);
});

test('controlMany aplica la acción a varias tareas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-control-many-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  isolated.tasks.set('t1', { id: 't1', status: 'paused' });
  isolated.tasks.set('t2', { id: 't2', status: 'stopped' });
  assert.equal(isolated.controlMany(['t1', 't2', 'no-existe'], 'resume'), true);
  assert.equal(isolated.tasks.get('t1').status, 'pending');
  assert.equal(isolated.tasks.get('t2').status, 'pending');
  assert.equal(isolated.controlMany(['no-existe'], 'resume'), false);
});

test('limpiar completadas solo borra finalizadas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-clear-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.tasks.set('t1', { id: 't1', status: 'completed' });
  isolated.tasks.set('t2', { id: 't2', status: 'downloading' });
  isolated.clearCompleted();
  assert.equal(isolated.tasks.has('t1'), false);
  assert.equal(isolated.tasks.has('t2'), true);
});

test('la configuración limita la concurrencia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-settings-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.setSettings({ concurrency: 100 });
  assert.equal(isolated.settings.concurrency, 8);
  isolated.setSettings({ concurrency: -5 });
  assert.equal(isolated.settings.concurrency, 1);
  isolated.setSettings({});
  assert.equal(isolated.settings.concurrency, 3);
});

test('cargar estado marca pausadas las descargas activas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-load-test-'));
  const dataFile = path.join(dir, 'downloads.json');
  fs.writeFileSync(
    dataFile,
    JSON.stringify({
      settings: {},
      tasks: [
        { id: 't1', status: 'downloading', downloaded: 10 },
        { id: 't2', status: 'completed', downloaded: 0 },
      ],
    }),
  );
  const isolated = new DownloadManager(dataFile, () => {});
  assert.equal(isolated.tasks.get('t1').status, 'paused');
  assert.equal(isolated.tasks.get('t1').startedOnce, true);
  assert.equal(isolated.tasks.get('t2').status, 'completed');
});

test('release y fail actualizan estado y liberan el cupo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-release-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  const task = { id: 't1', status: 'downloading' };
  isolated.tasks.set('t1', task);
  isolated.active.set('t1', {});
  isolated.release(task, 'paused');
  assert.equal(task.status, 'paused');
  assert.equal(isolated.active.has('t1'), false);
  isolated.tasks.set('t2', { id: 't2', status: 'downloading' });
  isolated.active.set('t2', {});
  isolated.fail(isolated.tasks.get('t2'), new Error('boom'));
  assert.equal(isolated.tasks.get('t2').status, 'error');
  assert.equal(isolated.tasks.get('t2').error, 'boom');
  assert.equal(isolated.active.has('t2'), false);
  // Sin descargador activo no hacen nada.
  isolated.release(task, 'paused');
  isolated.fail(task, new Error('x'));
  assert.equal(task.status, 'paused');
});

test('maybeExtractVolume no hace nada si el volumen no está listo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-volume-test-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  await isolated.maybeExtractVolume(null);
  await isolated.maybeExtractVolume({});
  await isolated.maybeExtractVolume({ key: 'x' });
  const volume = archiveVolume('Serie.part1.rar');
  isolated.tasks.set('p1', {
    id: 'p1',
    status: 'downloading',
    name: 'Serie.part1.rar',
    filePath: '',
  });
  await isolated.maybeExtractVolume(volume);
  assert.equal(isolated.tasks.get('p1').status, 'downloading');
  assert.equal(isolated.volumeExtracting.has(volume.key), false);
});

test('actualiza tareas en cola sin restricciones de seguridad', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-update-pending-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  isolated.tasks.set('t1', { id: 't1', status: 'pending', progress: 0 });
  assert.equal(isolated.update('t1', { name: 'x.zip', progress: 5 }), true);
  assert.equal(isolated.tasks.get('t1').name, 'x.zip');
  assert.equal(isolated.tasks.get('t1').progress, 5);
  // Otros campos pasan igual aunque no venga nombre.
  assert.equal(isolated.update('t1', { progress: 6 }), true);
  assert.equal(isolated.tasks.get('t1').progress, 6);
});

test('eliminar una tarea activa detiene el descargador', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-remove-active-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  let stopped = 0;
  isolated.tasks.set('t1', { id: 't1', status: 'downloading' });
  isolated.active.set('t1', { stop: () => stopped++ });
  assert.equal(isolated.control('t1', 'remove'), true);
  assert.equal(stopped, 1);
  assert.equal(isolated.active.has('t1'), false);
  assert.equal(isolated.tasks.has('t1'), false);
});

test('no marca error si no puede borrar el comprimido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-remove-fail-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  const target = path.join(dir, 'carpeta');
  fs.mkdirSync(target);
  assert.equal(isolated.removeArchive({ id: 't1', deleteArchive: true, filePath: target }), false);
  assert.equal(fs.existsSync(target), true);
  // Sin ruta de archivo tampoco se intenta borrar.
  assert.equal(isolated.removeArchive({ id: 't1', deleteArchive: true, filePath: '' }), false);
});

test('renombra una tarea activa junto al cambio de contraseña', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-rename-active-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.tasks.set('t1', { id: 't1', status: 'downloading', password: '' });
  isolated.active.set('t1', {});
  assert.equal(isolated.update('t1', { name: 'nuevo.zip', password: 'secreta' }), true);
  assert.equal(isolated.tasks.get('t1').name, 'nuevo.zip');
  assert.equal(isolated.tasks.get('t1').password, 'secreta');
});

test('control rechaza acciones inválidas para el estado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-control-state-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  isolated.tasks.set('t1', { id: 't1', status: 'pending' });
  assert.equal(isolated.control('t1', 'resume'), false);
  isolated.tasks.set('t2', { id: 't2', status: 'completed' });
  assert.equal(isolated.control('t2', 'stop'), false);
  assert.equal(isolated.tasks.get('t2').status, 'completed');
});

test('carga un estado guardado sin tareas previas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-load-empty-'));
  const dataFile = path.join(dir, 'downloads.json');
  fs.writeFileSync(dataFile, JSON.stringify({ settings: { concurrency: 5 } }));
  const isolated = new DownloadManager(dataFile, () => {});
  assert.equal(isolated.tasks.size, 0);
  assert.equal(isolated.settings.concurrency, 5);
});

test('agregar tareas asigna colección con reglas de relleno', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-collection-'));
  const isolated = new DownloadManager(path.join(dir, 'downloads.json'), () => {});
  isolated.settings.concurrency = 0;
  const destination = path.join(dir, 'dest');
  isolated.add([
    {
      originalUrl: 'https://a.com/x.zip',
      url: 'https://a.com/x.zip',
      name: 'x.zip',
      host: 'a.com',
      destination,
    },
    {
      originalUrl: 'https://b.com/y.zip',
      url: 'https://b.com/y.zip',
      name: 'y.zip',
      host: 'b.com',
      collection: 'Mi colección',
      destination,
    },
    {
      originalUrl: 'https://c.com/z.zip',
      url: 'https://c.com/z.zip',
      name: 'z.zip',
      host: '',
      destination,
    },
  ]);
  const collections = [...isolated.tasks.values()].map((task) => task.collection);
  assert.deepEqual(collections, ['a.com', 'Mi colección', 'Sin colección']);
});
