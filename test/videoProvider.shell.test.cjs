const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { installHooks } = require('./helpers/moduleHooks.cjs');

const realFs = require('node:fs');

const state = { children: [], execFileCalls: [], ytDlpHidden: false, failUpdateSpawn: false };
function spawn(command, args, options) {
  if (state.failUpdateSpawn && args[0] === '-U') throw new Error('spawn falló');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    child.killedSignal = signal;
  };
  child.command = command;
  child.args = args;
  child.options = options;
  child.pid = 777;
  state.children.push(child);
  return child;
}
function execFile(command, args, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options;
  state.execFileCalls.push({ command, args, options: opts });
  if (state.taskkillHandler) state.taskkillHandler(command, args);
  return cb && cb();
}
installHooks({
  'node:child_process': { execFile, spawn },
  'node:fs': {
    ...realFs,
    existsSync: (target) => {
      if (state.ytDlpHidden && String(target).toLowerCase().includes('yt-dlp')) return false;
      return realFs.existsSync(target);
    },
  },
});

// selfUpdate() tiene caché a nivel de módulo; se recarga la instancia por
// prueba para que cada flujo de reintento parta de cero.
function reloadProvider() {
  delete require.cache[require.resolve('../electron/videoProvider.cjs')];
  return require('../electron/videoProvider.cjs');
}

function reset() {
  state.children.length = 0;
  state.execFileCalls.length = 0;
  state.taskkillHandler = null;
  state.ytDlpHidden = false;
  state.failUpdateSpawn = false;
}
function emit(child, stream, text) {
  child[stream].emit('data', Buffer.from(text));
}
function closeChild(child, code) {
  process.nextTick(() => child.emit('close', code));
}
function failChild(child, error) {
  process.nextTick(() => child.emit('error', error));
}

test('listVideoFormats agrupa calidades y añade audio si existe', async () => {
  const provider = reloadProvider();
  reset();
  const payload = JSON.stringify({
    title: '  Mi   video ',
    webpage_url: 'https://www.youtube.com/watch?v=abc',
    formats: [
      { height: 720, vcodec: 'avc1', acodec: 'mp4a', format_note: '720p' },
      { height: 1080, vcodec: 'vp9', acodec: 'none' },
      { vcodec: 'none', acodec: 'opus', format_note: 'audio only' },
    ],
  });
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  emit(state.children[0], 'stdout', payload);
  closeChild(state.children[0], 0);
  const candidates = await promise;
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].videoFormat, 'video:1080');
  assert.equal(candidates[0].name, 'Mi video [1080p]');
  assert.equal(candidates[1].videoFormat, 'video:720');
  assert.equal(candidates[1].name, 'Mi video [720p]');
  assert.equal(candidates[2].mode, 'audio');
  assert.equal(candidates[2].videoFormat, 'audio');
  assert.equal(candidates[0].host, 'www.youtube.com');
  assert.equal(candidates[0].online, true);
  assert.equal(candidates[0].selected, true);
});

test('listVideoFormats devuelve array vacío sin formatos', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://example.com/v');
  emit(state.children[0], 'stdout', JSON.stringify({ formats: [] }));
  closeChild(state.children[0], 0);
  assert.deepEqual(await promise, []);
});

test('listVideoQualityOptions siempre ofrece la mejor calidad', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoQualityOptions('https://example.com/v');
  emit(state.children[0], 'stdout', JSON.stringify({ formats: [{ height: 480, vcodec: 'x' }] }));
  closeChild(state.children[0], 0);
  const options = await promise;
  assert.deepEqual(options[0], { label: 'Mejor calidad', videoFormat: 'video:best' });
  assert.ok(options.some((o) => o.videoFormat === 'video:480'));
});

test('listPlaylistVideos lista hasta el límite definido', async () => {
  const provider = reloadProvider();
  reset();
  const entries = Array.from({ length: 550 }, (_, i) => ({ id: `v${i}`, title: `T${i}` }));
  const promise = provider.listPlaylistVideos('https://www.youtube.com/playlist?list=pl');
  emit(state.children[0], 'stdout', JSON.stringify({ _type: 'playlist', title: 'L', entries }));
  closeChild(state.children[0], 0);
  const playlist = await promise;
  assert.equal(playlist.videos.length, 500);
});

