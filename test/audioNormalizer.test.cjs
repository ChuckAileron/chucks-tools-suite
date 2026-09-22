const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installHooks, createFakeProcess } = require('./helpers/moduleHooks.cjs');

const state = { spawnCalls: [], execFileCalls: [] };
let ffprobeResult = '10.0';
let execFileFailure = null;

function spawn(command, args) {
  const child = createFakeProcess();
  child.command = command;
  child.args = args;
  state.spawnCalls.push(child);
  return child;
}
function execFile(command, args, callback) {
  state.execFileCalls.push({ command, args });
  if (execFileFailure) return callback(execFileFailure);
  callback(null, String(ffprobeResult));
}
installHooks({
  'node:child_process': { execFile, spawn },
});
const {
  scanMedia,
  normalizeMedia,
  measureLufs,
  LUFS_TOLERANCE,
  loudnessExcerpt,
  EXCERPT_DURATION,
  EXCERPT_MIN_SOURCE_DURATION,
} = require('../electron/audioNormalizer.cjs');

function reset() {
  state.spawnCalls.length = 0;
  state.execFileCalls.length = 0;
  ffprobeResult = '10.0';
  execFileFailure = null;
}

async function spawned(count) {
  while (state.spawnCalls.length < count) await new Promise((resolve) => setImmediate(resolve));
  return state.spawnCalls;
}
function emitData(child, text) {
  child.stderr.emit('data', Buffer.from(text));
}
function closeChild(child, code) {
  process.nextTick(() => child.emit('close', code));
}
function failChild(child, error) {
  process.nextTick(() => child.emit('error', error));
}

async function normalize(file, options = {}) {
  return normalizeMedia({
    input: file,
    type: options.type || 'audio',
    targetDb: options.targetDb ?? -14,
    knownLufs: options.knownLufs,
    onProgress: options.onProgress || (() => {}),
    onProcess: options.onProcess || (() => {}),
    isCancelled: options.isCancelled || (() => false),
  });
}

test('scanMedia marca procesado y evita archivos ya normalizados', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-audio-'));
  fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'b.wav'), 'x');
  fs.writeFileSync(path.join(dir, 'c.MP3'), 'x');
  fs.writeFileSync(path.join(dir, 'nota.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'already_normalized.mp3'), 'x');
  const normalizedDir = path.join(dir, 'normalized_output-audio');
  fs.mkdirSync(normalizedDir);
  fs.writeFileSync(path.join(normalizedDir, 'a_normalized.mp3'), 'y');
  const files = await scanMedia([dir], 'audio');
  assert.deepEqual(files.map((f) => f.name).sort(), ['a.mp3', 'b.wav', 'c.MP3']);
  assert.equal(files.find((f) => f.name === 'a.mp3').processed, true);
  assert.equal(files.find((f) => f.name === 'b.wav').processed, false);
});

test('scanMedia ignora carpetas inexistentes y filtra por tipo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-video-'));
  fs.writeFileSync(path.join(dir, 'clip.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'song.mp3'), 'x');
  const videos = await scanMedia([dir], 'video');
  assert.deepEqual(
    videos.map((f) => f.name),
    ['clip.mp4'],
  );
  assert.equal(videos[0].processed, false);
  const empty = await scanMedia([path.join(dir, 'no-existe')], 'audio');
  assert.deepEqual(empty, []);
});

test('normalizeMedia valida el objetivo LUFS antes de procesar', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-validate-'));
  const file = path.join(dir, 'a.mp3');
  fs.writeFileSync(file, 'x');
  await assert.rejects(normalize(file, { targetDb: -60 }), /entre -50 y -5/);
  await assert.rejects(normalize(file, { targetDb: 0 }), /entre -50 y -5/);
  await assert.rejects(normalize(file, { targetDb: 'nope' }), /entre -50 y -5/);
  assert.equal(state.spawnCalls.length, 0);
});

