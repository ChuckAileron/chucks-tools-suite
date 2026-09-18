const test = require('node:test');
const assert = require('node:assert/strict');
const { DownloadManager } = require('../electron/downloadManager.cjs');

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
