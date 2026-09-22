const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const EXTENSIONS = {
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
};
async function scanMedia(folders, type) {
  const files = [];
  for (const folder of folders) {
    let entries;
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries)
      if (
        entry.isFile() &&
        EXTENSIONS[type].includes(path.extname(entry.name).toLowerCase()) &&
        !/_normalized\.[^.]+$/i.test(entry.name)
      ) {
        const absolute = path.join(folder, entry.name),
          stat = await fs.promises.stat(absolute),
          extension = path.extname(entry.name),
          outputDirectory = path.join(folder, `normalized_output-${type}`);
        files.push({
          path: absolute,
          name: entry.name,
          folder,
          size: stat.size,
          processed: fs.existsSync(
            path.join(
              outputDirectory,
              `${path.basename(entry.name, extension)}_normalized${extension}`,
            ),
          ),
        });
      }
  }
  return files;
}
const durationOf = (input) =>
  new Promise((resolve) =>
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input],
      (error, stdout) => resolve(error ? 0 : Number.parseFloat(stdout) || 0),
    ),
  );
// Tolerancia (en LU) para considerar que un archivo ya está en el objetivo y
// omitir su procesamiento. Las mediciones de loudnorm no son exactas entre
// pasadas, así que se evita reprocesar archivos que estén "suficientemente
// cerca" del valor deseado.
const LUFS_TOLERANCE = 1;
const cancelledError = () => Object.assign(new Error('Cancelado'), { code: 'CANCELLED' });
// Duración del extracto usado para estimar el LUFS rápidamente en archivos
// largos, y umbral mínimo de duración a partir del cual vale la pena
// recortar (en archivos cortos analizar todo es igual de rápido).
const EXCERPT_DURATION = 30;
const EXCERPT_MIN_SOURCE_DURATION = 45;
// Calcula el punto de inicio y la duración del extracto a analizar. Se evita
// el arranque del archivo (silencios, intros, cortinillas) tomando el
// extracto a partir del 10% de la duración total (o de los 60s, lo que sea
// menor). Devuelve null si el archivo es demasiado corto para que valga la
// pena recortarlo o si no se pudo determinar su duración.
function loudnessExcerpt(duration) {
  if (!Number.isFinite(duration) || duration <= EXCERPT_MIN_SOURCE_DURATION) return null;
  const start = Math.min(duration * 0.1, 60);
  const clipDuration = Math.min(EXCERPT_DURATION, duration - start);
  return clipDuration > 0 ? { start, duration: clipDuration } : null;
}
async function measureLoudness(input, targetDb, onProcess, isCancelled, excerpt) {
  const filter = `loudnorm=I=${targetDb}:TP=-1.5:LRA=11:print_format=json`;
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner'];
    // `-ss` antes de `-i` usa el seek rápido (por keyframes) de ffmpeg, ideal
    // para saltar directo al extracto sin decodificar todo lo anterior.
    if (excerpt?.start) args.push('-ss', String(excerpt.start));
    args.push('-i', input);
    if (excerpt?.duration) args.push('-t', String(excerpt.duration));
    args.push('-af', filter, '-f', 'null', '-');
    const command = spawn('ffmpeg', args);
    onProcess(command);
    let data = '';
    const done = (error, value) => {
      onProcess(null);
      error ? reject(error) : resolve(value);
    };
    command.stdout.on('data', (chunk) => {
      data += chunk;
    });
    command.stderr.on('data', (chunk) => {
      data += chunk;
    });
    command.once('error', (error) => done(isCancelled() ? cancelledError() : error));
    command.once('close', (code) => {
      if (isCancelled()) return done(cancelledError());
      if (code !== 0) return done(new Error('No se pudo medir el audio para normalizar.'));
      let report;
      const match = data.match(/\{[\s\S]*\}/);
      try {
        report = JSON.parse(match ? match[0] : data);
      } catch (error) {
        return done(new Error('No se pudo medir el audio para normalizar.'));
      }
      done(null, {
        measured_i: Number(report.input_i || 0).toFixed(2),
        measured_tp: Number(report.input_tp || 0).toFixed(2),
        measured_lra: Number(report.input_lra || 0).toFixed(2),
        measured_thresh: Number(report.input_thresh || 0).toFixed(2),
      });
    });
  });
}
// Mide únicamente la sonoridad integrada (LUFS) de un archivo, sin aplicar
// ninguna corrección. Se usa para mostrar el valor actual en el listado
// antes de normalizar; el valor de "I" del filtro no afecta la medición.
async function measureLufs(input, isCancelled = () => false, onProcess = () => {}) {
  const duration = await durationOf(input);
  const excerpt = loudnessExcerpt(duration);
  const measured = await measureLoudness(input, -16, onProcess, isCancelled, excerpt);
  return Number(measured.measured_i);
}

