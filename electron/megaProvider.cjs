const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

// Soporte para MEGA (file links + carpetas compartidas) usando SOLO node:crypto,
// sin dependencias externas. El protocolo es el de la API pública de MEGA:
//   - Enlaces de archivo:  mega.nz/file/<handle>#<key>  (o el antiguo #!<handle>#<key>)
//   - Carpetas:            mega.nz/folder/<handle>#<key>
//   - API:                 g.api.mega.co.nz/cs  (comandos 'g' para descargar, 'f' para listar)
//   - Cifrado:             AES-128 en modo CBC para atributos y claves,
//                          AES-128-CTR por chunks (128/256/384/768 KiB) para el contenido.
// La descarga no puede usar node-downloader-helper porque el archivo viaja cifrado
// y hay que descifrarlo en streaming por chunks mientras se escribe en disco.

const BROWSER_UA = 'Mozilla/5.0 Chrome/140 Safari/537.36';
const API_BASE = 'https://g.api.mega.co.nz/cs';
const MEGA_B64 = /^[A-Za-z0-9_+\-/=]+$/;

function megab64decode(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function megab64encode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Los enlaces usan base64 url-safe sin padding; varios de los actuales incluyen
// caracteres estándar (+/ e incluso '='), así que se acepta cualquiera de los dos.
function megab64valid(value) {
  return MEGA_B64.test(value || '') && decodeURIComponent(value).length <= 128;
}

// ---------- Parseo de URLs ----------

// Devuelve { handle, key } para un enlace de archivo, o '' si no lo es.
function megaFileParts(value) {
  const match = /^https?:\/\/(?:www\.)?mega\.(?:nz|io)\/(?:#!|file\/|!)([^#\s/]+)#([^#\s]+)$/i.exec(
    String(value || ''),
  );
  if (!match || !megab64valid(match[1]) || !megab64valid(match[2])) return '';
  return { handle: match[1], key: match[2] };
}

// Devuelve { handle, key } para un enlace de carpeta, o '' si no lo es.
function megaFolderParts(value) {
  const match = /^https?:\/\/(?:www\.)?mega\.(?:nz|io)\/folder\/([^#\s/]+)#([^#\s/]+)$/i.exec(
    String(value || ''),
  );
  if (!match || !megab64valid(match[1]) || !megab64valid(match[2])) return '';
  return { handle: match[1], key: match[2] };
}

// Enlace a UN archivo concreto dentro de una carpeta compartida:
// mega.nz/folder/<folderHandle>#<folderKey>/file/<fileHandle>. Descargarlo
// exige el contexto de la carpeta (parámetro "n" de la API), así que no basta
// con la clave del archivo: se necesita también el handle+clave de la carpeta.
function megaFolderFileParts(value) {
  const match =
    /^https?:\/\/(?:www\.)?mega\.(?:nz|io)\/folder\/([^#\s/]+)#([^#\s/]+)\/file\/([^#\s/]+)$/i.exec(
      String(value || ''),
    );
  if (!match || !megab64valid(match[1]) || !megab64valid(match[2]) || !megab64valid(match[3]))
    return '';
  return { folderHandle: match[1], folderKey: match[2], fileHandle: match[3] };
}

// Indica si la URL pertenece al dominio de MEGA (aunque le falte la clave).
function isMegaUrl(value) {
  try {
    return /(^|\.)mega\.(?:nz|io)$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

// ---------- Claves ----------

function xorBuffers(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

// Clave de un enlace de archivo: 32 bytes que MEGA guarda "ofuscados". La clave
// AES real es el XOR byte a byte de las dos mitades; la segunda mitad (sin XOR)
// trae el nonce del contador CTR (8 bytes) y el meta MAC (8 bytes). Este es el
// mismo esquema que usan megajs/megatools para los enlaces públicos.
function decodeMegaFileKey(keyB64) {
  const raw = megab64decode(keyB64);
  if (raw.length < 32) throw new Error('La clave de MEGA del archivo no es válida.');
  const first = raw.subarray(0, 16);
  const second = raw.subarray(16, 32);
  return {
    k: xorBuffers(first, second),
    iv: second.subarray(0, 8),
    metaMac: second.subarray(8, 16),
  };
}

// Clave de un enlace de carpeta: 16 bytes que se usan tal cual como clave AES
// (sin ofuscar, sin versión ni metaMac: una carpeta no necesita nonce propio).
function decodeMegaFolderKey(keyB64) {
  const raw = megab64decode(keyB64);
  if (raw.length < 16) throw new Error('La clave de MEGA de la carpeta no es válida.');
  return { k: raw.subarray(0, 16) };
}

// ---------- Cifrado ----------

// MEGA no rellena los atributos cifrados con PKCS7 estándar (dejan basura o
// ceros al final del último bloque en vez de un padding válido), así que hay
// que desactivar el autoPadding de Node o decipher.final() rechaza el bloque
// con "bad decrypt". El parseo de atributos (megaParseAttributes) ya ignora
// cualquier byte sobrante tras el JSON balanceado.
function aesDecryptCbc(data, key, iv) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// Descifra en bloques de 16 bytes con AES-ECB (sin IV, cada bloque es
// independiente): así es como MEGA cifra la clave de un nodo con la clave de
// su carpeta/padre.
function aesDecryptEcbBlocks(data, key) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function megaParseAttributes(text) {
  const marker = text.indexOf('MEGA');
  let from = marker >= 0 ? marker + 4 : 0;
  const open = text.indexOf('{', from);
  if (open === -1) return {};
  let depth = 0;
  let inString = false;
  let escaped = false;
  let close = -1;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i + 1;
        break;
      }
    }
  }
  if (close === -1) return {};
  try {
    return JSON.parse(text.slice(open, close));
  } catch {
    try {
      const name = /"n"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text.slice(open, close))?.[1];
      return name ? { n: name } : {};
    } catch {
      return {};
    }
  }
}

// Descifra los atributos (JSON con el nombre) de un nodo de MEGA. Siempre es
// AES-128-CBC con la clave AES real del nodo (ya "condensada" si venía de un
// archivo) y un IV en ceros: así lo hace MEGA para archivos y carpetas.
function megaDecryptAttributes(atB64, key16) {
  if (!atB64 || !key16) return {};
  try {
    const plain = aesDecryptCbc(megab64decode(atB64), key16, Buffer.alloc(16)).toString('latin1');
    return megaParseAttributes(plain);
  } catch {
    return {};
  }
}

// Descifra la clave de un nodo dentro de una carpeta. El campo "k" de la API
// trae una o más entradas "handleDelPropioNodo:claveCifrada" separadas por
// "/" (una por cada acceso concedido); se usa la que coincide con el handle
// del propio nodo (o la primera si no hay coincidencia exacta) y se descifra
// en bloques ECB con la clave de la carpeta (sin IV, sin relleno). El
// resultado son 16 bytes (subcarpeta, se usa tal cual) o 32 bytes (archivo,
// que requiere además el XOR de "condensación" para obtener la clave AES real
// y separar el nonce/metaMac, igual que decodeMegaFileKey).
function decryptNodeKey(rawK, folderKey, nodeHandle) {
  const entries = String(rawK || '')
    .split('/')
    .filter(Boolean);
  const chosen = entries.find((entry) => entry.startsWith(`${nodeHandle}:`)) || entries[0] || '';
  const b64 = chosen.includes(':') ? chosen.slice(chosen.indexOf(':') + 1) : chosen;
  if (!b64) return null;
  let decoded;
  try {
    decoded = aesDecryptEcbBlocks(megab64decode(b64), folderKey);
  } catch {
    return null;
  }
  if (decoded.length === 16)
    return { raw: decoded, k: decoded, iv: null, metaMac: null, isFolder: true };
  if (decoded.length === 32) {
    const first = decoded.subarray(0, 16);
    const second = decoded.subarray(16, 32);
    return {
      raw: decoded,
      k: xorBuffers(first, second),
      iv: second.subarray(0, 8),
      metaMac: second.subarray(8, 16),
      isFolder: false,
    };
  }
  return null;
}

// ---------- API ----------

// Las operaciones dentro de una carpeta compartida (listar con 'f' o descargar
// un archivo suyo con 'g') exigen el parámetro "n" con el handle de la carpeta
// en la query string; sin él la API responde -15 (sesión inválida). Los
// enlaces de archivo público sueltos no lo necesitan.
async function megaApiRequest(payload, folderHandle) {
  const url = new URL(API_BASE);
  url.searchParams.set('id', 'megadl');
  url.searchParams.set('domain', 'meganz');
  if (folderHandle) url.searchParams.set('n', folderHandle);
  const response = await fetch(url.href, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'User-Agent': BROWSER_UA },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(megaHttpErrorMessage(response.status));
  return response.json();
}

// Errores HTTP (no de la API de comandos) que puede devolver tanto g.api.mega
// como los servidores de almacenamiento al descargar el contenido cifrado.
function megaHttpErrorMessage(status) {
  if (status === 509)
    return 'MEGA superó el límite de ancho de banda para descargas anónimas de este servidor. Espera unas horas o inicia sesión en MEGA en el navegador y vuelve a intentarlo más tarde.';
  if (status === 429)
    return 'MEGA está limitando las solicitudes por exceso de peticiones. Reintenta en unos minutos.';
  return `MEGA respondió ${status}.`;
}

function megaApiErrorMessage(code) {
  const known = {
    '-2': 'MEGA rechazó la solicitud por exceso de peticiones. Reintenta en unos segundos.',
    '-3': 'MEGA no encontró el archivo: el enlace expiró o fue eliminado.',
    '-4': 'MEGA requiere autenticación para este enlace.',
    '-9': 'MEGA no encontró el nodo o el enlace dejó de ser válido.',
    '-13': 'La cuenta de MEGA del archivo está temporalmente bloqueada.',
    '-14': 'MEGA no pudo verificar la clave del enlace.',
    '-15':
      'MEGA rechazó la sesión para este enlace (puede haber cambiado o requerir la carpeta completa).',
    '-16': 'El enlace superó el cupo de transferencia de MEGA.',
  };
  return known[String(code)] || `MEGA respondió un error de API (código ${code}).`;
}

// MEGA reporta los errores de dos formas: un entero negativo suelto como único
// elemento del array (p. ej. [-15]) o un objeto con campo "e" (p. ej. {e:-9}).
function megaRequire(data, message) {
  if (!data || !Array.isArray(data) || data[0] === undefined || data[0] === null)
    throw new Error(message);
  const item = data[0];
  if (typeof item === 'number') throw new Error(megaApiErrorMessage(item));
  if (typeof item === 'object' && item.e !== undefined)
    throw new Error(megaApiErrorMessage(item.e));
  return item;
}

// Resuelve un archivo público de MEGA: pide el enlace de descarga, el tamaño y
// descifra los atributos para conocer el nombre. Devuelve
// { url, name, size, key } donde key contiene { k, iv, metaMac }.
async function resolveMegaFile(handle, keyB64) {
  const fileKey = decodeMegaFileKey(keyB64);
  const data = megaRequire(
    await megaApiRequest([{ a: 'g', g: 1, p: handle, ssl: 1 }]),
    'MEGA no respondió los datos del archivo.',
  );
  if (!data.g) throw new Error('MEGA no entregó el enlace de descarga del archivo.');
  const attributes = megaDecryptAttributes(data.at, fileKey.k);
  return {
    url: data.g,
    size: data.s,
    name: attributes.n || 'Archivo de MEGA',
    key: fileKey,
  };
}

// Lista el contenido de una carpeta compartida: la API devuelve el árbol completo
// (carpeta raíz + descendientes) como una lista plana con referencias al padre.
// Aquí se descifran las claves de cada nodo y sus atributos (nombres).
// Devuelve { name, entries } con entries = [{ h, p, t, s, key, name }].
async function resolveMegaFolderTree(handle, keyB64) {
  const folder = decodeMegaFolderKey(keyB64);
  const data = megaRequire(
    await megaApiRequest([{ a: 'f', c: 1, r: 1, ca: 1, p: handle }], handle),
    'MEGA no dejó leer la carpeta.',
  );
  // La API responde con { f: [nodos...] } (además de otras listas que no se usan aquí).
  const nodes = (Array.isArray(data.f) ? data.f : []).filter((node) => node && node.h);
  // MEGA no siempre incluye un nodo para el handle de la URL (el handle "público"
  // de la carpeta puede diferir del handle interno de su nodo raíz). Por eso el
  // nivel superior del árbol no se detecta por "p === handle" sino por exclusión:
  // cualquier nodo cuyo padre no aparece en la lista es, en la práctica, de
  // primer nivel dentro de lo que esta carpeta puede ver.
  const handles = new Set(nodes.map((node) => node.h));
  let rootName = '';
  const entries = [];
  for (const node of nodes) {
    const parent = handles.has(node.p) ? node.p : '';
    if (node.h === handle) {
      // La raíz usa directamente la clave de la carpeta del enlace (16 bytes).
      const name = megaDecryptAttributes(node.a, folder.k).n || 'Carpeta de MEGA';
      rootName = name;
      entries.push({ h: node.h, p: parent, t: 'folder', s: 0, name });
      continue;
    }
    // El campo "k" trae "<handleDelPropioNodo>:<claveCifrada>" (una entrada por
    // cada acceso concedido); se busca la del propio nodo y, si no aparece, se
    // usa la primera disponible.
    const decrypted = decryptNodeKey(node.k, folder.k, node.h);
    const name = decrypted
      ? megaDecryptAttributes(node.a, decrypted.k).n || `Elemento de MEGA (${node.h})`
      : `Elemento de MEGA (${node.h})`;
    entries.push({
      h: node.h,
      p: parent,
      t: node.t === 1 ? 'folder' : 'file',
      s: node.s || 0,
      name,
    });
  }
  return { name: rootName, entries };
}

// Resuelve UN archivo dentro de una carpeta compartida (enlace
// mega.nz/folder/<fh>#<fk>/file/<h>): hay que listar la carpeta con el
// contexto "n" para encontrar y descifrar la clave del nodo, y pedir la
// descarga también con ese contexto. Devuelve lo mismo que resolveMegaFile.
async function resolveMegaFolderFile(folderHandle, folderKeyB64, fileHandle) {
  const folder = decodeMegaFolderKey(folderKeyB64);
  const listing = megaRequire(
    await megaApiRequest([{ a: 'f', c: 1, r: 1, ca: 1, p: folderHandle }], folderHandle),
    'MEGA no dejó leer la carpeta.',
  );
  const nodes = Array.isArray(listing.f) ? listing.f : [];
  const node = nodes.find((entry) => entry && entry.h === fileHandle);
  if (!node) throw new Error('MEGA no encontró el archivo dentro de la carpeta.');
  const decrypted = decryptNodeKey(node.k, folder.k, node.h);
  if (!decrypted || decrypted.isFolder)
    throw new Error('MEGA no pudo descifrar la clave del archivo.');
  const data = megaRequire(
    // Dentro de una carpeta el comando 'g' referencia el archivo con "n" (no
    // "p"); con "p" la API responde -9 aunque el handle y el contexto sean
    // correctos.
    await megaApiRequest([{ a: 'g', g: 1, n: fileHandle, ssl: 1 }], folderHandle),
    'MEGA no respondió los datos del archivo.',
  );
  if (!data.g) throw new Error('MEGA no entregó el enlace de descarga del archivo.');
  const attributes = megaDecryptAttributes(node.a, decrypted.k);
  return {
    url: data.g,
    size: data.s || node.s || 0,
    name: attributes.n || 'Archivo de MEGA',
    key: { k: decrypted.k, iv: decrypted.iv, metaMac: decrypted.metaMac },
  };
}

// ---------- Descargador con descifrado AES-CTR por chunks ----------

// Límites de los chunks de MEGA: 128/256/384/768 KiB y luego 768 KiB fijos.
function megaChunks(size) {
  const sizes = [128, 256, 384, 768];
  const chunks = [];
  let start = 0;
  for (let index = 0; start < size; index += 1) {
    const chunkSize = (sizes[index] ?? sizes[sizes.length - 1]) * 1024;
    const end = Math.min(size, start + chunkSize);
    chunks.push({ start, end });
    start = end;
  }
  return chunks;
}

function ctrIvForChunk(key, chunkIndex) {
  const block = Buffer.alloc(16);
  key.iv.copy(block, 0);
  block.writeBigUInt64BE(BigInt(chunkIndex), 8);
  return block;
}

// Descargador propio de MEGA. Emite los mismos eventos que node-downloader-helper
// para integrarse con DownloadManager: 'progress.throttled', 'stop', 'error',
// 'end' ({ filePath }). Soporta pausa/reaunada: cada chunk se descifra con su
// propio contador CTR, así que al reanudar solo hay que pedir por Range el resto.
class MegaDownloader extends EventEmitter {
  constructor({ downloadUrl, key, size, destination, fileName }) {
    super();
    this.downloadUrl = downloadUrl;
    this.key = key;
    this.size = size || 0;
    this.destination = destination;
    this.fileName = fileName;
    this.finalPath = path.join(destination, fileName);
    this.partPath = path.join(destination, `${fileName}.part`);
    this.controller = new AbortController();
    this.stopped = false;
  }
  stop() {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    try {
      this.controller.abort();
    } catch {
      // Sin acción: ya se considera detenido.
    }
    return Promise.resolve();
  }
  pause() {
    return this.stop();
  }
  async start() {
    try {
      fs.mkdirSync(this.destination, { recursive: true });
      const resumeStart = fs.existsSync(this.partPath) ? fs.statSync(this.partPath).size : 0;
      const chunks = megaChunks(this.size);

      // Archivo vacío: se crea directamente y se termina.
      if (this.size === 0) {
        this.writeFileThenClean();
        this.emitProgress(true);
        this.emit('end', { filePath: this.finalPath });
        return;
      }

      // Una parte completa previa (p. ej. tras un crash) solo necesita renombrarse.
      if (resumeStart > 0 && resumeStart === this.size) {
        this.renamePart();
        this.emitProgress(true);
        this.emit('end', { filePath: this.finalPath });
        return;
      }

      let chunkIndex = 0;
      let skipBytes = 0;
      let rangeFrom = 0;
      if (resumeStart > 0 && chunks.length) {
        const found = chunks.findIndex(
          (chunk) => resumeStart >= chunk.start && resumeStart < chunk.end,
        );
        if (found === -1 && resumeStart < chunks[chunks.length - 1].end)
          throw new Error('MEGA: la posición de reanudación no es válida.');
        chunkIndex = found === -1 ? chunks.length - 1 : found;
        rangeFrom = chunks[chunkIndex].start;
        skipBytes = resumeStart - rangeFrom;
      }

      const headers = { 'User-Agent': BROWSER_UA };
      if (rangeFrom > 0) headers.Range = `bytes=${rangeFrom}-`;
      const response = await fetch(this.downloadUrl, {
        headers,
        signal: this.controller.signal,
      });
      if (!response.ok) throw new Error(megaHttpErrorMessage(response.status));
      const resumeAccepted = resumeStart > 0 && response.status === 206;
      if (resumeStart > 0 && response.status === 200) {
        // El servidor ignoró el rango: se reinicia la descarga desde cero.
        if (fs.existsSync(this.partPath)) fs.unlinkSync(this.partPath);
        chunkIndex = 0;
        skipBytes = 0;
      }
      if (!response.body) throw new Error('MEGA no entregó el contenido del archivo.');

      const reader = response.body.getReader();
      const output = fs.createWriteStream(this.partPath, {
        flags: resumeAccepted ? 'a' : 'w',
      });
      const outputError = new Promise((_resolve, reject) => {
        output.on('error', reject);
      });

      let decipher = createdChunkDecipher(this.key, chunkIndex);
      let chunk = chunks[chunkIndex];
      // El Range siempre pide desde el INICIO del chunk (alineado), así que el
      // cifrado consumido dentro del chunk arranca en 0; lo que sí se descarta
      // son los primeros "skipBytes" bytes ya escritos del texto DESCIFRADO.
      let consumedInChunk = 0;
      let drop = skipBytes;
      let written = resumeAccepted ? resumeStart : 0;
      // Bytes de cifrado que quedan por consumir (desde rangeFrom hasta el final).
      let remaining = this.size - rangeFrom;

      const pump = (buffer) =>
        new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          output.once('error', onError);
          output.write(buffer, () => {
            output.removeListener('error', onError);
            resolve();
          });
        });

      this.emitProgress(true, written);
      for (;;) {
        if (remaining <= 0) break;
        const { value, done } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length && remaining > 0) {
          if (consumedInChunk >= chunk.end - chunk.start) {
            chunkIndex += 1;
            if (chunkIndex >= chunks.length) break;
            chunk = chunks[chunkIndex];
            consumedInChunk = 0;
            drop = 0;
            decipher = createdChunkDecipher(this.key, chunkIndex);
          }
          const take = Math.min(
            value.length - offset,
            chunk.end - chunk.start - consumedInChunk,
            remaining,
          );
          let plain = decipher.update(value.subarray(offset, offset + take));
          offset += take;
          consumedInChunk += take;
          remaining -= take;
          if (drop > 0) {
            const trimmed = Math.min(drop, plain.length);
            plain = plain.subarray(trimmed);
            drop -= trimmed;
          }
          if (plain.length) {
            written += plain.length;
            await pump(plain);
            this.emitProgress(false, written);
          }
        }
      }
      let tail = decipher.final();
      if (drop > 0) tail = tail.subarray(Math.min(drop, tail.length));
      if (tail.length) {
        written += tail.length;
        await pump(tail);
      }
      await Promise.race([pumpEnd(output), outputError]);
      if (written !== this.size)
        throw new Error('MEGA descargó un archivo incompleto. Reintenta la descarga.');

      this.emitProgress(true, written);
      this.renamePart();
      this.emit('end', { filePath: this.finalPath });
    } catch (error) {
      // La interrupción por pausa/stop no es un fallo de la tarea.
      if (this.stopped || error?.name === 'AbortError') {
        this.emit('stop');
        return;
      }
      this.emit('error', error);
    }
  }
  emitProgress(force, bytes) {
    const now = Date.now();
    if (!this._lastEmit) this._lastEmit = { time: now, bytes: 0, speed: 0 };
    if (!force && now - this._lastEmit.time < 500) return;
    const elapsed = Math.max(1, now - this._lastEmit.time);
    const speed = Math.round(((bytes - this._lastEmit.bytes) / elapsed) * 1000);
    this._lastEmit = { time: now, bytes, speed };
    this.emit('progress.throttled', {
      progress: this.size ? Math.floor((bytes / this.size) * 100) : 0,
      speed: speed > 0 ? speed : 0,
      downloaded: bytes,
      total: this.size,
    });
  }
  writeFileThenClean() {
    fs.mkdirSync(this.destination, { recursive: true });
    fs.writeFileSync(this.partPath, Buffer.alloc(0));
  }
  renamePart() {
    if (fs.existsSync(this.finalPath)) {
      try {
        fs.unlinkSync(this.finalPath);
      } catch {
        // Se sustituye con copia abajo si no se puede renombrar.
      }
    }
    try {
      fs.renameSync(this.partPath, this.finalPath);
    } catch {
      fs.copyFileSync(this.partPath, this.finalPath);
      try {
        fs.unlinkSync(this.partPath);
      } catch {
        // El archivo quedó copiado aunque no se pueda borrar la parte.
      }
    }
  }
}

function createdChunkDecipher(key, chunkIndex) {
  return crypto.createDecipheriv('aes-128-ctr', key.k, ctrIvForChunk(key, chunkIndex));
}

function pumpEnd(output) {
  return new Promise((resolve, reject) => {
    output.end(() => resolve());
    output.once('error', reject);
  });
}

module.exports = {
  megab64decode,
  megab64encode,
  megaFileParts,
  megaFolderParts,
  megaFolderFileParts,
  isMegaUrl,
  decodeMegaFileKey,
  decodeMegaFolderKey,
  megaChunks,
  megaDecryptAttributes,
  decryptNodeKey,
  megaApiErrorMessage,
  megaHttpErrorMessage,
  resolveMegaFile,
  resolveMegaFolderTree,
  resolveMegaFolderFile,
  MegaDownloader,
};
