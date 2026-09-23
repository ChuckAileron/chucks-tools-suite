const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { installHooks } = require('./helpers/moduleHooks.cjs');

const state = { children: [], execFileCalls: [], jobs: [] };
let execFileHandler = null;

function spawn(command, args) {
  const child = new EventEmitter();
  child.stdout = {};
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.command = command;
  child.args = args;
  child.temporary = args.at(-1);
  state.children.push(child);
  return child;
}
function execFile(command, args, callback) {
  state.execFileCalls.push({ command, args });
  if (!execFileHandler) return callback(new Error('sin handler'));
  execFileHandler(command, args, callback);
}
const handbrakeFake = {
  spawn: (options) => {
    const job = new EventEmitter();
    job.options = options;
    state.jobs.push(job);
    const dir = path.dirname(options.output);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(options.output, 'data');
    return job;
  },
};
installHooks({
  'handbrake-js': handbrakeFake,
  'node:child_process': { execFile, spawn },
});
const { inspectFolder, convertFolder } = require('../electron/videoConversion.cjs');

function reset() {
  state.children.length = 0;
  state.execFileCalls.length = 0;
  state.jobs.length = 0;
  execFileHandler = null;
}

function closeChild(child, code) {
  process.nextTick(() => child.emit('close', code));
}

async function waitChildren(count) {
  while (state.children.length < count) await new Promise((resolve) => setImmediate(resolve));
  return state.children;
}

function makeControls() {
  const controls = {
    cancelled: false,
    isCancelled: () => controls.cancelled,
    setProcess: () => {},
  };
  return controls;
}

function metadataBody({ duration = 10, height = 1080, audio = 2, subtitle = 1 } = {}) {
  const streams = [{ index: 0, codec_type: 'video', codec_name: 'h264', height }];
  for (let i = 0; i < audio; i += 1)
    streams.push({ index: 1 + i, codec_type: 'audio', codec_name: 'aac' });
  if (subtitle)
    streams.push({ index: streams.length, codec_type: 'subtitle', codec_name: 'subrip' });
  return { format: { duration }, streams };
}

const silentProgress = () => {};

test('inspectFolder describe videos y prueba los mkv con ffprobe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-inspect-'));
  fs.writeFileSync(path.join(dir, 'capitulo.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'bonus.mkv'), 'x');
  const streams = [
    { index: 0, codec_type: 'video', codec_name: 'h264', disposition: { default: 1 } },
    {
      index: 1,
      codec_type: 'audio',
      codec_name: 'aac',
      tags: { language: 'spa' },
      disposition: { default: 1 },
    },
    { index: 2, codec_type: 'audio', codec_name: 'eac3', tags: {}, disposition: { default: 0 } },
    {
      index: 3,
      codec_type: 'subtitle',
      codec_name: 'subrip',
      tags: { title: 'Forzados' },
      disposition: { default: 0 },
    },
  ];
  reset();
  execFileHandler = (command, args, callback) => {
    assert.equal(command, 'ffprobe');
    assert.ok(args.includes(path.join(dir, 'bonus.mkv')));
    callback(null, JSON.stringify({ streams }), '');
  };
  const info = await inspectFolder(dir, 'h264');
  // solo el mkv se inspecciona con ffprobe
  assert.equal(state.execFileCalls.length, 1);
  assert.equal(info.videos.length, 2);
  const mkv = info.videos.find((v) => v.file === 'bonus.mkv');
  assert.equal(mkv.audio.length, 2);
  assert.equal(mkv.audio[0].language, 'spa');
  assert.equal(mkv.audio[0].default, true);
  assert.equal(mkv.subtitles[0].title, 'Forzados');
  assert.equal(mkv.processed, false);
  const mp4 = info.videos.find((v) => v.file === 'capitulo.mp4');
  assert.equal(mp4.audio.length, 0);
  assert.equal(mp4.subtitles.length, 0);
  assert.equal(info.processed, false);
});

test('inspectFolder marca procesados según los archivos SD existentes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-proc-'));
  fs.writeFileSync(path.join(dir, 'a.mkv'), 'x');
  fs.writeFileSync(path.join(dir, 'b.mp4'), 'x');
  reset();
  const info = await inspectFolder(dir, 'h264');
  assert.equal(info.processed, false);
  const output = path.join(dir, 'sd-output-h264');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'a_SD.mp4'), 'x');
  fs.writeFileSync(path.join(output, 'b_SD.mp4'), 'x');
  const done = await inspectFolder(dir, 'h264');
  assert.equal(done.processed, true);
});

