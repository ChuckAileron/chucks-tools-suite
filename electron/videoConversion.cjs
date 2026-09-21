const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const candidates = [
  path.join(
    process.resourcesPath || '',
    'app.asar.unpacked',
    'node_modules',
    'handbrake-js',
    'bin',
    'HandbrakeCLI.exe',
  ),
  path.join(__dirname, '..', 'node_modules', 'handbrake-js', 'bin', 'HandbrakeCLI.exe'),
];
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    process.env.HANDBRAKECLI_PATH = candidate;
    break;
  }
}
const handbrake = require('handbrake-js');

const VIDEO_PATTERN =
  /\.(mp4|m4v|mov|avi|mkv|webm|wmv|flv|mpg|mpeg|ts|mts|m2ts|vob|ogv|3gp|3g2|asf)$/i;
const FFMPEG_PATTERN = /\.(mp4|mov|avi|mkv|webm)$/i;
const MP4_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const videoFiles = (directory) =>
  fs
    .readdirSync(directory)
    .filter((file) => VIDEO_PATTERN.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
const outputPath = (directory, output, file) => {
  const sourceExtension = path.extname(file);
  return path.join(output, `${path.basename(file, sourceExtension)}_SD.mp4`);
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

async function convertFolder(directory, codec, selections, onProgress, controls, audio = null) {
  const output = path.join(directory, `sd-output-${codec}`);
  fs.mkdirSync(output, { recursive: true });
  const normalizeAudio = audio?.normalize
    ? `loudnorm=I=${audio.targetDb ?? -16}:TP=-1.5:LRA=11`
    : null;
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
    if (!FFMPEG_PATTERN.test(file) && !normalizeAudio) {
      await convertWithHandbrake(
        input,
        temporary,
        finalPath,
        codec,
        file,
        directory,
        onProgress,
        controls,
      );
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
          'format=duration:stream=index,codec_type,codec_name,height',
          '-of',
          'json',
          input,
        ]),
      );
    } catch {}
    const height = metadata.streams?.find((stream) => stream.codec_type === 'video')?.height || 0;
    const chosen = selections[input];
    const audioStreams = (metadata.streams || []).filter((stream) => stream.codec_type === 'audio');
    let audioIndices;
    let subtitleIndices;
    if (chosen) {
      const picked = chosen.audio || [];
      // La selección pudo quedar obsoleta (el archivo fue reemplazado o los
      // índices se inspeccionaron antes de un cambio) y apuntar a streams que
      // ya no existen o no son de audio. Mapear "0:N" sin validar hace que
      // ffmpeg falle o que el resultado salga sin pista de audio. Si ninguno
      // de los elegidos existe en el archivo real y este sí tiene audio, se
      // usan los streams reales en lugar de producir un video mudo.
      const valid = audioStreams.length
        ? picked.filter((track) => audioStreams.some((stream) => stream.index === track))
        : picked;
      audioIndices =
        picked.length && audioStreams.length && !valid.length
          ? audioStreams.map((stream) => stream.index)
          : valid;
      subtitleIndices = (chosen.subtitles || []).filter((track) => {
        const stream = metadata.streams?.find((item) => item.index === track);
        return stream && MP4_SUBTITLE_CODECS.has(stream.codec_name);
      });
    } else {
      audioIndices = audioStreams.map((stream) => stream.index);
      subtitleIndices = (metadata.streams || [])
        .filter(
          (stream) =>
            stream.codec_type === 'subtitle' && MP4_SUBTITLE_CODECS.has(stream.codec_name),
        )
        .map((stream) => stream.index);
    }
    const args = ['-y', '-i', input, '-map', '0:v:0'];
    if (normalizeAudio && audioIndices.length) {
      // Un filtro simple (-af) solo puede aplicarse a un único stream de audio de
      // salida. Si se mapea más de una pista con -af, ffmpeg falla o deja las
      // pistas adicionales sin filtrar/mudas. Usamos -filter_complex con una
      // etiqueta por pista para normalizar cada una de forma independiente.
      const filterComplex = audioIndices
        .map((track, i) => `[0:${track}]${normalizeAudio}[a${i}]`)
        .join(';');
      args.push('-filter_complex', filterComplex);
      audioIndices.forEach((_, i) => args.push('-map', `[a${i}]`));
    } else {
      for (const track of audioIndices) args.push('-map', `0:${track}`);
    }
    for (const track of subtitleIndices) args.push('-map', `0:${track}`);
    const subtitleCount = subtitleIndices.length;
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
    if (subtitleCount) args.push('-c:s', 'mov_text');
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
        onProgress({ type: 'file-done', file, folder: directory });
        resolve();
      });
    });
    onProgress({ type: 'global', current: index + 1, total: files.length, folder: directory });
  }
}

function convertWithHandbrake(
  input,
  temporary,
  finalPath,
  codec,
  file,
  directory,
  onProgress,
  controls,
) {
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
      onProgress({ type: 'file-done', file, folder: directory });
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
