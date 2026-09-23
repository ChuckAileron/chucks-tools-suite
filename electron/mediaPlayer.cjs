const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const officeParser = require('officeparser');

// --- Tipos MIME para streaming ---------------------------------------------
const MIME_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  vob: 'video/dvd',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  asf: 'video/x-ms-asf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  wma: 'audio/x-ms-wma',
  opus: 'audio/opus',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};
function mimeFor(extension) {
  return MIME_TYPES[String(extension || '').toLowerCase()] || 'application/octet-stream';
}

// --- Extracción de contenido de documentos ---------------------------------
// Archivos de texto plano se leen directamente; el resto (pdf, doc/docx,
// xls/xlsx, ppt/pptx, odt/ods/odp, rtf) se procesa con officeparser.
const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);
async function extractDocumentText(absolutePath, extension) {
  const ext = String(extension || '').toLowerCase();
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) return fsp.readFile(absolutePath, 'utf8');
  return officeParser.parseOfficeAsync(absolutePath);
}

// --- Handler del protocolo hddmedia:// --------------------------------------
// Sirve el contenido real de un archivo catalogado en un HDD (video, audio o
// imagen) directamente desde disco, soportando peticiones de rango (Range)
// para permitir búsqueda/seek en reproductores de video y audio.
function createStreamHandler({ getEntry, getDrive, resolveConnection }) {
  return async function handleHddMediaRequest(request) {
    try {
      const url = new URL(request.url);
      const driveId = Number(url.hostname);
      const entryId = Number(url.pathname.replace(/^\//, ''));
      const entry = getEntry(entryId);
      if (!entry || entry.driveId !== driveId || entry.isDirectory)
        return new Response('No encontrado', { status: 404 });
      const drive = getDrive(driveId);
      const connection = await resolveConnection(drive);
      if (!connection.connected) return new Response('HDD desconectado', { status: 404 });
      const absolute = path.join(connection.mountPoint, entry.relativePath);
      if (!fs.existsSync(absolute)) return new Response('Archivo no encontrado', { status: 404 });
      const stat = await fsp.stat(absolute);
      const mime = mimeFor(entry.extension);
      const range = request.headers.get('range');
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        const start = match ? Number(match[1]) : 0;
        const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        const stream = fs.createReadStream(absolute, { start, end });
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
      const stream = fs.createReadStream(absolute);
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (error) {
      return new Response(String(error.message || error), { status: 500 });
    }
  };
}

module.exports = { mimeFor, extractDocumentText, createStreamHandler };