test('normalizeMedia rechaza cuando el resultado ya existe', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-exists-'));
  const file = path.join(dir, 'a.mp3');
  fs.writeFileSync(file, 'x');
  const outputDir = path.join(dir, 'normalized_output-audio');
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(outputDir, 'a_normalized.mp3'), 'y');
  await assert.rejects(normalize(file), /ya existe/);
});

test('normalizeMedia usa doble pasada y renombra el temporal al terminar', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-ok-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const progress = [];
  const processes = [];
  const promise = normalize(file, {
    onProgress: (v) => progress.push(v),
    onProcess: (p) => processes.push(p),
  });
  const [measure] = await spawned(1);
  assert.equal(measure.args.join(' ').includes('print_format=json'), true);
  emitData(
    measure,
    JSON.stringify({
      input_i: -16.4,
      input_tp: -1.2,
      input_lra: 7.5,
      input_thresh: -27.8,
    }),
  );
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  emitData(convert, 'frame=  100 fps=30 time=00:00:05.12 size=1kB');
  closeChild(convert, 0);
  const result = await promise;
  const expected = path.join(dir, 'normalized_output-audio', 'pista_normalized.mp3');
  assert.equal(result.skipped, false);
  assert.equal(result.output, expected);
  assert.equal(result.measuredLufs, -16.4);
  assert.equal(fs.existsSync(expected), true);
  assert.equal(progress.at(-1), 100);
  assert.equal(convert.args.join(' ').includes('measured_I=-16.40'), true);
  assert.equal(processes[0], measure);
  assert.equal(processes[2], convert);
  assert.equal(processes.at(-1), null);
});

test('normalizeMedia cae a una sola pasada si no se pudo medir', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-fallback-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, 'stderr sin JSON');
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
  const filter = convert.args.join(' ');
  assert.equal(filter.includes('measured_I='), false);
  assert.equal(filter.includes('loudnorm=I=-14'), true);
});

test('normalizeMedia falla limpiamente si ffmpeg de conversión sale con error', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-fail-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  emitData(convert, 'Error interno de ffmpeg');
  closeChild(convert, 1);
  await assert.rejects(promise, /Error interno de ffmpeg/);
  assert.equal(fs.existsSync(convert.args.at(-1)), false);
});

test('normalizeMedia propaga la cancelación durante la medición', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-cancel-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file, { isCancelled: () => true });
  const [measure] = await spawned(1);
  failChild(measure, new Error('boom'));
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('normalizeMedia propaga la cancelación durante la conversión', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-cancel2-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const cancelled = { value: false };
  const promise = normalize(file, { isCancelled: () => cancelled.value });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  cancelled.value = true;
  closeChild(convert, 0);
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('normalizeMedia sin duración no reporta progreso intermedio', async () => {
  reset();
  ffprobeResult = 'no-valid';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-nodur-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const progress = [];
  const promise = normalize(file, { onProgress: (v) => progress.push(v) });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  emitData(convert, 'time=00:00:03.00');
  closeChild(convert, 0);
  await promise;
  assert.deepEqual(progress, [100]);
});

test('normalizeMedia mantiene video y sus pistas al normalizar', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-video-'));
  const file = path.join(dir, 'clip.mp4');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file, { type: 'video' });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
  const args = convert.args;
  assert.equal(args.includes('0:v:0?'), true);
  assert.equal(args.includes('-c:v'), true);
  assert.equal(args.includes('copy'), true);
  const output = path.join(dir, 'normalized_output-video', 'clip_normalized.mp4');
  assert.equal(fs.existsSync(output), true);
});

test('normalizeMedia reporta progreso según el tiempo transcurrido', async () => {
  reset();
  ffprobeResult = '100.0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-progress-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const progress = [];
  const promise = normalize(file, { onProgress: (v) => progress.push(v) });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  emitData(convert, 'time=00:00:50.00');
  emitData(convert, 'time=00:01:20.00');
  closeChild(convert, 0);
  await promise;
  assert.equal(progress.includes(50), true);
  assert.equal(progress.includes(80), true);
});

test('normalizeMedia lee la medición que llega por stdout', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-stdout-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  measure.stdout.emit('data', Buffer.from(JSON.stringify({ input_i: -30 })));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
  const filter = convert.args.join(' ');
  assert.equal(filter.includes('measured_I=-30.00'), true);
});