test('inspectFolder captura el error de ffprobe en probeError', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-probeerr-'));
  fs.writeFileSync(path.join(dir, 'roto.mkv'), 'x');
  reset();
  execFileHandler = (command, args, callback) => callback(new Error('ffprobe salió 1'));
  const info = await inspectFolder(dir, 'h264');
  assert.equal(info.videos[0].probeError, 'ffprobe salió 1');
});

test('convertFolder avisa cuando no hay videos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-empty-'));
  const messages = [];
  reset();
  await convertFolder(dir, 'h264', {}, (p) => messages.push(p), makeControls());
  assert.equal(
    messages.some((m) => m.type === 'info' && /No hay videos/.test(m.message)),
    true,
  );
});

test('convertFolder se cancela antes de procesar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cancel-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  const controls = makeControls();
  controls.cancelled = true;
  reset();
  await assert.rejects(convertFolder(dir, 'h264', {}, silentProgress, controls), {
    code: 'CANCELLED',
  });
});

test('convertFolder cancela y limpia el temporal durante ffmpeg', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cancelmid-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  const controls = makeControls();
  reset();
  execFileHandler = (command, args, callback) => callback(null, JSON.stringify(metadataBody()), '');
  const promise = convertFolder(dir, 'h264', {}, silentProgress, controls);
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  controls.cancelled = true;
  closeChild(child, 0);
  await assert.rejects(promise, { code: 'CANCELLED' });
  assert.equal(fs.existsSync(child.temporary), false);
});

test('convertFolder convierte con ffmpeg y respeta selecciones de pistas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-ffmpeg-'));
  fs.writeFileSync(path.join(dir, 'show.mp4'), 'x');
  const metadata = metadataBody({ duration: 10, height: 1080, audio: 2, subtitle: 1 });
  metadata.streams.push({ index: 9, codec_type: 'subtitle', codec_name: 'dvd_subtitle' });
  const selections = {
    [path.join(dir, 'show.mp4')]: { audio: [2], subtitles: [3, 9] },
  };
  const events = [];
  reset();
  execFileHandler = (command, args, callback) => {
    callback(null, JSON.stringify(metadata), '');
  };
  const promise = convertFolder(dir, 'h264', selections, (p) => events.push(p), makeControls());
  const [child] = await waitChildren(1);
  assert.equal(child.command, 'ffmpeg');
  fs.writeFileSync(child.temporary, 'data');
  child.stderr.emit('data', Buffer.from('frame= 45 fps= 30 time=00:00:05.00'));
  closeChild(child, 0);
  await promise;
  const args = child.args;
  assert.ok(args.includes('-map'));
  assert.ok(args.includes('0:2'), 'la pista de audio elegida se mapea');
  assert.equal(args.includes('0:1'), false);
  assert.ok(args.includes('0:3'), 'el subtítulo subrip compatible se mapea');
  assert.equal(args.includes('0:9'), false, 'la pista de subtítulos incompatible se descarta');
  assert.ok(args.includes('-vf'));
  assert.ok(args.includes('scale=-2:480'));
  assert.ok(args.includes('-c:v') && args.includes('libx264'));
  assert.ok(args.includes('-c:s') && args.includes('mov_text'));
  const output = path.join(dir, 'sd-output-h264', 'show_SD.mp4');
  assert.equal(fs.existsSync(output), true);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('file-start'));
  assert.ok(events.some((e) => e.type === 'file-progress' && e.percent === 50));
  assert.ok(types.includes('file-done'));
});

test('convertFolder normaliza el audio con filter_complex y h265 sin escalar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-normalize-'));
  fs.writeFileSync(path.join(dir, 'pelicula.mp4'), 'x');
  const metadata = metadataBody({ duration: 30, height: 360, audio: 2, subtitle: 0 });
  const audio = { normalize: true, targetDb: -11 };
  reset();
  execFileHandler = (command, args, callback) => callback(null, JSON.stringify(metadata), '');
  const promise = convertFolder(dir, 'h265', {}, silentProgress, makeControls(), audio);
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  const args = child.args;
  assert.ok(args.includes('-filter_complex'));
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[0:1\]loudnorm=I=-11:TP=-1\.5:LRA=11\[a0\]/);
  assert.match(filter, /\[0:2\]loudnorm=I=-11:TP=-1\.5:LRA=11\[a1\]/);
  assert.ok(args.includes('[a0]'));
  assert.ok(args.includes('[a1]'));
  assert.ok(args.includes('libx265'));
  assert.equal(args.includes('-vf'), false);
});

