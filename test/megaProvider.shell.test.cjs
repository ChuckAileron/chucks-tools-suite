const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const provider = require('../electron/megaProvider.cjs');

function b64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function randomBytes(n) {
  return crypto.randomBytes(n);
}
// Cifra el contenido igual que MEGA: AES-128-CTR con contador (iv8 | índice) por chunk.
function megaEncrypt(plain, key) {
  const out = [];
  const chunks = provider.megaChunks(plain.length);
  for (let index = 0; index < chunks.length; index += 1) {
    const { start, end } = chunks[index];
    const block = Buffer.alloc(16);
    key.iv.copy(block, 0);
    block.writeBigUInt64BE(BigInt(index), 8);
    const cipher = crypto.createCipheriv('aes-128-ctr', key.k, block);
    out.push(cipher.update(plain.subarray(start, end)));
    out.push(cipher.final());
  }
  return Buffer.concat(out);
}
// Reconstruye la clave "ofuscada" (32 bytes) de un enlace de archivo a partir
// de la clave AES real deseada: primero16 = k XOR (iv|metaMac).
function encodeMegaFileKeyRaw(k, iv, metaMac) {
  const second = Buffer.concat([iv, metaMac]);
  const first = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) first[i] = k[i] ^ second[i];
  return Buffer.concat([first, second]);
}
// Cifra "MEGA" + json como atributo (AES-128-CBC, IV en ceros, sin PKCS7: se
// rellena con ceros hasta el siguiente bloque de 16, igual que MEGA).
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
// carpeta (sin IV), tal como hace MEGA para el campo "k".
function encryptNodeKeyEcb(folderKey16, nodeKeyBytes) {
  const cipher = crypto.createCipheriv('aes-128-ecb', folderKey16, null);
  cipher.setAutoPadding(false);
  return b64url(Buffer.concat([cipher.update(nodeKeyBytes), cipher.final()]));
}
// Envuelve un Buffer como cuerpo de Response (web ReadableStream).
function bodyStream(bytes) {
  return new Response(new Uint8Array(bytes)).body;
}
function responseObject({ status = 200, body = null, headers = {} } = {}) {
  const isJsonLike = Buffer.isBuffer(body) && !headers['content-type']?.includes('octet-stream');
  return {
    ok: status >= 200 && status < 400,
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] ?? null,
      getSetCookie: () => [],
    },
    json: async () => JSON.parse(body.toString('utf8')),
    text: async () => body.toString('utf8'),
    body: bodyStream(body),
    isJsonLike,
  };
}
function installFetch(responder) {
  global.fetch = async (url, options = {}) => {
    if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return responder(String(url), options);
  };
}
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mega-provider-'));
}
function makeFileKey() {
  return {
    k: randomBytes(16),
    iv: randomBytes(8),
    metaMac: randomBytes(8),
  };
}

test('resolveMegaFile pide el enlace de descarga y descifra el nombre', async () => {
  const fileKey = makeFileKey();
  const urlKeyRaw = encodeMegaFileKeyRaw(fileKey.k, fileKey.iv, fileKey.metaMac);
  const at = encryptAttrPlain(fileKey.k, { n: 'manual.pdf' });
  installFetch(async (url) => {
    assert.ok(url.startsWith('https://g.api.mega.co.nz/cs'));
    return responseObject({
      body: Buffer.from(JSON.stringify([{ g: 'https://dl.mega.nz/file?id=x', s: 55, at }])),
    });
  });
  const info = await provider.resolveMegaFile('HANDLE', b64url(urlKeyRaw));
  assert.equal(info.url, 'https://dl.mega.nz/file?id=x');
  assert.equal(info.name, 'manual.pdf');
  assert.equal(info.size, 55);
  assert.ok(info.key.k.equals(fileKey.k));
  assert.ok(info.key.iv.equals(fileKey.iv));
});

test('resolveMegaFile traduce los códigos de error de la API', async () => {
  installFetch(async () => responseObject({ body: Buffer.from(JSON.stringify([{ e: -3 }])) }));
  await assert.rejects(provider.resolveMegaFile('HANDLE', b64url(randomBytes(32))), /no encontró/);
});

