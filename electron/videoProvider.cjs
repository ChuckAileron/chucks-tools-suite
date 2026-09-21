const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const VIDEO_HOSTS = [
  /(^|\.)(m\.|music\.)?youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)dailymotion\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)(twitter|x)\.com$/i,
  /(^|\.)soundcloud\.com$/i,
  /(^|\.)rutube\.ru$/i,
  /(^|\.)(vk|ok)\.ru$/i,
];

function resolveYtDlp() {
  const resourcesPath = process.resourcesPath || '';
  const candidates = [
    path.join(resourcesPath, 'app.asar.unpacked', 'vendor', 'yt-dlp', 'yt-dlp.exe'),
    path.join(__dirname, '..', 'vendor', 'yt-dlp', 'yt-dlp.exe'),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return 'yt-dlp';
}

function isVideoLink(value) {
  try {
    const hostname = new URL(value).hostname;
    return VIDEO_HOSTS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

let updatePromise = null;
function selfUpdate() {
  if (updatePromise) return updatePromise;
  updatePromise = new Promise((resolve) => {
    const child = spawn(resolveYtDlp(), ['-U', '--no-warnings'], { windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(/Updated yt-dlp/i.test(stdout)));
  }).catch(() => false);
  return updatePromise;
}

function isExtractionError(message) {
  return /unsupported url|unable to extract|no video formats found|failed to extract|sign in to confirm|http error 403|precondition/i.test(
    String(message || ''),
  );
}

function run(args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlp(), args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => {
      child.kill();
      reject(new Error('El análisis del video tardó demasiado.'));
    }, timeout || 60000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(guard);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(guard);
      if (code !== 0) {
        const detail = (stderr || stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line.startsWith('[ERROR]') || !line.startsWith('['))
          .pop();
        reject(new Error(detail || `yt-dlp falló con código ${code}.`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseSize(value) {
  const match = String(value || '').match(/^([\d.]+)\s*([KMGT])?(i?B|B)?$/);
  if (!match) return 0;
  const size = Number(match[1]) || 0;
  const power = { K: 1, M: 2, G: 3, T: 4 }[match[2]?.toUpperCase()] || 0;
  return Math.round(size * 1024 ** power);
}

// yt-dlp puede quedar desactualizado frente a los cambios de YouTube y fallar
// al reconocer el contenido del enlace. Se intenta auto-actualizarlo y
// reintentar una sola vez antes de reportar el error al usuario.
async function runWithRetry(args, timeout) {
  try {
    return await run(args, timeout);
  } catch (error) {
    if (isExtractionError(error.message) && (await selfUpdate())) return run(args, timeout);
    throw error;
  }
}

function formatIdFor(format) {
  if (format === 'audio') return 'ba/b';
  const height = Number(String(format).replace(/^video:/, ''));
  // "video:best" (o un formato sin altura numérica) descarga la mejor calidad.
  return Number.isFinite(height) && height > 0
    ? `bv*[height<=${height}]+ba/b[height<=${height}]/b`
    : 'bv*+ba/b';
}

function isPlaylistUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (!/(^|\.)(m\.|music\.)?youtube\.com$/i.test(host) && !/(^|\.)youtu\.be$/i.test(host))
      return false;
    if (url.searchParams.has('list')) return true;
    return /^\/playlist(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

const PLAYLIST_LIMIT = 500;

function parsePlaylistInfo(raw) {
  const info = JSON.parse(raw);
  if (info._type !== 'playlist' || !Array.isArray(info.entries)) return { title: '', videos: [] };
  const title = String(info.title || 'Lista de YouTube')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const videos = [];
  for (const entry of info.entries) {
    if (videos.length >= PLAYLIST_LIMIT) break;
    if (!entry?.id) continue;
    videos.push({
      id: entry.id,
      title:
        String(entry.title || entry.id)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120) || entry.id,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`,
    });
  }
  return { title, videos };
}

// Agrupa los formatos con video por altura, priorizando el que ya incluye
// audio integrado, para no ofrecer variantes redundantes de una misma
// resolución.
function collectVideoHeights(formats) {
  const byHeight = new Map();
  const hasAudio = (format) => format.acodec && format.acodec !== 'none';
  for (const format of formats) {
    if (!format.vcodec || format.vcodec === 'none') continue;
    const key = String(format.height || 0);
    const existing = byHeight.get(key);
    if (!existing) byHeight.set(key, format);
    else if (!hasAudio(existing) && hasAudio(format)) byHeight.set(key, format);
  }
  return [...byHeight.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
}

function hasAudioOnlyFormat(formats) {
  return formats.some((format) => !format.vcodec || format.vcodec === 'none');
}

async function listVideoFormats(originalUrl) {
  const output = await runWithRetry([
    '-J',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    originalUrl,
  ]);
  const info = JSON.parse(output);
  const title = String(info.title || 'Video').replace(/\s+/g, ' ').trim().slice(0, 120);
  const host = new URL(info.webpage_url || originalUrl).hostname;
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const candidates = [];
  for (const [height, format] of collectVideoHeights(formats)) {
    const heightNumber = Number(height);
    const label = String(format.format_note || `${heightNumber}p`).trim();
    candidates.push({
      id: randomUUID(),
      originalUrl,
      url: originalUrl,
      name: `${title} [${label}]`,
      host,
      online: true,
      mode: label,
      videoUrl: originalUrl,
      videoFormat: `video:${heightNumber}`,
      collection: title,
      selected: true,
    });
  }
  if (hasAudioOnlyFormat(formats)) {
    candidates.push({
      id: randomUUID(),
      originalUrl,
      url: originalUrl,
      name: `${title} [audio]`,
      host,
      online: true,
      mode: 'audio',
      videoUrl: originalUrl,
      videoFormat: 'audio',
      collection: title,
      selected: true,
    });
  }
  return candidates;
}

// Devuelve solo las opciones de calidad disponibles para un video (sin
// generar una fila por resolución); se usa para el selector de resolución
// de cada video dentro de una lista de YouTube.
async function listVideoQualityOptions(originalUrl) {
  const output = await runWithRetry([
    '-J',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    originalUrl,
  ]);
  const info = JSON.parse(output);
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const options = [{ label: 'Mejor calidad', videoFormat: 'video:best' }];
  for (const [height, format] of collectVideoHeights(formats)) {
    const heightNumber = Number(height);
    options.push({
      label: String(format.format_note || `${heightNumber}p`).trim(),
      videoFormat: `video:${heightNumber}`,
    });
  }
  if (hasAudioOnlyFormat(formats)) options.push({ label: 'Solo audio', videoFormat: 'audio' });
  return options;
}

// Listar los videos de una lista puede tardar bastante más que analizar un
// solo video (yt-dlp recorre cada entrada de la lista), así que se usa un
// tiempo de espera más generoso para evitar falsos "no funciona" en listas
// grandes.
const PLAYLIST_TIMEOUT = 180000;

async function listPlaylistVideos(originalUrl) {
  const output = await runWithRetry(
    [
      '-J',
      '--flat-playlist',
      '--playlist-end',
      String(PLAYLIST_LIMIT),
      '--no-warnings',
      '--no-check-certificates',
      originalUrl,
    ],
    PLAYLIST_TIMEOUT,
  );
  return parsePlaylistInfo(output);
}

function downloadVideo({ url, destination, name, format, onProgress }) {
  let stopped = false;
  const formatId = formatIdFor(format);
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--continue',
    '--progress',
    '-f',
    formatId,
    '--merge-output-format',
    'mp4',
    '-o',
    path.join(destination, `${String(name).replace(/%/g, '%%')}.%(ext)s`),
    '--print',
    'after_move:filepath',
    url,
  ];
  const child = spawn(resolveYtDlp(), args, { windowsHide: true });
  let stdout = '';
  let stderr = '';
  const PROGRESS = /^\[download\]\s+([\d.]+)%\s+of\s+?[~ ]*([\d.]+\s*[A-Za-z]+\b)?.*?\bat\s+([\d.]+\s*[A-Za-z]+)\/s/;
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    for (const line of String(chunk).split(/\r?\n/)) {
      const match = line.match(PROGRESS);
      if (!match) continue;
      const percent = Math.min(100, parseFloat(match[1]));
      const total = parseSize(match[2]);
      const speed = parseSize(match[3]);
      onProgress?.({
        progress: Math.floor(percent),
        speed,
        downloaded: Math.round((total * percent) / 100),
        total,
      });
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('error', () => {});
  const result = new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (stopped) {
        resolve({ stopped: true });
        return;
      }
      if (code !== 0) {
        const detail = (stderr || stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line.startsWith('[ERROR]') || !line.startsWith('['))
          .join(' | ');
        reject(new Error(detail || `yt-dlp falló con código ${code}.`));
        return;
      }
      const filePath = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('[') && /[.:\\/]/.test(line));
      resolve({ filePath });
    });
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (process.platform === 'win32' && child.pid)
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
    else child.kill('SIGKILL');
  };
  return { result, stop };
}

module.exports = {
  listVideoFormats,
  listVideoQualityOptions,
  listPlaylistVideos,
  downloadVideo,
  isVideoLink,
  isPlaylistUrl,
  parsePlaylistInfo,
  formatIdFor,
  // Helpers puros expuestos para pruebas unitarias.
  resolveYtDlp,
  isExtractionError,
  parseSize,
  collectVideoHeights,
  hasAudioOnlyFormat,
};