test('convertFolder usa -16 LUFS por defecto al normalizar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-defaultlufs-'));
  fs.writeFileSync(path.join(dir, 'clip.mp4'), 'x');
  const metadata = metadataBody({ duration: 10, height: 480, audio: 1, subtitle: 0 });
  reset();
  execFileHandler = (command, args, callback) => callback(null, JSON.stringify(metadata), '');
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls(), {
    normalize: true,
  });
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  const filter = child.args.join(' ');
  assert.ok(filter.includes('loudnorm=I=-16'));
});

test('convertFolder falla cuando ffmpeg termina con error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-fferr-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  reset();
  execFileHandler = (command, args, callback) => callback(null, JSON.stringify(metadataBody()), '');
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  child.stderr.emit('data', Buffer.from('Decoder error'));
  closeChild(child, 1);
  await assert.rejects(promise, /Decoder error/);
  assert.equal(fs.existsSync(child.temporary), false);
});

test('convertFolder usa handbrake para formatos sin FFmpeg y sin normalizar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hb-'));
  fs.writeFileSync(path.join(dir, 'viejita.wmv'), 'x');
  const events = [];
  reset();
  const promise = convertFolder(dir, 'h264', {}, (p) => events.push(p), makeControls());
  assert.equal(state.jobs.length, 1);
  const job = state.jobs[0];
  assert.equal(job.options.encoder, 'x264');
  job.emit('progress', { percentComplete: 42 });
  job.emit('complete');
  await promise;
  const output = path.join(dir, 'sd-output-h264', 'viejita_SD.mp4');
  assert.equal(fs.existsSync(output), true);
  assert.ok(events.some((e) => e.type === 'file-progress' && e.percent === 42));
  assert.ok(events.some((e) => e.type === 'file-done'));
});

test('convertFolder usa x265 con handbrake cuando se pide h265', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hb265-'));
  fs.writeFileSync(path.join(dir, 'viejita.wmv'), 'x');
  reset();
  const promise = convertFolder(dir, 'h265', {}, silentProgress, makeControls());
  assert.equal(state.jobs[0].options.encoder, 'x265');
  state.jobs[0].emit('complete');
  await promise;
});

test('convertFolder propaga el error de handbrake y limpia el temporal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hberr-'));
  fs.writeFileSync(path.join(dir, 'viejita.wmv'), 'x');
  reset();
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls());
  const job = state.jobs[0];
  fs.writeFileSync(job.options.output, 'parcial');
  job.emit('error', new Error('no codec'));
  await assert.rejects(promise, /no codec/);
  assert.equal(fs.existsSync(job.options.output), false);
});

test('convertFolder propaga la cancelación de handbrake', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hbcancel-'));
  fs.writeFileSync(path.join(dir, 'viejita.wmv'), 'x');
  reset();
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls());
  state.jobs[0].emit('cancelled');
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('convertFolder procesa varios archivos y avanza el contador global', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-multi-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'b.mp4'), 'x');
  const events = [];
  reset();
  execFileHandler = (command, args, callback) =>
    callback(
      null,
      JSON.stringify(metadataBody({ duration: 5, height: 720, audio: 1, subtitle: 0 })),
      '',
    );
  const promise = convertFolder(dir, 'h264', {}, (p) => events.push(p), makeControls());
  const [first] = await waitChildren(1);
  fs.writeFileSync(first.temporary, 'data');
  closeChild(first, 0);
  const [second] = (await waitChildren(2)).slice(-1);
  fs.writeFileSync(second.temporary, 'data');
  closeChild(second, 0);
  await promise;
  const globals = events.filter((e) => e.type === 'global');
  assert.deepEqual(
    globals.map((e) => e.current),
    [0, 1, 2],
  );
  assert.equal(fs.existsSync(path.join(dir, 'sd-output-h264', 'a_SD.mp4')), true);
  assert.equal(fs.existsSync(path.join(dir, 'sd-output-h264', 'b_SD.mp4')), true);
});

