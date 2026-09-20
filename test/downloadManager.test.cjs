const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadManager, extractLinks } = require('../electron/downloadManager.cjs');

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
