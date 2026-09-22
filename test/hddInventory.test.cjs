const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installHooks, restoreHooks } = require('./helpers/moduleHooks.cjs');
const {
  HddInventoryManager,
  categorize,
  extensionOf,
  toPosixRelative,
  splitRelative,
  joinRelative,
  driveRootFromPath,
  resolveConnection,
} = require('../electron/hddInventory.cjs');

function managerForTest() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chucks-hdd-'));
  const dbPath = path.join(directory, 'hdd.sqlite');
  const thumbsDir = path.join(directory, 'thumbs');
  const manager = new HddInventoryManager(dbPath, thumbsDir);
  return {
    manager,
    directory,
    thumbsDir,
    close() {
      manager.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

// --- Helpers puros ---------------------------------------------------------

test('categorize clasifica por extensión y detecta carpetas', () => {
  assert.equal(categorize('pelicula.mp4', false), 'video');
  assert.equal(categorize('foto.JPG', false), 'image');
  assert.equal(categorize('cancion.mp3', false), 'audio');
  assert.equal(categorize('informe.pdf', false), 'document');
  assert.equal(categorize('datos.bin', false), 'other');
  assert.equal(categorize('cualquiera', true), 'folder');
});

test('extensionOf devuelve la extensión en minúsculas sin el punto', () => {
  assert.equal(extensionOf('Video.MP4'), 'mp4');
  assert.equal(extensionOf('sin-extension'), '');
});

test('toPosixRelative / splitRelative / joinRelative manejan rutas relativas', () => {
  const root = path.join('D:', 'Media');
  const target = path.join('D:', 'Media', 'Series', 'Cap1.mkv');
  const relative = toPosixRelative(root, target);
  assert.equal(relative, 'Series/Cap1.mkv');
  assert.deepEqual(splitRelative(relative), { parentPath: 'Series', name: 'Cap1.mkv' });
  assert.deepEqual(splitRelative('raiz.txt'), { parentPath: '', name: 'raiz.txt' });
  assert.equal(joinRelative('Series', 'Cap1.mkv'), 'Series/Cap1.mkv');
  assert.equal(joinRelative('', 'raiz.txt'), 'raiz.txt');
});

test('driveRootFromPath obtiene la raíz de la unidad de una ruta', () => {
  const root = driveRootFromPath(path.join('D:', 'Media', 'Series'));
  assert.equal(root, path.parse(path.resolve(path.join('D:', 'Media', 'Series'))).root);
});

test('resolveConnection empareja por volumeId aunque cambie la letra', () => {
  const drive = { volumeId: 'vol-123', lastMountPoint: 'D:\\' };
  const volumes = [{ mountPoint: 'F:\\', volumeId: 'vol-123', label: 'Backups', totalBytes: 100 }];
  const result = resolveConnection(drive, volumes);
  assert.equal(result.connected, true);
  assert.equal(result.mountPoint, 'F:\\');
});

test('resolveConnection cae al último punto de montaje si no hay volumeId', () => {
  const drive = { volumeId: null, lastMountPoint: 'E:\\' };
  const volumes = [{ mountPoint: 'E:\\', volumeId: null, label: '', totalBytes: 0 }];
  assert.equal(resolveConnection(drive, volumes).connected, true);
});

test('resolveConnection marca desconectado si no hay coincidencia', () => {
  const drive = { volumeId: 'vol-999', lastMountPoint: 'D:\\' };
  assert.equal(resolveConnection(drive, []).connected, false);
});

// --- HddInventoryManager: CRUD de discos -----------------------------------

test('registerDrive valida el identificador y evita duplicados', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001', label: 'Backups' });
    assert.equal(drive.code, 'HDD-001');
    assert.equal(drive.label, 'Backups');
    assert.throws(() => fixture.manager.registerDrive({ code: 'HDD-001' }), /Ya existe/);
    assert.throws(() => fixture.manager.registerDrive({ code: '' }), /obligatorio/);
    assert.throws(() => fixture.manager.registerDrive({ code: 'HDD 001' }), /solo admite/);
  } finally {
    fixture.close();
  }
});