test('inspectFolder tolera mkv sin streams y con codec desconocido', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-mkvthin-'));
  fs.writeFileSync(path.join(dir, 'con.mkv'), 'x');
  fs.writeFileSync(path.join(dir, 'sin.mkv'), 'x');
  reset();
  execFileHandler = (command, args, callback) => {
    const target = args.at(-1);
    if (target.endsWith('sin.mkv')) return callback(null, JSON.stringify({}), '');
    callback(null, JSON.stringify({ streams: [{ index: 0, codec_type: 'audio', tags: {} }] }), '');
  };
  const info = await inspectFolder(dir, 'h264');
  const con = info.videos.find((v) => v.file === 'con.mkv');
  const sin = info.videos.find((v) => v.file === 'sin.mkv');
  assert.equal(con.audio.length, 1);
  assert.equal(con.audio[0].codec, 'desconocido');
  assert.equal(con.audio[0].language, 'sin idioma');
  assert.equal(con.audio[0].title, '');
  assert.equal(con.audio[0].default, false);
  assert.equal(sin.audio.length, 0);
  assert.equal(sin.subtitles.length, 0);
});

test('inspectFolder responde con carpeta vacía sin marcar procesamiento', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-none-'));
  reset();
  const info = await inspectFolder(dir, 'h264');
  assert.equal(info.videos.length, 0);
  assert.equal(info.processed, false);
});

test('convertFolder continúa sin escalar si ffprobe falla', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-ffprobefail-'));
  fs.writeFileSync(path.join(dir, 'corto.mp4'), 'x');
  const events = [];
  reset();
  execFileHandler = (command, args, callback) => callback(new Error('ffprobe salió 1'));
  const promise = convertFolder(dir, 'h264', {}, (p) => events.push(p), makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  child.stderr.emit('data', Buffer.from('frame= 1 fps time=00:00:01.00'));
  closeChild(child, 0);
  await promise;
  assert.equal(child.args.includes('-vf'), false);
  assert.equal(
    events.some((e) => e.type === 'file-progress'),
    false,
    'sin duración no hay progreso',
  );
  assert.ok(events.some((e) => e.type === 'file-done'));
});

test('convertFolder usa la pista predeterminada si la selección quedó vacía', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-selnone-'));
  fs.writeFileSync(path.join(dir, 'show.mp4'), 'x');
  const selections = { [path.join(dir, 'show.mp4')]: {} };
  reset();
  execFileHandler = (command, args, callback) =>
    callback(null, JSON.stringify(metadataBody({ audio: 2, subtitle: 1 })), '');
  const promise = convertFolder(dir, 'h264', selections, silentProgress, makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  assert.ok(child.args.includes('0:v:0'));
  assert.ok(child.args.includes('0:1'), 'se usa el primer audio como predeterminado');
  assert.equal(child.args.includes('0:2'), false, 'no se duplica el segundo audio');
  assert.ok(child.args.includes('0:3'), 'se usa el subtítulo predeterminado');
});

test('convertFolder usa la pista marcada como predeterminada en la selección vacía', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-seldef-'));
  fs.writeFileSync(path.join(dir, 'show.mkv'), 'x');
  const source = {
    format: { duration: 10 },
    streams: [
      { index: 0, codec_type: 'video', codec_name: 'h264', height: 1080 },
      { index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { default: 0 } },
      { index: 2, codec_type: 'audio', codec_name: 'eac3', disposition: { default: 1 } },
      { index: 3, codec_type: 'subtitle', codec_name: 'subrip', disposition: { default: 0 } },
    ],
  };
  const selections = { [path.join(dir, 'show.mkv')]: { audio: [], subtitles: [] } };
  reset();
  execFileHandler = (command, args, callback) => callback(null, JSON.stringify(source), '');
  const promise = convertFolder(dir, 'h264', selections, silentProgress, makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  const args = child.args;
  assert.ok(args.includes('0:v:0'));
  assert.equal(args.includes('0:1'), false, 'no se usa la pista sin disposition.default');
  assert.ok(args.includes('0:2'), 'se usa la pista predeterminada real del archivo');
  assert.ok(args.includes('0:3'), 'subtítulo: sin default marcado, se usa la primera');
});

