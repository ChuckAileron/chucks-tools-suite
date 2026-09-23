const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const EXTENSIONS = {
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
};
// Tolerancia (en segundos) para considerar que un límite de corte coincide
// con el inicio o el final real del archivo.
const EDGE_TOLERANCE = 0.05;

const durationOf = (input) =>
  new Promise((resolve) =>
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input],
      (error, stdout) => resolve(error ? 0 : Number.parseFloat(stdout) || 0),
    ),
  );

// Lista los archivos de audio/video de las carpetas indicadas junto a su
// duración (necesaria para validar y calcular los rangos de corte). Se
// excluyen los archivos ya generados por esta misma herramienta.
async function scanMedia(folders, type) {
  const files = [];
  for (const folder of folders) {
    let entries;
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.isFile() &&
        EXTENSIONS[type].includes(path.extname(entry.name).toLowerCase()) &&
        !/_trim(_part[12])?\.[^.]+$/i.test(entry.name)
      ) {
        const absolute = path.join(folder, entry.name);
        const stat = await fs.promises.stat(absolute);
        const duration = await durationOf(absolute);
        files.push({ path: absolute, name: entry.name, folder, size: stat.size, duration });
      }
    }
  }
  return files;
}

const cancelledError = () => Object.assign(new Error('Cancelado'), { code: 'CANCELLED' });

// Corta un segmento [start, start+duration) de `input` hacia `output`
// copiando los flujos (sin recodificar) para que el recorte sea rápido; el
// punto de corte real puede ajustarse ligeramente al keyframe más cercano,
// como es habitual en recortes con `-c copy`.
function cutSegment({ input, start, duration, output, onProgress, onProcess, isCancelled }) {
  return new Promise((resolve, reject) => {
    const temporary = `${output}.part${path.extname(output)}`;
    fs.rmSync(temporary, { force: true });
    const args = [];
    if (start > 0) args.push('-ss', String(start));
    args.push('-i', input);
    if (Number.isFinite(duration) && duration > 0) args.push('-t', String(duration));
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', temporary);
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
      } catch (renameError) {
        fs.rmSync(temporary, { force: true });
        return reject(renameError);
      }
      resolve(output);
    };
    const command = spawn('ffmpeg', args);
    onProcess(command);
    let stderr = '';
    command.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const match = text.match(/time=([\d:.]+)/);
      if (match && duration) {
        const seconds = match[1]
          .split(':')
          .map(Number)
          .reduce((value, part) => value * 60 + part, 0);
        onProgress(Math.min(1, Math.max(0, seconds / duration)));
      }
    });
    command.once('error', (error) => finish(isCancelled() ? cancelledError() : error));
    command.once('close', (code) => {
      if (isCancelled()) return finish(cancelledError());
      if (code !== 0) return finish(new Error(stderr || `FFmpeg terminó con código ${code}`));
      finish();
    });
  });
}