test('listVideoFormats reintenta tras autoactualizarse en errores de extracción', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  // primer intento falla con error de extracción
  emit(state.children[0], 'stderr', 'ERROR: Unsupported URL');
  closeChild(state.children[0], 1);
  // selfUpdate: yt-dlp -U sale con "Updated yt-dlp"
  while (state.children.length < 2) await new Promise((r) => setImmediate(r));
  const updater = state.children[1];
  assert.ok(updater.args.includes('-U'));
  emit(updater, 'stdout', 'Updated yt-dlp to 2026.01.01');
  closeChild(updater, 0);
  // reintento del análisis, ahora exitoso
  while (state.children.length < 3) await new Promise((r) => setImmediate(r));
  emit(state.children[2], 'stdout', JSON.stringify({ title: 'Con retry', formats: [] }));
  closeChild(state.children[2], 0);
  const candidates = await promise;
  assert.deepEqual(candidates, []);
  assert.equal(state.children.length, 3);
});

test('listVideoFormats no reintenta si la actualización no aplicó cambios', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  emit(state.children[0], 'stderr', 'ERROR: Unsupported URL');
  closeChild(state.children[0], 1);
  while (state.children.length < 2) await new Promise((r) => setImmediate(r));
  emit(state.children[1], 'stdout', 'yt-dlp is up to date');
  closeChild(state.children[1], 0);
  await assert.rejects(promise, /Unsupported URL/);
  assert.equal(state.children.length, 2);
});

test('listVideoFormats no reintenta errores que no son de extracción', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  closeChild(state.children[0], 1);
  await assert.rejects(promise, /yt-dlp falló con código 1/);
  assert.equal(state.children.length, 1);
});

test('listVideoFormats describe el fallo con el detalle que dio yt-dlp', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  emit(state.children[0], 'stderr', '[debug] líneas internas\nERROR: Unsupported URL: yt\n');
  emit(state.children[0], 'stdout', '[download] algo\n');
  closeChild(state.children[0], 1);
  while (state.children.length < 2) await new Promise((r) => setImmediate(r));
  emit(state.children[1], 'stdout', 'yt-dlp is up to date');
  closeChild(state.children[1], 0);
  await assert.rejects(promise, /Unsupported URL/);
});

test('listVideoFormats propaga el fallo de arranque del binario', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  failChild(state.children[0], Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(promise, { code: 'ENOENT' });
  assert.equal(state.children.length, 1);
});

test('listVideoFormats no reintenta si el actualizador no puede arrancar', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  emit(state.children[0], 'stderr', 'ERROR: Unsupported URL');
  closeChild(state.children[0], 1);
  while (state.children.length < 2) await new Promise((r) => setImmediate(r));
  failChild(state.children[1], new Error('ENOENT'));
  await assert.rejects(promise, /Unsupported URL/);
  assert.equal(state.children.length, 2, 'no hay tercer intento');
});

test('downloadVideo reporta progreso y totales', async () => {
  const provider = reloadProvider();
  reset();
  const progress = [];
  const controller = provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: path.join('C:', 'videos'),
    name: 'capitulo',
    format: 'video:720',
    onProgress: (stats) => progress.push(stats),
  });
  const child = state.children[0];
  assert.ok(child.args.includes('-f'));
  assert.equal(child.args[child.args.indexOf('-f') + 1], 'bv*[height<=720]+ba/b[height<=720]/b');
  emit(child, 'stdout', '[download]  42.5% of 10.00MiB at 1.50MiB/s ETA 00:10');
  closeChild(child, 0);
  await controller.result;
  assert.equal(progress[0].progress, 42);
  assert.equal(progress[0].total, 10 * 1024 ** 2);
  assert.equal(progress[0].downloaded, Math.round((10 * 1024 ** 2 * 42.5) / 100));
});