test('resolveMegaFolderTree descifra claves y nombres de un árbol', async () => {
  // La clave de carpeta de un enlace público son 16 bytes tal cual (sin
  // versión ni iv/metaMac propios); se usa directamente como clave AES.
  const folderKey = randomBytes(16);
  const folderAt = encryptAttrPlain(folderKey, { n: 'Proyectos' });
  // Nodo archivo: tupla de 32 bytes (k real "ofuscado" + iv + metaMac),
  // cifrada en bloques ECB con la clave de la carpeta (campo "k" de la API).
  const fileTupleReal = { k: randomBytes(16), iv: randomBytes(8), metaMac: randomBytes(8) };
  const fileTupleRaw = encodeMegaFileKeyRaw(
    fileTupleReal.k,
    fileTupleReal.iv,
    fileTupleReal.metaMac,
  );
  const nodeKField = `c1:${encryptNodeKeyEcb(folderKey, fileTupleRaw)}`;
  const fileAt = encryptAttrPlain(fileTupleReal.k, { n: 'informe.docx' });
  // Subcarpeta anidada (16 bytes de clave).
  const subKey = randomBytes(16);
  const subKField = `sub1:${encryptNodeKeyEcb(folderKey, subKey)}`;
  const subAt = encryptAttrPlain(subKey, { n: 'Anexos' });
  installFetch(async () =>
    responseObject({
      body: Buffer.from(
        JSON.stringify([
          {
            f: [
              // MEGA no siempre devuelve un nodo para el handle de la URL: el
              // padre "FH" nunca aparece como "h" de ningún nodo, por lo que
              // c1/sub1 quedan como nivel superior (p reasignado a '').
              { h: 'c1', p: 'FH', t: 0, s: 9, k: nodeKField, a: fileAt },
              { h: 'sub1', p: 'FH', t: 1, s: 0, k: subKField, a: subAt },
            ],
          },
        ]),
      ),
    }),
  );
  const tree = await provider.resolveMegaFolderTree('FH', b64url(folderKey));
  assert.equal(tree.name, '');
  assert.equal(tree.entries.length, 2);
  const file = tree.entries.find((entry) => entry.h === 'c1');
  assert.equal(file.name, 'informe.docx');
  assert.equal(file.s, 9);
  assert.equal(file.p, '');
  const sub = tree.entries.find((entry) => entry.h === 'sub1');
  assert.equal(sub.name, 'Anexos');
  assert.equal(sub.t, 'folder');
});

test('resolveMegaFolderTree usa el nombre del nodo raíz cuando MEGA sí lo incluye', async () => {
  const folderKey = randomBytes(16);
  const folderAt = encryptAttrPlain(folderKey, { n: 'Proyectos' });
  installFetch(async () =>
    responseObject({
      body: Buffer.from(
        JSON.stringify([{ f: [{ h: 'FH', p: '', t: 1, s: 0, k: '', a: folderAt }] }]),
      ),
    }),
  );
  const tree = await provider.resolveMegaFolderTree('FH', b64url(folderKey));
  assert.equal(tree.name, 'Proyectos');
  assert.equal(tree.entries[0].name, 'Proyectos');
});

test('resolveMegaFolderFile pide el archivo con el contexto "n" de la carpeta', async () => {
  const folderKey = randomBytes(16);
  const fileTupleReal = { k: randomBytes(16), iv: randomBytes(8), metaMac: randomBytes(8) };
  const fileTupleRaw = encodeMegaFileKeyRaw(
    fileTupleReal.k,
    fileTupleReal.iv,
    fileTupleReal.metaMac,
  );
  const nodeKField = `c1:${encryptNodeKeyEcb(folderKey, fileTupleRaw)}`;
  const fileAt = encryptAttrPlain(fileTupleReal.k, { n: 'video.mp4' });
  const calls = [];
  installFetch(async (url, options) => {
    calls.push(url);
    assert.ok(url.includes('n=FH'), `falta n=FH en ${url}`);
    const payload = JSON.parse(options.body)[0];
    if (payload.a === 'f') {
      return responseObject({
        body: Buffer.from(
          JSON.stringify([{ f: [{ h: 'c1', p: 'FH', t: 0, s: 42, k: nodeKField, a: fileAt }] }]),
        ),
      });
    }
    assert.equal(payload.a, 'g');
    assert.equal(payload.n, 'c1');
    return responseObject({
      body: Buffer.from(JSON.stringify([{ g: 'https://dl.mega.nz/x', s: 42 }])),
    });
  });
  const info = await provider.resolveMegaFolderFile('FH', b64url(folderKey), 'c1');
  assert.equal(info.url, 'https://dl.mega.nz/x');
  assert.equal(info.name, 'video.mp4');
  assert.equal(info.size, 42);
  assert.ok(info.key.k.equals(fileTupleReal.k));
  assert.equal(calls.length, 2);
});

