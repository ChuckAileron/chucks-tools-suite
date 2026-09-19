const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listFiles, renameFile } = require('../electron/renameManager.cjs');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rename-test-'));
}

test('listFiles combina archivos de varias carpetas con su origen', async () => {
  const a = await tempDir();
  const b = await tempDir();
  try {
    await fs.writeFile(path.join(a, 'uno.txt'), 'a');
    await fs.writeFile(path.join(b, 'dos.txt'), 'b');
    await fs.mkdir(path.join(b, 'sub')).catch(() => {});
    const list = await listFiles([a, b]);
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((x) => x.name).sort(), ['dos.txt', 'uno.txt']);
    assert.ok(list.every((x) => x.folder === a || x.folder === b));
  } finally {
    await fs.rm(a, { recursive: true, force: true });
    await fs.rm(b, { recursive: true, force: true });
  }
});

test('listFiles ignora archivos inexistentes al vaciar el array', async () => {
  assert.deepEqual(await listFiles([]), []);
});

test('renameFile mueve el archivo dentro de su carpeta', async () => {
  const dir = await tempDir();
  try {
    const source = path.join(dir, 'viejo.txt');
    await fs.writeFile(source, 'x');
    await renameFile({ folder: dir, oldName: 'viejo.txt', newName: 'nuevo.txt' });
    await assert.doesNotReject(fs.access(path.join(dir, 'nuevo.txt')));
    await assert.rejects(fs.access(source));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('renameFile rechaza rutas fuera de la carpeta', async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(
      renameFile({ folder: dir, oldName: 'a.txt', newName: '../escape.txt' }),
      /inválido/,
    );
    await assert.rejects(
      renameFile({ folder: dir, oldName: '../a.txt', newName: 'b.txt' }),
      /inválido/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
