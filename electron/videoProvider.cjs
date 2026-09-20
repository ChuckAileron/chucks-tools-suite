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

async function fetchInfo(originalUrl) {
  return run(['-J', '--no-playlist', '--no-warnings', '--no-check-certificates', originalUrl]);
}

async function listVideoFormats(originalUrl) {
  let output;
  try {
    output = await fetchInfo(originalUrl);
  } catch (error) {
    // yt-dlp puede quedar desactualizado frente a los cambios de YouTube y fallar
    // al reconocer el contenido del enlace. Intentamos auto-actualizarlo y reintentar
    // una sola vez antes de reportar el error al usuario.
    if (isExtractionError(error.message) && (await selfUpdate())) {
      output = await fetchInfo(originalUrl);
    } else {
      throw error;
    }
  }
  const info = JSON.parse(output);
  const title = String(info.title || 'Video').replace(/\s+/g, ' ').trim().slice(0, 120);
  const host = new URL(info.webpage_url || originalUrl).hostname;
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const byHeight = new Map();
  const hasAudio = (format) => format.acodec && format.acodec !== 'none';
  for (const format of formats) {
    if (!format.vcodec || format.vcodec === 'none') continue;
    const key = String(format.height || 0);
    const existing = byHeight.get(key);
    if (!existing) byHeight.set(key, format);
    else if (!hasAudio(existing) && hasAudio(format)) byHeight.set(key, format);
  }
  const candidates = [];
  const rows = [...byHeight.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  for (const [height, format] of rows) {
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
  if (formats.some((format) => !format.vcodec || format.vcodec === 'none')) {
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

function downloadVideo({ url, destination, name, format, onProgress }) {
  let stopped = false;
  const height = String(format).replace(/^video:/, '');
  const formatId = format === 'audio' ? 'ba/b' : `bv*[height<=${height}]+ba/b[height<=${height}]/b`;
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

module.exports = { listVideoFormats, downloadVideo, isVideoLink };