test('resolveMegaFolderFile falla si el archivo ya no está en la carpeta', async () => {
  const folderKey = randomBytes(16);
  installFetch(async () => responseObject({ body: Buffer.from(JSON.stringify([{ f: [] }])) }));
  await assert.rejects(
    provider.resolveMegaFolderFile('FH', b64url(folderKey), 'c1'),
    /no encontró el archivo/,
  );
});

test('MegaDownloader descarga un archivo cifrado y lo descifra completo', async () => {
  const plain = randomBytes(400 * 1024);
  const key = makeFileKey();
  const cipherText = megaEncrypt(plain, key);
  installFetch(async (url) => {
    assert.ok(url.includes('dl.mega.nz'));
    return responseObject({
      headers: { 'content-type': 'application/octet-stream' },
      body: cipherText,
    });
  });
  const dir = makeTempDir();
  const downloader = new provider.MegaDownloader({
    downloadUrl: 'https://dl.mega.nz/file?x=1',
    key,
    size: plain.length,
    destination: dir,
    fileName: 'video.bin',
  });
  let lastProgress = -1;
  const progress = [];
  downloader.on('progress.throttled', (stats) => {
    progress.push(stats);
    lastProgress = Math.max(lastProgress, stats.downloaded);
  });
  const ended = new Promise((resolve) => downloader.on('end', resolve));
  downloader.start();
  const info = await ended;
  assert.equal(info.filePath, path.join(dir, 'video.bin'));
  assert.equal(lastProgress, plain.length);
  assert.equal(progress[progress.length - 1].total, plain.length);
  const written = fs.readFileSync(info.filePath);
  assert.ok(written.equals(plain));
  assert.ok(!fs.existsSync(path.join(dir, 'video.bin.part')));
});

test('MegaDownloader reanuda desde una posición intermedia con Range', async () => {
  const plain = randomBytes(300 * 1024);
  const key = makeFileKey();
  const cipherText = megaEncrypt(plain, key);
  const dir = makeTempDir();
  const resumeAt = 200000;
  const partPath = path.join(dir, 'doc.bin.part');
  fs.writeFileSync(partPath, plain.subarray(0, resumeAt));

  let lastRange = '';
  installFetch(async (url, options) => {
    assert.ok(url.includes('dl.mega.nz'));
    const range = options?.headers?.Range || '';
    if (!range) return responseObject({ body: cipherText });
    lastRange = range;
    const match = /^bytes=(\d+)-/.exec(range);
    const from = Number(match[1]);
    const partial = cipherText.subarray(from);
    return {
      ok: true,
      status: 206,
      headers: {
        get: (name) => (name.toLowerCase() === 'content-range' ? `bytes ${from}-*/*` : null),
        getSetCookie: () => [],
      },
      body: bodyStream(partial),
    };
  });

  const downloader = new provider.MegaDownloader({
    downloadUrl: 'https://dl.mega.nz/file?x=2',
    key,
    size: plain.length,
    destination: dir,
    fileName: 'doc.bin',
  });
  const stopped = [];
  const ended = new Promise((resolve, reject) => {
    downloader.on('end', resolve);
    downloader.on('error', reject);
    downloader.on('stop', () => stopped.push('stop'));
  });
  downloader.start();
  const info = await ended;
  assert.ok(lastRange.startsWith('bytes=131072-'), `usó ${lastRange}`);
  assert.equal(info.filePath, path.join(dir, 'doc.bin'));
  const written = fs.readFileSync(info.filePath);
  assert.ok(written.equals(plain));
});

test('MegaDownloader detenido antes de iniciar emite stop sin tocar el archivo final', async () => {
  installFetch(async () => responseObject({ body: Buffer.alloc(10) }));
  const dir = makeTempDir();
  const downloader = new provider.MegaDownloader({
    downloadUrl: 'https://dl.mega.nz/file?x=3',
    key: makeFileKey(),
    size: 10,
    destination: dir,
    fileName: 'x.bin',
  });
  downloader.stop();
  const stopped = new Promise((resolve) => downloader.on('stop', resolve));
  downloader.start();
  await stopped;
  assert.ok(!fs.existsSync(path.join(dir, 'x.bin')));
});
