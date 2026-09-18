const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const handbrake = require('handbrake-js');

const VIDEO_PATTERN =
  /\.(mp4|m4v|mov|avi|mkv|webm|wmv|flv|mpg|mpeg|ts|mts|m2ts|vob|ogv|3gp|3g2|asf)$/i;
const FFMPEG_PATTERN = /\.(mp4|mov|avi|mkv|webm)$/i;
const videoFiles = (directory) =>
  fs
    .readdirSync(directory)
    .filter((file) => VIDEO_PATTERN.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
const outputPath = (directory, output, file) => {
  const sourceExtension = path.extname(file);
  const extension = FFMPEG_PATTERN.test(file) ? sourceExtension : '.mp4';
  return path.join(output, `${path.basename(file, sourceExtension)}_SD${extension}`);
};
const run = (command, args) =>
  new Promise((resolve, reject) =>
    execFile(command, args, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, { stdout, stderr })) : resolve(stdout),
    ),
  );

async function inspectFolder(directory, codec = 'h264') {
  const files = videoFiles(directory);
  const output = path.join(directory, `sd-output-${codec}`);
  const videos = await Promise.all(
    files.map(async (file) => {
      const inputPath = path.join(directory, file);
      const video = { file, path: inputPath, audio: [], subtitles: [], processed: false };
      if (/\.mkv$/i.test(file)) {
        try {
          const data = JSON.parse(
            await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', inputPath]),
          );
          for (const stream of data.streams || []) {
            if (!['audio', 'subtitle'].includes(stream.codec_type)) continue;
            const track = {
              index: stream.index,
              codec: stream.codec_name || 'desconocido',
              language: stream.tags?.language || 'sin idioma',
              title: stream.tags?.title || '',
              default: stream.disposition?.default === 1,
            };
            video[stream.codec_type === 'audio' ? 'audio' : 'subtitles'].push(track);
          }
        } catch (error) {
          video.probeError = error.message;
        }
      }
      video.processed = fs.existsSync(outputPath(directory, output, file));
      return video;
    }),
  );
  return {
    folder: directory,
    videos,
    processed: videos.length > 0 && videos.every((video) => video.processed),
  };
}

const cancelledError = () =>
  Object.assign(new Error('Conversión cancelada'), { code: 'CANCELLED' });

async function convertFolder(directory, codec, selections, onProgress, controls) {
  const output = path.join(directory, `sd-output-${codec}`);
  fs.mkdirSync(output, { recursive: true });
  const files = videoFiles(directory);
  if (!files.length) return onProgress({ type: 'info', message: 'No hay videos en la carpeta.' });
  onProgress({ type: 'global', current: 0, total: files.length, folder: directory });
  for (let index = 0; index < files.length; index += 1) {
    if (controls.isCancelled()) throw cancelledError();
    const file = files[index];
    const input = path.join(directory, file);
    const finalPath = outputPath(directory, output, file);
    const extension = path.extname(finalPath);
    const temporary = `${finalPath.slice(0, -extension.length)}.part${extension}`;
    onProgress({
      type: 'file-start',
      file,
      current: index + 1,
      total: files.length,
      folder: directory,
    });
    if (!FFMPEG_PATTERN.test(file)) {
      await convertWithHandbrake(input, temporary, finalPath, codec, file, onProgress, controls);
      onProgress({ type: 'global', current: index + 1, total: files.length, folder: directory });
      continue;
    }
    let metadata = {};
    try {
      metadata = JSON.parse(
        await run('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=index,codec_type,height',
          '-of',
          'json',
          input,
        ]),
      );
    } catch {}
    const height = metadata.streams?.find((stream) => stream.codec_type === 'video')?.height || 0;
    const chosen = selections[input];
    const args = ['-y', '-i', input, '-map', '0:v:0'];
    if (chosen) {
      for (const track of chosen.audio || []) args.push('-map', `0:${track}`);
      for (const track of chosen.subtitles || []) args.push('-map', `0:${track}`);
    } else {
      args.push('-map', '0:a?');
      if (/\.mkv$/i.test(file)) args.push('-map', '0:s?');
    }
    if (height >= 480) args.push('-vf', 'scale=-2:480');
    args.push(
      '-c:v',
      codec === 'h265' ? 'libx265' : 'libx264',
      '-crf',
      '23',
      '-preset',
      'slow',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
    );
    if (/\.mkv$/i.test(file)) args.push('-c:s', 'copy');
    args.push(temporary);
    const duration = Number.parseFloat(metadata.format?.duration) || 0;
    await new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', args);
      controls.setProcess(process);
      let stderr = '';
      process.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        const match = chunk.match(/time=([\d:.]+)/);
        if (!match || !duration) return;
        const seconds = match[1]
          .split(':')
          .map(Number)
          .reduce((value, part) => value * 60 + part, 0);
        onProgress({
          type: 'file-progress',
          file,
          percent: Math.min(100, Math.floor((seconds / duration) * 100)),
        });
      });
      process.once('error', reject);
      process.once('close', (code) => {
        controls.setProcess(null);
        if (controls.isCancelled()) {
          fs.rmSync(temporary, { force: true });
          return reject(cancelledError());
        }
        if (code !== 0) {
          fs.rmSync(temporary, { force: true });
          return reject(new Error(stderr || `ffmpeg terminó con código ${code}`));
        }
        fs.renameSync(temporary, finalPath);
        onProgress({ type: 'file-done', file });
        resolve();
      });
    });
    onProgress({ type: 'global', current: index + 1, total: files.length, folder: directory });
  }
}

function convertWithHandbrake(input, temporary, finalPath, codec, file, onProgress, controls) {
  fs.rmSync(temporary, { force: true });
  return new Promise((resolve, reject) => {
    const job = handbrake.spawn({
      input,
      output: temporary,
      encoder: codec === 'h265' ? 'x265' : 'x264',
      'encoder-preset': 'slow',
      quality: 23,
      maxHeight: 480,
      'keep-display-aspect': true,
      'all-audio': true,
      aencoder: 'av_aac',
      ab: '128',
      optimize: true,
    });
    controls.setProcess(job);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      controls.setProcess(null);
      if (error || controls.isCancelled()) {
        fs.rmSync(temporary, { force: true });
        reject(error || cancelledError());
        return;
      }
      fs.renameSync(temporary, finalPath);
      onProgress({ type: 'file-done', file });
      resolve();
    };
    job.on('progress', (progress) =>
      onProgress({
        type: 'file-progress',
        file,
        percent: Math.floor(progress.percentComplete || 0),
      }),
    );
    job.once('error', finish);
    job.once('complete', () => finish());
    job.once('cancelled', () => finish(cancelledError()));
  });
}

module.exports = { inspectFolder, convertFolder };