// Une dos segmentos ya recortados en un único archivo con el demuxer
// `concat` de ffmpeg (funciona sin recodificar porque ambos provienen del
// mismo archivo origen y comparten códec/parámetros).
function concatSegments({ inputs, output, onProcess, isCancelled }) {
  return new Promise((resolve, reject) => {
    const listPath = `${output}.concat.txt`;
    const listContent = inputs
      .map((file) => `file '${file.replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listPath, listContent, 'utf8');
    const temporary = `${output}.part${path.extname(output)}`;
    fs.rmSync(temporary, { force: true });
    const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', temporary];
    let settled = false;
    const cleanup = () => fs.rmSync(listPath, { force: true });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      onProcess(null);
      cleanup();
      if (error) {
        fs.rmSync(temporary, { force: true });
        return reject(error);
      }
      try {
        fs.renameSync(temporary, output);
      } catch (renameError) {
        fs.rmSync(temporary, { force: true });
        return reject(renameError);
      }
      resolve(output);
    };
    const command = spawn('ffmpeg', args);
    onProcess(command);
    let stderr = '';
    command.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    command.once('error', (error) => finish(isCancelled() ? cancelledError() : error));
    command.once('close', (code) => {
      if (isCancelled()) return finish(cancelledError());
      if (code !== 0) return finish(new Error(stderr || `FFmpeg terminó con código ${code}`));
      finish();
    });
  });
}

// Recorta un archivo según el modo indicado:
// - "keep": conserva únicamente [start, end] y descarta el resto.
// - "remove": elimina [start, end]. Si ese tramo toca el inicio o el final
//   del archivo, el resultado es un único segmento (lo que queda). Si el
//   tramo está estrictamente en medio, el resultado son dos segmentos que,
//   según `split`, se entregan como dos archivos independientes o se unen
//   de nuevo en uno solo.
async function trimMedia({
  input,
  type,
  mode,
  start,
  end,
  duration,
  split,
  onProgress,
  onProcess,
  isCancelled,
}) {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('No se pudo determinar la duración del archivo.');
  const clampedStart = Math.max(0, Math.min(start, duration));
  const clampedEnd = Math.max(clampedStart, Math.min(end, duration));
  if (clampedEnd - clampedStart <= EDGE_TOLERANCE)
    throw new Error('El rango de tiempo no es válido.');
  const extension = path.extname(input);
  const base = path.basename(input, extension);
  const outputDirectory = path.join(path.dirname(input), `trimmed_output-${type}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputFor = (suffix) => path.join(outputDirectory, `${base}${suffix}${extension}`);
  const ensureFree = (output) => {
    if (fs.existsSync(output)) throw new Error(`El resultado ya existe: ${output}`);
  };

  if (mode === 'keep') {
    const output = outputFor('_trim');
    ensureFree(output);
    await cutSegment({
      input,
      start: clampedStart,
      duration: clampedEnd - clampedStart,
      output,
      onProgress: (ratio) => onProgress(Math.floor(ratio * 100)),
      onProcess,
      isCancelled,
    });
    return { outputs: [output] };
  }

  // mode === 'remove'
  const touchesStart = clampedStart <= EDGE_TOLERANCE;
  const touchesEnd = clampedEnd >= duration - EDGE_TOLERANCE;
  if (touchesStart && touchesEnd) throw new Error('El tramo a eliminar cubre todo el archivo.');
  if (touchesStart) {
    const output = outputFor('_trim');
    ensureFree(output);
    await cutSegment({
      input,
      start: clampedEnd,
      duration: duration - clampedEnd,
      output,
      onProgress: (ratio) => onProgress(Math.floor(ratio * 100)),
      onProcess,
      isCancelled,
    });
    return { outputs: [output] };
  }
  if (touchesEnd) {
    const output = outputFor('_trim');
    ensureFree(output);
    await cutSegment({
      input,
      start: 0,
      duration: clampedStart,
      output,
      onProgress: (ratio) => onProgress(Math.floor(ratio * 100)),
      onProcess,
      isCancelled,
    });
    return { outputs: [output] };
  }

  // Tramo interior: se generan ambos segmentos y luego se separan o se unen.
  const segmentA = outputFor('_trim_part1.tmp');
  const segmentB = outputFor('_trim_part2.tmp');
  const totalDuration = clampedStart + (duration - clampedEnd);
  let completed = 0;
  const weightedProgress = (segDuration) => (ratio) => {
    const done = completed + ratio * segDuration;
    // Se reserva el último tramo del progreso para la unión final cuando no
    // se separa en dos archivos (el concat es rápido pero no instantáneo).
    const scale = split ? 100 : 92;
    onProgress(Math.floor(Math.min(scale, (done / (totalDuration || 1)) * scale)));
  };
  try {
    await cutSegment({
      input,
      start: 0,
      duration: clampedStart,
      output: segmentA,
      onProgress: weightedProgress(clampedStart),
      onProcess,
      isCancelled,
    });
    completed += clampedStart;
    await cutSegment({
      input,
      start: clampedEnd,
      duration: duration - clampedEnd,
      output: segmentB,
      onProgress: weightedProgress(duration - clampedEnd),
      onProcess,
      isCancelled,
    });
    completed += duration - clampedEnd;
  } catch (error) {
    fs.rmSync(segmentA, { force: true });
    fs.rmSync(segmentB, { force: true });
    throw error;
  }

  if (split) {
    const outputA = outputFor('_trim_part1');
    const outputB = outputFor('_trim_part2');
    if (fs.existsSync(outputA) || fs.existsSync(outputB)) {
      fs.rmSync(segmentA, { force: true });
      fs.rmSync(segmentB, { force: true });
      throw new Error('El resultado ya existe.');
    }
    fs.renameSync(segmentA, outputA);
    fs.renameSync(segmentB, outputB);
    onProgress(100);
    return { outputs: [outputA, outputB] };
  }
  const output = outputFor('_trim');
  if (fs.existsSync(output)) {
    fs.rmSync(segmentA, { force: true });
    fs.rmSync(segmentB, { force: true });
    throw new Error(`El resultado ya existe: ${output}`);
  }
  try {
    await concatSegments({ inputs: [segmentA, segmentB], output, onProcess, isCancelled });
  } finally {
    fs.rmSync(segmentA, { force: true });
    fs.rmSync(segmentB, { force: true });
  }
  onProgress(100);
  return { outputs: [output] };
}

module.exports = { scanMedia, durationOf, trimMedia };
