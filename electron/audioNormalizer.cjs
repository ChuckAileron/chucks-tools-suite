const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const EXTENSIONS = {
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
};
async function scanMedia(folders, type) {
  const files = [];
  for (const folder of folders)
    for (const entry of await fs.promises.readdir(folder, { withFileTypes: true }))
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
const cancelledError = () => Object.assign(new Error('Cancelado'), { code: 'CANCELLED' });
async function measureLoudness(input, targetDb, onProcess, isCancelled) {
  const filter = `loudnorm=I=${targetDb}:TP=-1.5:LRA=11:print_format=json`;
  return new Promise((resolve, reject) => {
    const command = spawn('ffmpeg', [
      '-hide_banner',
      '-i',
      input,
      '-af',
      filter,
      '-f',
      'null',
      '-',
    ]);
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
async function normalizeMedia({ input, type, targetDb, onProgress, onProcess, isCancelled }) {
  if (!Number.isFinite(targetDb) || targetDb < -50 || targetDb > -5)
    throw new Error('El objetivo debe estar entre -50 y -5 LUFS.');
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
  return output;
}
module.exports = { scanMedia, normalizeMedia };