test('convertFolder no mutea si la selección de audio quedó obsoleta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-stalea-'));
  fs.writeFileSync(path.join(dir, 'show.mkv'), 'x');
  // El índice elegido ya no existe en el archivo actual (p. ej. el archivo fue
  // reemplazado tras inspeccionarse): se deben mapear los audio reales.
  const selections = { [path.join(dir, 'show.mkv')]: { audio: [7], subtitles: [] } };
  reset();
  execFileHandler = (command, args, callback) =>
    callback(null, JSON.stringify(metadataBody({ audio: 2, subtitle: 0 })), '');
  const promise = convertFolder(dir, 'h264', selections, silentProgress, makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  const args = child.args;
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('0:1'), 'se mapea el primer audio real del archivo');
  assert.ok(args.includes('0:2'), 'se mapea el segundo audio real del archivo');
  assert.equal(args.includes('0:7'), false);
});

test('convertFolder conserva los índices de audio válidos y descarta los obsoletos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-staleb-'));
  fs.writeFileSync(path.join(dir, 'show.mkv'), 'x');
  const selections = { [path.join(dir, 'show.mkv')]: { audio: [1, 99], subtitles: [] } };
  reset();
  execFileHandler = (command, args, callback) =>
    callback(null, JSON.stringify(metadataBody({ audio: 2, subtitle: 0 })), '');
  const promise = convertFolder(dir, 'h264', selections, silentProgress, makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  const args = child.args;
  assert.ok(args.includes('0:1'));
  assert.equal(args.includes('0:99'), false);
  assert.equal(args.includes('0:2'), false);
});

test('convertFolder describe el fallo de ffmpeg sin stderr', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-noerr-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
  reset();
  execFileHandler = (command, args, callback) => callback(null, JSON.stringify(metadataBody()), '');
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls());
  const [child] = await waitChildren(1);
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 1);
  await assert.rejects(promise, /ffmpeg terminó con código 1/);
});

test('convertFolder ignora eventos de handbrake tras el primero', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hbdouble-'));
  fs.writeFileSync(path.join(dir, 'v.wmv'), 'x');
  reset();
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls());
  const job = state.jobs[0];
  fs.writeFileSync(job.options.output, 'data');
  job.emit('error', new Error('transcode'));
  await assert.rejects(promise, /transcode/);
  job.emit('complete');
  assert.equal(fs.existsSync(job.options.output), false);
});

test('convertFolder rechaza handbrake cancelado que llega a completar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hbcancelled2-'));
  fs.writeFileSync(path.join(dir, 'v.wmv'), 'x');
  const controls = makeControls();
  reset();
  const promise = convertFolder(dir, 'h264', {}, silentProgress, controls);
  const job = state.jobs[0];
  fs.writeFileSync(job.options.output, 'data');
  controls.cancelled = true;
  job.emit('complete');
  await assert.rejects(promise, { code: 'CANCELLED' });
  assert.equal(fs.existsSync(job.options.output), false);
});

test('convertFolder reporta 0% si handbrake no da percentComplete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hbzero-'));
  fs.writeFileSync(path.join(dir, 'v.wmv'), 'x');
  const events = [];
  reset();
  const promise = convertFolder(dir, 'h264', {}, (e) => events.push(e), makeControls());
  const job = state.jobs[0];
  job.emit('progress', {});
  job.emit('complete');
  await promise;
  const progress = events.find((e) => e.type === 'file-progress');
  assert.equal(progress.percent, 0);
});

test('convertFolder normaliza con ffmpeg si se pide audio aunque el formato no sea FFMPEG', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-normwmv-'));
  fs.writeFileSync(path.join(dir, 'v.wmv'), 'x');
  reset();
  execFileHandler = (command, args, callback) =>
    callback(
      null,
      JSON.stringify(metadataBody({ duration: 6, height: 480, audio: 2, subtitle: 0 })),
      '',
    );
  const promise = convertFolder(dir, 'h264', {}, silentProgress, makeControls(), {
    normalize: true,
    targetDb: -10,
  });
  const [child] = await waitChildren(1);
  assert.equal(child.command, 'ffmpeg');
  fs.writeFileSync(child.temporary, 'data');
  closeChild(child, 0);
  await promise;
  const filter = child.args.join(' ');
  assert.ok(filter.includes('loudnorm=I=-10'));
});