async function normalizeMedia({
  input,
  type,
  targetDb,
  knownLufs,
  onProgress,
  onProcess,
  isCancelled,
}) {
  if (!Number.isFinite(targetDb) || targetDb < -50 || targetDb > -5)
    throw new Error('El objetivo debe estar entre -50 y -5 LUFS.');
  // Si ya se conoce el LUFS del archivo (medido al listar) y está dentro de
  // la tolerancia del objetivo, se omite por completo el procesamiento.
  if (Number.isFinite(knownLufs) && Math.abs(knownLufs - targetDb) <= LUFS_TOLERANCE)
    return { skipped: true, measuredLufs: knownLufs, output: null };
  const extension = path.extname(input),
    outputDirectory = path.join(path.dirname(input), `normalized_output-${type}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(
      outputDirectory,
      `${path.basename(input, extension)}_normalized${extension}`,
    ),
    temporary = `${output.slice(0, -extension.length)}.part${extension}`;
  if (fs.existsSync(output)) throw new Error(`El resultado ya existe: ${output}`);
  fs.rmSync(temporary, { force: true });
  const duration = await durationOf(input);
  let measured = null;
  try {
    measured = await measureLoudness(input, targetDb, onProcess, isCancelled);
  } catch (error) {
    if (error.code === 'CANCELLED') throw error;
    measured = null;
  }
  // Doble verificación tras medir en esta misma pasada, por si no se conocía
  // el LUFS de antemano (p. ej. no se alcanzó a medir en el listado).
  if (measured && Math.abs(Number(measured.measured_i) - targetDb) <= LUFS_TOLERANCE)
    return { skipped: true, measuredLufs: Number(measured.measured_i), output: null };
  const filter = measured
    ? `loudnorm=I=${targetDb}:TP=-1.5:LRA=11:measured_I=${measured.measured_i}:measured_TP=${measured.measured_tp}:measured_LRA=${measured.measured_lra}:measured_thresh=${measured.measured_thresh}`
    : `loudnorm=I=${targetDb}:TP=-1.5:LRA=11`;
  const args = ['-y', '-i', input];
  if (type === 'video') args.push('-map', '0:v:0?', '-map', '0:a?', '-c:v', 'copy');
  args.push('-af', filter, temporary);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      onProcess(null);
      if (error) {
        fs.rmSync(temporary, { force: true });
        return reject(error);
      }
      try {
        fs.renameSync(temporary, output);
      } catch (error) {
        fs.rmSync(temporary, { force: true });
        return reject(error);
      }
      onProgress(100);
      resolve();
    };
    const command = spawn('ffmpeg', args);
    onProcess(command);
    let stderr = '';
    command.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      const match = chunk.match(/time=([\d:.]+)/);
      if (match && duration) {
        const seconds = match[1]
          .split(':')
          .map(Number)
          .reduce((value, part) => value * 60 + part, 0);
        onProgress(Math.min(100, Math.floor((seconds / duration) * 100)));
      }
    });
    command.once('error', (error) => finish(isCancelled() ? cancelledError() : error));
    command.once('close', (code) => {
      if (isCancelled()) return finish(cancelledError());
      if (code !== 0) return finish(new Error(stderr || `FFmpeg terminó con código ${code}`));
      finish();
    });
  });
  return { skipped: false, output, measuredLufs: measured ? Number(measured.measured_i) : null };
}
module.exports = {
  scanMedia,
  normalizeMedia,
  measureLufs,
  LUFS_TOLERANCE,
  loudnessExcerpt,
  EXCERPT_DURATION,
  EXCERPT_MIN_SOURCE_DURATION,
};
