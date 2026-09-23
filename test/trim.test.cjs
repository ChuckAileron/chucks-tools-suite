const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installHooks, createFakeProcess } = require('./helpers/moduleHooks.cjs');

const state = { spawnCalls: [], execFileCalls: [] };
let ffprobeResult = '10.0';

function spawn(command, args) {
  const child = createFakeProcess();
  child.command = command;
  child.args = args;
  state.spawnCalls.push(child);
  return child;
}
function execFile(command, args, callback) {
  state.execFileCalls.push({ command, args });
  callback(null, String(ffprobeResult));
}
installHooks({
  'node:child_process': { execFile, spawn },
});
const { scanMedia, durationOf, trimMedia } = require('../electron/trim.cjs');

function reset() {
  state.spawnCalls.length = 0;
  state.execFileCalls.length = 0;
  ffprobeResult = '10.0';
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

async function trim(file, options = {}) {
  return trimMedia({
    input: file,
    type: options.type || 'audio',
    mode: options.mode || 'keep',
    start: options.start ?? 0,
    end: options.end ?? 5,
    duration: options.duration ?? 10,
    split: options.split ?? false,
    onProgress: options.onProgress || (() => {}),
    onProcess: options.onProcess || (() => {}),
    isCancelled: options.isCancelled || (() => false),
  });
}

test('scanMedia lista archivos con su duración y evita los ya recortados', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-scan-'));
  fs.writeFileSync(path.join(dir, 'a.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'a_trim.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'a_trim_part1.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'nota.txt'), 'x');
  ffprobeResult = '42.5';
  const files = await scanMedia([dir], 'audio');
  assert.deepEqual(files.map((f) => f.name), ['a.mp3']);
  assert.equal(files[0].duration, 42.5);
});

test('scanMedia ignora carpetas inexistentes y filtra por tipo', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-scan-video-'));
  fs.writeFileSync(path.join(dir, 'clip.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'song.mp3'), 'x');
  const videos = await scanMedia([dir], 'video');
  assert.deepEqual(videos.map((f) => f.name), ['clip.mp4']);
  const empty = await scanMedia([path.join(dir, 'no-existe')], 'audio');
  assert.deepEqual(empty, []);
});

test('durationOf devuelve 0 si ffprobe falla', async () => {
  reset();
  const original = execFile;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-duration-'));
  const file = path.join(dir, 'a.mp3');
  fs.writeFileSync(file, 'x');
  ffprobeResult = 'no-valido';
  const value = await durationOf(file);
  assert.equal(value, 0);
  void original;
});

test('trimMedia (keep) conserva solo el rango indicado', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-keep-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const progress = [];
  const promise = trim(file, { mode: 'keep', start: 2, end: 6, duration: 10, onProgress: (v) => progress.push(v) });
  const [cut] = await spawned(1);
  assert.equal(cut.args.includes('-ss'), true);
  assert.equal(cut.args[cut.args.indexOf('-ss') + 1], '2');
  assert.equal(cut.args[cut.args.indexOf('-t') + 1], '4');
  fs.writeFileSync(cut.args.at(-1), 'fake-media');
  emitData(cut, 'time=00:00:02.00');
  closeChild(cut, 0);
  const result = await promise;
  const expected = path.join(dir, 'trimmed_output-audio', 'pista_trim.mp3');
  assert.deepEqual(result.outputs, [expected]);
  assert.equal(fs.existsSync(expected), true);
  assert.equal(progress.includes(50), true);
});

test('trimMedia (remove) que toca el inicio conserva solo el tramo final', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-remove-start-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = trim(file, { mode: 'remove', start: 0, end: 3, duration: 10 });
  const [cut] = await spawned(1);
  assert.equal(cut.args[cut.args.indexOf('-ss') + 1], '3');
  assert.equal(cut.args[cut.args.indexOf('-t') + 1], '7');
  fs.writeFileSync(cut.args.at(-1), 'fake-media');
  closeChild(cut, 0);
  const result = await promise;
  assert.equal(result.outputs.length, 1);
});

test('trimMedia (remove) que toca el final conserva solo el tramo inicial', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-remove-end-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = trim(file, { mode: 'remove', start: 7, end: 10, duration: 10 });
  const [cut] = await spawned(1);
  assert.equal(cut.args.includes('-ss'), false);
  assert.equal(cut.args[cut.args.indexOf('-t') + 1], '7');
  fs.writeFileSync(cut.args.at(-1), 'fake-media');
  closeChild(cut, 0);
  const result = await promise;
  assert.equal(result.outputs.length, 1);
});

