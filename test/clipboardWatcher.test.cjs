const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { installHooks } = require('./helpers/moduleHooks.cjs');

const state = { calls: [], killed: 0 };
function execFile(binary) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {
    state.killed += 1;
  };
  state.calls.push(binary);
  state.lastChild = child;
  return child;
}
installHooks({ 'node:child_process': { execFile } });

const { watcher, events } = require('../electron/clipboardWatcher.cjs');

function resetWatcher() {
  watcher.stop();
  state.calls.length = 0;
  state.killed = 0;
  state.lastChild = null;
}

function platformBinaryName() {
  return {
    win32: 'clipboard-event-handler-win32.exe',
    darwin: 'clipboard-event-handler-mac',
    linux: 'clipboard-event-handler-linux',
  }[process.platform];
}

test('start usa el binario de la plataforma instalado con el paquete', () => {
  resetWatcher();
  watcher.start();
  assert.equal(state.calls.length, 1);
  assert.ok(state.calls[0].includes(platformBinaryName()));
  watcher.stop();
});

test('start emite change cuando el binario detecta un cambio', () => {
  resetWatcher();
  const changed = [];
  const listener = () => changed.push(1);
  events.on('change', listener);
  try {
    watcher.start();
    const child = state.lastChild;
    child.stdout.emit('data', Buffer.from('CLIPBOARD_CHANGE #42'));
    assert.equal(changed.length, 1);
    child.stdout.emit('data', Buffer.from('texto plano sin el marcador'));
    assert.equal(changed.length, 1);
  } finally {
    events.off('change', listener);
  }
});

test('start es idempotente mientras el hijo sigue vivo', () => {
  resetWatcher();
  watcher.start();
  watcher.start();
  assert.equal(state.calls.length, 1);
});

test('un error del binario permite volver a iniciar', () => {
  resetWatcher();
  watcher.start();
  assert.equal(state.calls.length, 1);
  state.lastChild.emit('error', new Error('binario no encontrado'));
  watcher.start();
  assert.equal(state.calls.length, 2);
});

test('stop mata el proceso y es seguro llamarlo varias veces', () => {
  resetWatcher();
  watcher.start();
  watcher.stop();
  assert.equal(state.killed, 1);
  watcher.stop();
  assert.equal(state.killed, 1);
});

test('el binario del handler existe en el paquete instalado', () => {
  const clipboardEventDir = path.dirname(require.resolve('clipboard-event'));
  const binary = path.join(clipboardEventDir, 'platform', platformBinaryName());
  assert.equal(fs.existsSync(binary), true);
});

test('start reempaqueta el binario cuando corre dentro de app.asar', () => {
  resetWatcher();
  const originalResolve = Module._resolveFilename;
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'clipboard-event')
      return path.join('C:\\aplicacion', 'app.asar', 'node_modules', 'clipboard-event', 'index.js');
    return originalResolve.call(this, request, parent, isMain, options);
  };
  Object.defineProperty(process, 'resourcesPath', {
    value: 'C:\\aplicacion',
    configurable: true,
    writable: true,
  });
  try {
    watcher.start();
    assert.equal(state.calls.length, 1);
    assert.ok(state.calls[0].includes('app.asar.unpacked'));
    assert.equal(state.calls[0].includes(`app.asar${path.sep}node_modules`), false);
  } finally {
    watcher.stop();
    Module._resolveFilename = originalResolve;
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor);
    else delete process.resourcesPath;
  }
});