test('normalizeMedia rechaza si no se pudo renombrar el temporal', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-rename-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  closeChild(convert, 0);
  await assert.rejects(promise, /ENOENT/);
  const output = path.join(dir, 'normalized_output-audio', 'pista_normalized.mp3');
  assert.equal(fs.existsSync(output), false);
});

test('normalizeMedia no reporta progreso intermedio si ffprobe falla', async () => {
  reset();
  execFileFailure = new Error('ffprobe no está disponible');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-falldur-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const progress = [];
  const promise = normalize(file, { onProgress: (v) => progress.push(v) });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  emitData(convert, 'time=00:00:03.00');
  closeChild(convert, 0);
  await promise;
  assert.deepEqual(progress, [100]);
});

test('normalizeMedia continúa en una sola pasada si la medición no arranca', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-nostart-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  failChild(measure, new Error('ffmpeg no se pudo ejecutar'));
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
  const filter = convert.args.join(' ');
  assert.equal(filter.includes('measured_I='), false);
});

test('normalizeMedia propaga la cancelación si la medición cierra al cancelar', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-cancelclose-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file, { isCancelled: () => true });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('normalizeMedia cae a una sola pasada si la medición sale con error', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-measerr-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, 'sin datos utiles');
  closeChild(measure, 1);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
  assert.equal(convert.args.join(' ').includes('measured_I='), false);
});

test('normalizeMedia informa valores 0.00 si la medición no trae input_i', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-noi-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_tp: -1.2, input_lra: 7.5, input_thresh: -27.8 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
  const filter = convert.args.join(' ');
  assert.equal(filter.includes('measured_I=0.00'), true);
  assert.equal(filter.includes('measured_TP=-1.20'), true);
});

test('normalizeMedia ignora el cierre posterior a un error de conversión', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-lose-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  failChild(convert, new Error('spawn falló'));
  closeChild(convert, 0);
  await assert.rejects(promise, /spawn falló/);
  assert.equal(fs.existsSync(convert.args.at(-1)), false);
});

test('normalizeMedia usa el código de salida si ffmpeg no emite stderr', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-nostderr-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file);
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 1);
  await assert.rejects(promise, /FFmpeg terminó con código 1/);
});

test('normalizeMedia propaga la cancelación si la conversión no arranca', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-cancelerr-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const cancelled = { value: false };
  const promise = normalize(file, { isCancelled: () => cancelled.value });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  cancelled.value = true;
  failChild(convert, new Error('boom'));
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('normalizeMedia omite el procesamiento si el LUFS conocido ya está en el objetivo', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-known-skip-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const result = await normalize(file, { targetDb: -16, knownLufs: -16.4 });
  assert.deepEqual(result, { skipped: true, measuredLufs: -16.4, output: null });
  // No debe spawnear ningún proceso: ni de medición ni de conversión.
  assert.equal(state.spawnCalls.length, 0);
});

test('normalizeMedia procesa normalmente si el LUFS conocido está fuera de la tolerancia', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-known-noskip-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file, { targetDb: -16, knownLufs: -16.4 - LUFS_TOLERANCE - 0.1 });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  const result = await promise;
  assert.equal(result.skipped, false);
  assert.equal(fs.existsSync(result.output), true);
});

test('normalizeMedia omite el procesamiento tras medir si el resultado cae en la tolerancia', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-measure-skip-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file, { targetDb: -16 });
  const [measure] = await spawned(1);
  emitData(measure, JSON.stringify({ input_i: -16.5 }));
  closeChild(measure, 0);
  const result = await promise;
  assert.deepEqual(result, { skipped: true, measuredLufs: -16.5, output: null });
  // Nunca debe arrancar el segundo proceso (la conversión con ffmpeg).
  assert.equal(state.spawnCalls.length, 1);
});

test('normalizeMedia respeta el límite exacto de tolerancia (frontera inclusive)', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-tolerance-edge-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const result = await normalize(file, {
    targetDb: -16,
    knownLufs: -16 - LUFS_TOLERANCE,
  });
  assert.equal(result.skipped, true);
});

