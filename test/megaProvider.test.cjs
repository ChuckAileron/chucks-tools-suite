const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const provider = require('../electron/megaProvider.cjs');

function b64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Reconstruye la clave de 32 bytes "ofuscada" de un enlace de archivo a partir
// de la clave AES real deseada y el nonce/metaMac: primero16 = k XOR
// segundo16, exactamente lo inverso de lo que hace decodeMegaFileKey.
function encodeMegaFileKeyRaw(k, iv, metaMac) {
  const second = Buffer.concat([iv, metaMac]);
  const first = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) first[i] = k[i] ^ second[i];
  return Buffer.concat([first, second]);
}
// Cifra "MEGA" + json con AES-128-CBC/IV en ceros como lo hace MEGA (rellena
// con ceros hasta el siguiente bloque de 16, sin PKCS7).
function encryptAttrPlain(key16, json) {
  const plain = Buffer.concat([Buffer.from('MEGA', 'latin1'), Buffer.from(JSON.stringify(json))]);
  const padded =
    plain.length % 16 === 0
      ? plain
      : Buffer.concat([plain, Buffer.alloc(16 - (plain.length % 16))]);
  const cipher = crypto.createCipheriv('aes-128-cbc', key16, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return b64url(Buffer.concat([cipher.update(padded), cipher.final()]));
}
// Cifra una clave de nodo (16 o 32 bytes) en bloques ECB con la clave de la
// carpeta, tal como hace MEGA para "k".
function encryptNodeKeyEcb(folderKey16, nodeKeyBytes) {
  const cipher = crypto.createCipheriv('aes-128-ecb', folderKey16, null);
  cipher.setAutoPadding(false);
  return b64url(Buffer.concat([cipher.update(nodeKeyBytes), cipher.final()]));
}

test('megaFileParts reconoce los formatos de archivo', () => {
  assert.deepEqual(provider.megaFileParts('https://mega.nz/file/abc123#key456'), {
    handle: 'abc123',
    key: 'key456',
  });
  assert.deepEqual(provider.megaFileParts('https://mega.nz/#!abc123#key456'), {
    handle: 'abc123',
    key: 'key456',
  });
  assert.deepEqual(provider.megaFileParts('https://mega.io/file/abc123#key456'), {
    handle: 'abc123',
    key: 'key456',
  });
  assert.equal(provider.megaFileParts('https://mega.nz/folder/abc123#key456'), '');
  assert.equal(provider.megaFileParts('https://mega.nz/file/abc123'), '');
  assert.equal(provider.megaFileParts('https://otra.com/file/x#y'), '');
});

test('megaFolderParts reconoce solo enlaces de carpeta (sin archivo anidado)', () => {
  assert.deepEqual(provider.megaFolderParts('https://mega.nz/folder/abc#key456'), {
    handle: 'abc',
    key: 'key456',
  });
  assert.equal(provider.megaFolderParts('https://mega.nz/file/abc#key456'), '');
  // Un enlace de archivo DENTRO de una carpeta no debe confundirse con uno
  // de carpeta simple (la clave no debe "tragarse" el sufijo /file/<h>).
  assert.equal(provider.megaFolderParts('https://mega.nz/folder/abc#key456/file/xyz'), '');
});

test('megaFolderFileParts reconoce un archivo dentro de una carpeta compartida', () => {
  assert.deepEqual(provider.megaFolderFileParts('https://mega.nz/folder/FH#FK/file/AB12'), {
    folderHandle: 'FH',
    folderKey: 'FK',
    fileHandle: 'AB12',
  });
  assert.equal(provider.megaFolderFileParts('https://mega.nz/folder/FH#FK'), '');
});

test('decodeMegaFileKey descondensa la clave real (XOR de las dos mitades)', () => {
  const k = crypto.randomBytes(16);
  const iv = crypto.randomBytes(8);
  const metaMac = crypto.randomBytes(8);
  const raw = encodeMegaFileKeyRaw(k, iv, metaMac);
  const parsed = provider.decodeMegaFileKey(b64url(raw));
  assert.ok(parsed.k.equals(k));
  assert.ok(parsed.iv.equals(iv));
  assert.ok(parsed.metaMac.equals(metaMac));
});

test('decodeMegaFolderKey usa los 16 bytes tal cual (sin ofuscar)', () => {
  const raw = crypto.randomBytes(16);
  const parsed = provider.decodeMegaFolderKey(b64url(raw));
  assert.ok(parsed.k.equals(raw));
});

test('megaChunks respeta los límites estándar (128/256/384/768 KiB)', () => {
  const chunks = provider.megaChunks(1024 * 1024);
  assert.deepEqual(
    chunks.map((c) => c.start),
    [0, 131072, 393216, 786432],
  );
  assert.equal(provider.megaChunks(0).length, 0);
  const last = chunks[chunks.length - 1];
  assert.equal(last.end, 1024 * 1024);
});

test('megaDecryptAttributes descifra el nombre con AES-CBC/IV en ceros', () => {
  const key16 = crypto.randomBytes(16);
  const at = encryptAttrPlain(key16, { n: 'pelicula.720p.mkv', s: 123 });
  const result = provider.megaDecryptAttributes(at, key16);
  assert.equal(result.n, 'pelicula.720p.mkv');
});

test('megaDecryptAttributes ignora los bytes de relleno tras el JSON', () => {
  // MEGA no usa PKCS7: el bloque final puede traer basura tras el "}"; el
  // parser debe cortar en la llave balanceada y no intentar más.
  const key16 = crypto.randomBytes(16);
  const at = encryptAttrPlain(key16, { n: 'x' });
  const result = provider.megaDecryptAttributes(at, key16);
  assert.equal(result.n, 'x');
});

test('megaDecryptAttributes devuelve objeto vacío con clave incorrecta', () => {
  const key16 = crypto.randomBytes(16);
  const otraKey = crypto.randomBytes(16);
  const at = encryptAttrPlain(key16, { n: 'secreto.txt' });
  const result = provider.megaDecryptAttributes(at, otraKey);
  assert.deepEqual(result, {});
});

test('decryptNodeKey descifra una clave de subcarpeta (16 bytes) en ECB', () => {
  const folderKey = crypto.randomBytes(16);
  const childKey = crypto.randomBytes(16);
  const rawK = `child1:${encryptNodeKeyEcb(folderKey, childKey)}`;
  const result = provider.decryptNodeKey(rawK, folderKey, 'child1');
  assert.equal(result.isFolder, true);
  assert.ok(result.k.equals(childKey));
});

test('decryptNodeKey descifra y condensa una clave de archivo (32 bytes)', () => {
  const folderKey = crypto.randomBytes(16);
  const k = crypto.randomBytes(16);
  const iv = crypto.randomBytes(8);
  const metaMac = crypto.randomBytes(8);
  const rawTuple = encodeMegaFileKeyRaw(k, iv, metaMac);
  const rawK = `file1:${encryptNodeKeyEcb(folderKey, rawTuple)}`;
  const result = provider.decryptNodeKey(rawK, folderKey, 'file1');
  assert.equal(result.isFolder, false);
  assert.ok(result.k.equals(k));
  assert.ok(result.iv.equals(iv));
  assert.ok(result.metaMac.equals(metaMac));
  assert.ok(result.raw.equals(rawTuple));
});

test('decryptNodeKey elige la entrada que coincide con el handle del nodo', () => {
  const folderKey = crypto.randomBytes(16);
  const wrongKey = crypto.randomBytes(16);
  const rightKey = crypto.randomBytes(16);
  const rawK = [
    `otroHandle:${encryptNodeKeyEcb(folderKey, wrongKey)}`,
    `esteHandle:${encryptNodeKeyEcb(folderKey, rightKey)}`,
  ].join('/');
  const result = provider.decryptNodeKey(rawK, folderKey, 'esteHandle');
  assert.ok(result.k.equals(rightKey));
});

test('megaApiErrorMessage traduce códigos conocidos', () => {
  assert.match(provider.megaApiErrorMessage(-3), /no encontró/);
  assert.match(provider.megaApiErrorMessage(-15), /rechazó la sesión/);
  assert.match(provider.megaApiErrorMessage(-16), /cupo de transferencia/);
  assert.match(provider.megaApiErrorMessage(-77), /código -77/);
});

test('megaHttpErrorMessage explica el límite de ancho de banda anónimo (509)', () => {
  assert.match(provider.megaHttpErrorMessage(509), /límite de ancho de banda/);
  assert.match(provider.megaHttpErrorMessage(429), /limitando las solicitudes/);
  assert.match(provider.megaHttpErrorMessage(500), /respondió 500/);
});
