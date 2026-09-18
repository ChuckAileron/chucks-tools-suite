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
          stat = await fs.promises.stat(absolute);
        files.push({ path: absolute, name: entry.name, folder, size: stat.size });
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
async function normalizeMedia({ input, type, targetDb, onProgress, onProcess, isCancelled }) {
  if (!Number.isFinite(targetDb) || targetDb < -50 || targetDb > -5)
    throw new Error('El objetivo debe estar entre -50 y -5 LUFS.');
  const extension = path.extname(input),
    output = path.join(
      path.dirname(input),
      `${path.basename(input, extension)}_normalized${extension}`,
    ),
    temporary = `${output.slice(0, -extension.length)}.part${extension}`;
  fs.rmSync(temporary, { force: true });
  const duration = await durationOf(input),
    args = ['-y', '-i', input];
  if (type === 'video') args.push('-map', '0:v:0?', '-map', '0:a?', '-c:v', 'copy');
  args.push('-af', `loudnorm=I=${targetDb}:TP=-1.5:LRA=11`, temporary);
  await new Promise((resolve, reject) => {
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
    command.once('error', reject);
    command.once('close', (code) => {
      onProcess(null);
      if (isCancelled()) {
        fs.rmSync(temporary, { force: true });
        return reject(Object.assign(new Error('Cancelado'), { code: 'CANCELLED' }));
      }
      if (code !== 0) {
        fs.rmSync(temporary, { force: true });
        return reject(new Error(stderr || `FFmpeg terminó con código ${code}`));
      }
      fs.renameSync(temporary, output);
      onProgress(100);
      resolve();
    });
  });
  return output;
}
module.exports = { scanMedia, normalizeMedia };