test('trimMedia (remove) rechaza cuando el tramo cubre todo el archivo', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-remove-all-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  await assert.rejects(trim(file, { mode: 'remove', start: 0, end: 10, duration: 10 }), /cubre todo/);
  assert.equal(state.spawnCalls.length, 0);
});

test('trimMedia rechaza un rango inválido', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-invalid-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  await assert.rejects(trim(file, { mode: 'keep', start: 6, end: 6, duration: 10 }), /rango de tiempo/);
});

test('trimMedia (remove) con tramo interior y split genera dos archivos', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-split-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = trim(file, { mode: 'remove', start: 3, end: 6, duration: 10, split: true });
  const [segA] = await spawned(1);
  assert.equal(segA.args.includes('-ss'), false);
  assert.equal(segA.args[segA.args.indexOf('-t') + 1], '3');
  fs.writeFileSync(segA.args.at(-1), 'fake-a');
  closeChild(segA, 0);
  const [, segB] = await spawned(2);
  assert.equal(segB.args[segB.args.indexOf('-ss') + 1], '6');
  assert.equal(segB.args[segB.args.indexOf('-t') + 1], '4');
  fs.writeFileSync(segB.args.at(-1), 'fake-b');
  closeChild(segB, 0);
  const result = await promise;
  assert.equal(result.outputs.length, 2);
  assert.equal(fs.existsSync(path.join(dir, 'trimmed_output-audio', 'pista_trim_part1.mp3')), true);
  assert.equal(fs.existsSync(path.join(dir, 'trimmed_output-audio', 'pista_trim_part2.mp3')), true);
});

test('trimMedia (remove) con tramo interior sin split une ambos segmentos', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-merge-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = trim(file, { mode: 'remove', start: 3, end: 6, duration: 10, split: false });
  const [segA] = await spawned(1);
  fs.writeFileSync(segA.args.at(-1), 'fake-a');
  closeChild(segA, 0);
  const [, segB] = await spawned(2);
  fs.writeFileSync(segB.args.at(-1), 'fake-b');
  closeChild(segB, 0);
  const [, , concat] = await spawned(3);
  assert.equal(concat.args.includes('-f'), true);
  assert.equal(concat.args.includes('concat'), true);
  fs.writeFileSync(concat.args.at(-1), 'fake-merged');
  closeChild(concat, 0);
  const result = await promise;
  const expected = path.join(dir, 'trimmed_output-audio', 'pista_trim.mp3');
  assert.deepEqual(result.outputs, [expected]);
  assert.equal(fs.existsSync(expected), true);
  // Los segmentos temporales no deben quedar en el directorio de salida.
  const remaining = fs.readdirSync(path.join(dir, 'trimmed_output-audio'));
  assert.deepEqual(remaining, ['pista_trim.mp3']);
});

test('trimMedia propaga la cancelación y limpia los temporales', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-cancel-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = trim(file, { mode: 'keep', start: 0, end: 5, duration: 10, isCancelled: () => true });
  const [cut] = await spawned(1);
  failChild(cut, new Error('boom'));
  await assert.rejects(promise, { code: 'CANCELLED' });
});

test('trimMedia falla limpiamente si ffmpeg termina con error', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-error-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const promise = trim(file, { mode: 'keep', start: 0, end: 5, duration: 10 });
  const [cut] = await spawned(1);
  emitData(cut, 'Error interno');
  closeChild(cut, 1);
  await assert.rejects(promise, /Error interno/);
  assert.equal(fs.existsSync(cut.args.at(-1)), false);
});

test('trimMedia rechaza si el resultado ya existe', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-exists-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  const outputDir = path.join(dir, 'trimmed_output-audio');
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(outputDir, 'pista_trim.mp3'), 'y');
  await assert.rejects(trim(file, { mode: 'keep', start: 0, end: 5, duration: 10 }), /ya existe/);
  assert.equal(state.spawnCalls.length, 0);
});

test('trimMedia rechaza si no se pudo determinar la duración', async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-noduration-'));
  const file = path.join(dir, 'pista.mp3');
  fs.writeFileSync(file, 'x');
  await assert.rejects(trim(file, { duration: 0 }), /duración/);
  assert.equal(state.spawnCalls.length, 0);
});