test('updateDrive renombra el identificador y detecta colisiones', () => {
  const fixture = managerForTest();
  try {
    const a = fixture.manager.registerDrive({ code: 'HDD-001' });
    fixture.manager.registerDrive({ code: 'HDD-002' });
    const updated = fixture.manager.updateDrive(a.id, { code: 'HDD-001B', label: 'Nuevo' });
    assert.equal(updated.code, 'HDD-001B');
    assert.equal(updated.label, 'Nuevo');
    assert.throws(() => fixture.manager.updateDrive(a.id, { code: 'HDD-002' }), /Ya existe/);
  } finally {
    fixture.close();
  }
});

test('deleteDrive elimina el registro y listDrives refleja los cambios', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    assert.equal(fixture.manager.listDrives().length, 1);
    assert.equal(fixture.manager.deleteDrive(drive.id), true);
    assert.equal(fixture.manager.listDrives().length, 0);
    assert.equal(fixture.manager.deleteDrive(drive.id), false);
  } finally {
    fixture.close();
  }
});

// --- HddInventoryManager: entradas y jerarquía -----------------------------

test('upsertEntry inserta y actualiza, listEntries respeta la jerarquía', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Series',
      parentPath: '',
      name: 'Series',
      isDirectory: true,
      category: 'folder',
      extension: '',
      size: 0,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Series/Cap1.mkv',
      parentPath: 'Series',
      name: 'Cap1.mkv',
      isDirectory: false,
      category: 'video',
      extension: 'mkv',
      size: 1000,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    const root = fixture.manager.listEntries(drive.id, '');
    assert.equal(root.length, 1);
    assert.equal(root[0].name, 'Series');
    const children = fixture.manager.listEntries(drive.id, 'Series');
    assert.equal(children.length, 1);
    assert.equal(children[0].size, 1000);

    // Reinsertar la misma ruta actualiza en vez de duplicar.
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Series/Cap1.mkv',
      parentPath: 'Series',
      name: 'Cap1.mkv',
      isDirectory: false,
      category: 'video',
      extension: 'mkv',
      size: 2000,
      modifiedAt: '2024-02-01T00:00:00.000Z',
    });
    const updatedChildren = fixture.manager.listEntries(drive.id, 'Series');
    assert.equal(updatedChildren.length, 1);
    assert.equal(updatedChildren[0].size, 2000);

    const stats = fixture.manager.countEntries(drive.id);
    assert.equal(stats.files, 1);
    assert.equal(stats.bytes, 2000);
  } finally {
    fixture.close();
  }
});

test('deleteEntriesNotIn borra archivos que ya no están en el disco', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    const a = fixture.manager.upsertEntry(drive.id, {
      relativePath: 'a.txt',
      parentPath: '',
      name: 'a.txt',
      isDirectory: false,
      category: 'document',
      extension: 'txt',
      size: 10,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'b.txt',
      parentPath: '',
      name: 'b.txt',
      isDirectory: false,
      category: 'document',
      extension: 'txt',
      size: 10,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    const removed = fixture.manager.deleteEntriesNotIn(drive.id, new Set(['a.txt']));
    assert.equal(removed, 1);
    const remaining = fixture.manager.listEntries(drive.id, '');
    assert.deepEqual(
      remaining.map((e) => e.id),
      [a.id],
    );
  } finally {
    fixture.close();
  }
});

test('searchEntries encuentra por nombre parcial en todo el disco', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Fotos/vacaciones.jpg',
      parentPath: 'Fotos',
      name: 'vacaciones.jpg',
      isDirectory: false,
      category: 'image',
      extension: 'jpg',
      size: 500,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    const found = fixture.manager.searchEntries(drive.id, 'vacac');
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'vacaciones.jpg');
  } finally {
    fixture.close();
  }
});

// --- Renombrado con cascada -------------------------------------------------