test('downloadVideo resuelve el filePath desde la salida final', async () => {
  const provider = reloadProvider();
  reset();
  const controller = provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: 'C:\\videos',
    name: 'x',
    format: 'audio',
  });
  const child = state.children[0];
  emit(child, 'stdout', '[ExtractAudio] Destination: C:\\videos\\x.opus\nC:\\videos\\x.opus');
  closeChild(child, 0);
  const result = await controller.result;
  assert.equal(result.filePath, 'C:\\videos\\x.opus');
});

test('downloadVideo rechaza detallando el error de yt-dlp', async () => {
  const provider = reloadProvider();
  reset();
  const controller = provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: 'C:\\videos',
    name: 'x',
    format: 'video:best',
  });
  const child = state.children[0];
  emit(child, 'stderr', '[ERROR] Private video\nOtra línea');
  closeChild(child, 1);
  await assert.rejects(controller.result, /Private video/);
});

test('downloadVideo detenido resuelve sin error', async () => {
  const provider = reloadProvider();
  reset();
  const controller = provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: 'C:\\videos',
    name: 'x',
    format: 'video:best',
  });
  const child = state.children[0];
  controller.stop();
  if (process.platform === 'win32') {
    assert.equal(state.execFileCalls[0].command, 'taskkill');
    const pidIndex = state.execFileCalls[0].args.indexOf('/pid');
    assert.equal(state.execFileCalls[0].args[pidIndex + 1], String(child.pid));
  } else {
    assert.equal(child.killedSignal, 'SIGKILL');
  }
  closeChild(child, 0);
  assert.deepEqual(await controller.result, { stopped: true });
});

test('downloadVideo tolera un error de spawn del binario', async () => {
  const provider = reloadProvider();
  reset();
  const controller = provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: 'C:\\videos',
    name: 'x',
    format: 'video:best',
  });
  const child = state.children[0];
  // el módulo registra un handler de error no-op; emitirlo no debe romper nada
  child.emit('error', new Error('spawn ENOENT'));
  closeChild(child, 1);
  await assert.rejects(controller.result, /falló con código 1/);
});

test('downloadVideo arma el nombre de salida escapando los %', async () => {
  const provider = reloadProvider();
  reset();
  provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: 'C:\\videos',
    name: '100% heavy',
    format: 'audio',
  });
  const args = state.children[0].args;
  const output = args[args.indexOf('-o') + 1];
  assert.equal(output, path.join('C:\\videos', '100%% heavy.%(ext)s'));
});

test('resolveYtDlp cae al binario del PATH si no existe el vendido', async () => {
  const provider = reloadProvider();
  reset();
  state.ytDlpHidden = true;
  try {
    assert.equal(provider.resolveYtDlp(), 'yt-dlp');
  } finally {
    state.ytDlpHidden = false;
  }
});

