const test = require('node:test');
const assert = require('node:assert/strict');
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