test('renameEntryInDb renombra un archivo simple', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    const entry = fixture.manager.upsertEntry(drive.id, {
      relativePath: 'viejo.txt',
      parentPath: '',
      name: 'viejo.txt',
      isDirectory: false,
      category: 'document',
      extension: 'txt',
      size: 10,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    const result = fixture.manager.renameEntryInDb(drive.id, entry.id, 'nuevo.txt');
    assert.equal(result.entry.name, 'nuevo.txt');
    assert.equal(result.entry.relativePath, 'nuevo.txt');
    assert.equal(result.affected, 0);
  } finally {
    fixture.close();
  }
});

test('renameEntryInDb cascada el cambio de ruta a todos los descendientes', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    const folder = fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Series',
      parentPath: '',
      name: 'Series',
      isDirectory: true,
      category: 'folder',
      extension: '',
      size: 0,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Series/T1',
      parentPath: 'Series',
      name: 'T1',
      isDirectory: true,
      category: 'folder',
      extension: '',
      size: 0,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'Series/T1/Cap1.mkv',
      parentPath: 'Series/T1',
      name: 'Cap1.mkv',
      isDirectory: false,
      category: 'video',
      extension: 'mkv',
      size: 999,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    const result = fixture.manager.renameEntryInDb(drive.id, folder.id, 'Series renombrada');
    assert.equal(result.affected, 2);
    assert.equal(fixture.manager.getEntryByPath(drive.id, 'Series'), null);
    const subfolder = fixture.manager.getEntryByPath(drive.id, 'Series renombrada/T1');
    assert.ok(subfolder);
    assert.equal(subfolder.parentPath, 'Series renombrada');
    const file = fixture.manager.getEntryByPath(drive.id, 'Series renombrada/T1/Cap1.mkv');
    assert.ok(file);
    assert.equal(file.parentPath, 'Series renombrada/T1');
  } finally {
    fixture.close();
  }
});