test('measureLufs devuelve el LUFS integrado sin convertir el archivo', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-measure-only-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = measureLufs(file);
  const [measure] = await spawned(1);
  assert.equal(measure.args.join(' ').includes('print_format=json'), true);
  emitData(
    measure,
    JSON.stringify({ input_i: -18.3, input_tp: -1, input_lra: 5, input_thresh: -28 }),
  );
  closeChild(measure, 0);
  const lufs = await promise;
  assert.equal(lufs, -18.3);
  assert.equal(state.spawnCalls.length, 1);
});

// --- Análisis de LUFS sobre un extracto (archivos largos) ------------------

test('loudnessExcerpt no recorta archivos cortos ni de duración desconocida', () => {
  assert.equal(loudnessExcerpt(0), null);
  assert.equal(loudnessExcerpt(NaN), null);
  assert.equal(loudnessExcerpt(EXCERPT_MIN_SOURCE_DURATION), null);
  assert.equal(loudnessExcerpt(10), null);
});

test('loudnessExcerpt recorta un extracto tras el 10% inicial en archivos largos', () => {
  const excerpt = loudnessExcerpt(200);
  assert.ok(excerpt);
  assert.equal(excerpt.start, 20); // 10% de 200s
  assert.equal(excerpt.duration, EXCERPT_DURATION);
});

test('loudnessExcerpt limita el inicio a 60s y el extracto a lo que quede del archivo', () => {
  const long = loudnessExcerpt(10000);
  assert.equal(long.start, 60); // 10% excedería 60s, se limita
  assert.equal(long.duration, EXCERPT_DURATION);

  const short = loudnessExcerpt(50); // apenas por encima del umbral mínimo
  assert.equal(short.start, 5); // 10% de 50s
  assert.equal(short.duration, EXCERPT_DURATION); // 45s restantes, recortado a 30s
});

test('measureLufs analiza solo un extracto cuando el archivo es largo', async () => {
  reset();
  ffprobeResult = '300.0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-measure-excerpt-'));
  const file = path.join(dir, 'pelicula.mp3');
  fs.writeFileSync(file, 'x');
  const promise = measureLufs(file);
  const [measure] = await spawned(1);
  assert.equal(measure.args.includes('-ss'), true);
  assert.equal(measure.args[measure.args.indexOf('-ss') + 1], '30'); // 10% de 300s
  assert.equal(measure.args.includes('-t'), true);
  assert.equal(measure.args[measure.args.indexOf('-t') + 1], String(EXCERPT_DURATION));
  emitData(measure, JSON.stringify({ input_i: -20 }));
  closeChild(measure, 0);
  await promise;
});

test('measureLufs analiza el archivo completo cuando es corto', async () => {
  reset();
  ffprobeResult = '20.0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-measure-full-'));
  const file = path.join(dir, 'nota.mp3');
  fs.writeFileSync(file, 'x');
  const promise = measureLufs(file);
  const [measure] = await spawned(1);
  assert.equal(measure.args.includes('-ss'), false);
  assert.equal(measure.args.includes('-t'), false);
  emitData(measure, JSON.stringify({ input_i: -20 }));
  closeChild(measure, 0);
  await promise;
});

test('normalizeMedia sigue midiendo el archivo completo antes de convertir', async () => {
  reset();
  ffprobeResult = '300.0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-full-encode-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = normalize(file, { targetDb: -14 });
  const [measure] = await spawned(1);
  // La pasada de medición previa a la codificación final no debe recortarse:
  // la corrección aplicada a todo el archivo depende de esta medición.
  assert.equal(measure.args.includes('-ss'), false);
  assert.equal(measure.args.includes('-t'), false);
  emitData(measure, JSON.stringify({ input_i: -30 }));
  closeChild(measure, 0);
  const [, convert] = await spawned(2);
  fs.writeFileSync(convert.args.at(-1), 'fake-media');
  closeChild(convert, 0);
  await promise;
});