test('listVideoFormats abandona si yt-dlp tarda demasiado', async () => {
  const provider = reloadProvider();
  reset();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => originalSetTimeout(fn, Math.min(ms, 25), ...rest);
  try {
    await assert.rejects(
      provider.listVideoFormats('https://www.youtube.com/watch?v=abc'),
      /tardó demasiado/,
    );
    assert.equal(state.children.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('downloadVideo detiene con SIGKILL en plataformas sin taskkill', async () => {
  const provider = reloadProvider();
  reset();
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    const controller = provider.downloadVideo({
      url: 'https://www.youtube.com/watch?v=abc',
      destination: 'C:\\videos',
      name: 'x',
      format: 'video:best',
    });
    const child = state.children[0];
    controller.stop();
    assert.equal(child.killedSignal, 'SIGKILL');
    assert.equal(state.execFileCalls.length, 0);
    closeChild(child, 0);
    assert.deepEqual(await controller.result, { stopped: true });
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});

test('downloadVideo ignora una segunda llamada a stop', async () => {
  const provider = reloadProvider();
  reset();
  const controller = provider.downloadVideo({
    url: 'https://www.youtube.com/watch?v=abc',
    destination: 'C:\\videos',
    name: 'x',
    format: 'video:best',
  });
  const child = state.children[0];
  controller.stop();
  const kills = state.execFileCalls.length;
  assert.ok(kills >= 1, 'la primera parada dispara taskkill o SIGKILL');
  controller.stop();
  if (process.platform === 'win32') assert.equal(state.execFileCalls.length, kills);
  else assert.equal(child.killedSignal, 'SIGKILL');
  closeChild(child, 0);
  assert.deepEqual(await controller.result, { stopped: true });
});

test('listVideoFormats solo autoactualiza una vez por sesión', async () => {
  const provider = reloadProvider();
  reset();
  const first = provider.listVideoFormats('https://www.youtube.com/watch?v=a');
  emit(state.children[0], 'stderr', 'ERROR: Unsupported URL');
  closeChild(state.children[0], 1);
  while (state.children.length < 2) await new Promise((r) => setImmediate(r));
  emit(state.children[1], 'stdout', 'Updated yt-dlp to 2026.01.01');
  closeChild(state.children[1], 0);
  while (state.children.length < 3) await new Promise((r) => setImmediate(r));
  emit(state.children[2], 'stdout', JSON.stringify({ title: 'A', formats: [] }));
  closeChild(state.children[2], 0);
  assert.deepEqual(await first, []);
  assert.equal(state.children.length, 3);

  const second = provider.listVideoFormats('https://www.youtube.com/watch?v=b');
  emit(state.children[3], 'stderr', 'ERROR: Unsupported URL');
  closeChild(state.children[3], 1);
  while (state.children.length < 5) await new Promise((r) => setImmediate(r));
  emit(state.children[4], 'stdout', JSON.stringify({ title: 'B', formats: [] }));
  closeChild(state.children[4], 0);
  assert.deepEqual(await second, []);
  assert.equal(state.children.length, 5, 'la actualización se reutiliza, sin nuevo proceso -U');
});

test('listVideoFormats continúa si la autoactualización no puede iniciar', async () => {
  const provider = reloadProvider();
  reset();
  state.failUpdateSpawn = true;
  const promise = provider.listVideoFormats('https://www.youtube.com/watch?v=abc');
  emit(state.children[0], 'stderr', 'ERROR: Unsupported URL');
  closeChild(state.children[0], 1);
  await assert.rejects(promise, /Unsupported URL/);
  assert.equal(state.children.length, 1, 'no hay proceso actualizador');
  state.failUpdateSpawn = false;
});

test('listVideoFormats tolera formatos que no son array', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoFormats('https://example.com/v');
  emit(
    state.children[0],
    'stdout',
    JSON.stringify({
      title: 'Sin formatos',
      formats: { raro: 1 },
      webpage_url: 'https://example.com/ok',
    }),
  );
  closeChild(state.children[0], 0);
  assert.deepEqual(await promise, []);
});

test('listVideoQualityOptions ofrece audio cuando existe y tolera formatos raros', async () => {
  const provider = reloadProvider();
  reset();
  const promise = provider.listVideoQualityOptions('https://example.com/v');
  emit(state.children[0], 'stdout', JSON.stringify({ formats: { raro: 1 } }));
  closeChild(state.children[0], 0);
  assert.deepEqual(await promise, [{ label: 'Mejor calidad', videoFormat: 'video:best' }]);

  const providerAudio = reloadProvider();
  reset();
  const audio = providerAudio.listVideoQualityOptions('https://example.com/v');
  emit(
    state.children[0],
    'stdout',
    JSON.stringify({ formats: [{ vcodec: 'none', acodec: 'opus' }] }),
  );
  closeChild(state.children[0], 0);
  const options = await audio;
  assert.deepEqual(options[0], { label: 'Mejor calidad', videoFormat: 'video:best' });
  assert.deepEqual(options[1], { label: 'Solo audio', videoFormat: 'audio' });
});