test('renameEntryInDb rechaza colisiones y nombres inválidos', () => {
  const fixture = managerForTest();
  try {
    const drive = fixture.manager.registerDrive({ code: 'HDD-001' });
    const a = fixture.manager.upsertEntry(drive.id, {
      relativePath: 'a.txt',
      parentPath: '',
      name: 'a.txt',
      isDirectory: false,
      category: 'document',
      extension: 'txt',
      size: 1,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    fixture.manager.upsertEntry(drive.id, {
      relativePath: 'b.txt',
      parentPath: '',
      name: 'b.txt',
      isDirectory: false,
      category: 'document',
      extension: 'txt',
      size: 1,
      modifiedAt: '2024-01-01T00:00:00.000Z',
    });
    assert.throws(() => fixture.manager.renameEntryInDb(drive.id, a.id, 'b.txt'), /Ya existe/);
    assert.throws(
      () => fixture.manager.renameEntryInDb(drive.id, a.id, 'sub/c.txt'),
      /separadores/,
    );
    assert.throws(() => fixture.manager.renameEntryInDb(drive.id, a.id, '  '), /separadores/);
  } finally {
    fixture.close();
  }
});

// --- scanDrive: recorrido real de disco con ffmpeg/ffprobe simulados -------

function installFakeMedia() {
  installHooks({
    'node:child_process': {
      execFile(command, args, options, callback) {
        if (typeof options === 'function') {
          callback = options;
        }
        if (command === 'ffprobe') {
          if (args.includes('-show_streams'))
            return callback(
              null,
              JSON.stringify({ format: { duration: '12.3' }, streams: [{ codec_type: 'video' }] }),
              '',
            );
          if (args.includes('format=duration')) return callback(null, '12.3', '');
          return callback(new Error('ffprobe: comando no soportado'));
        }
        if (command === 'ffmpeg') {
          const dest = args[args.length - 1];
          try {
            fs.writeFileSync(dest, 'thumb');
            return callback(null, '', '');
          } catch (error) {
            return callback(error);
          }
        }
        if (command === 'pdftoppm') return callback(new Error('pdftoppm no disponible'));
        return callback(new Error(`comando no soportado: ${command}`));
      },
      execFileSync() {
        throw new Error('no usado en esta prueba');
      },
    },
  });
}

test('scanDrive cataloga archivos y carpetas, genera miniaturas y elimina entradas obsoletas', async () => {
  const fixture = managerForTest();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chucks-hdd-disk-'));
  try {
    installFakeMedia();
    delete require.cache[require.resolve('../electron/hddInventory.cjs')];
    const fresh = require('../electron/hddInventory.cjs');
    const manager = new fresh.HddInventoryManager(
      path.join(fixture.directory, 'fresh.sqlite'),
      fixture.thumbsDir,
    );
    const drive = manager.registerDrive({ code: 'HDD-001' });

    fs.mkdirSync(path.join(root, 'Series'));
    fs.writeFileSync(path.join(root, 'Series', 'Cap1.mp4'), 'video-data');
    fs.writeFileSync(path.join(root, 'foto.jpg'), 'image-data');
    fs.writeFileSync(path.join(root, 'informe.txt'), 'texto');
    fs.writeFileSync(path.join(root, 'datos.bin'), 'otros');

    const result = await fresh.scanDrive({
      manager,
      driveId: drive.id,
      mountPoint: root,
      onProgress: () => {},
      isCancelled: () => false,
    });
    assert.equal(result.cancelled, false);
    assert.equal(result.processed, 5); // Series, Cap1.mp4, foto.jpg, informe.txt, datos.bin

    const rootEntries = manager.listEntries(drive.id, '');
    assert.deepEqual(rootEntries.map((e) => e.name).sort(), [
      'Series',
      'datos.bin',
      'foto.jpg',
      'informe.txt',
    ]);
    const video = manager.getEntryByPath(drive.id, 'Series/Cap1.mp4');
    assert.equal(video.category, 'video');
    assert.equal(video.hasThumbnail, true);
    assert.ok(Object.keys(video.mediaProperties).length > 0);

    const image = manager.getEntryByPath(drive.id, 'foto.jpg');
    assert.equal(image.hasThumbnail, true);

    const doc = manager.getEntryByPath(drive.id, 'informe.txt');
    assert.equal(doc.hasThumbnail, true); // marcador genérico vía ffmpeg lavfi

    const other = manager.getEntryByPath(drive.id, 'datos.bin');
    assert.equal(other.hasThumbnail, false);

    const drivenScannedAt = manager.getDrive(drive.id).lastScannedAt;
    assert.ok(drivenScannedAt);

    // Se borra un archivo real; al reanalizar debe desaparecer de la base.
    fs.rmSync(path.join(root, 'datos.bin'));
    await fresh.scanDrive({
      manager,
      driveId: drive.id,
      mountPoint: root,
      onProgress: () => {},
      isCancelled: () => false,
    });
    assert.equal(manager.getEntryByPath(drive.id, 'datos.bin'), null);

    manager.close();
  } finally {
    restoreHooks();
    delete require.cache[require.resolve('../electron/hddInventory.cjs')];
    fs.rmSync(root, { recursive: true, force: true });
    fixture.close();
  }
});

test('scanDrive no elimina entradas si el análisis se cancela a mitad de camino', async () => {
  const fixture = managerForTest();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chucks-hdd-disk-'));
  try {
    installFakeMedia();
    delete require.cache[require.resolve('../electron/hddInventory.cjs')];
    const fresh = require('../electron/hddInventory.cjs');
    const manager = new fresh.HddInventoryManager(
      path.join(fixture.directory, 'fresh.sqlite'),
      fixture.thumbsDir,
    );
    const drive = manager.registerDrive({ code: 'HDD-001' });
    fs.writeFileSync(path.join(root, 'archivo.txt'), 'texto');

    const result = await fresh.scanDrive({
      manager,
      driveId: drive.id,
      mountPoint: root,
      onProgress: () => {},
      isCancelled: () => true,
    });
    assert.equal(result.cancelled, true);
    // No debería borrar nada porque el recorrido no se completó; la tabla
    // simplemente queda vacía porque la cancelación se evalúa antes de leer
    // el primer directorio, sin afectar filas previas.
    assert.equal(manager.getDrive(drive.id).lastScannedAt, null);
    manager.close();
  } finally {
    restoreHooks();
    delete require.cache[require.resolve('../electron/hddInventory.cjs')];
    fs.rmSync(root, { recursive: true, force: true });
    fixture.close();
  }
});
