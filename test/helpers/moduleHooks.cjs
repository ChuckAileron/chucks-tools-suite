const Module = require('node:module');
const { EventEmitter } = require('node:events');

const originalLoad = Module._load;

// Registra módulos falsos para los require() de CommonJS posteriores. Los
// módulos de arriba se resuelven contra estos hooks.
function installHooks(overrides) {
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request];
    return originalLoad.call(this, request, parent, isMain);
  };
}

function restoreHooks() {
  Module._load = originalLoad;
}

function createFakeChild(options = {}) {
  const child = new EventEmitter();
  child.stdout = {}; // se sustituye por un EventEmitter en createFakeProcess
  child.stderr = {};
  child.kill = (signal) => {
    child.killed = signal;
    child.emit('killed');
  };
  child.pid = options.pid || 1234;
  return child;
}

// Emula el resultado de child_process.spawn(): un EventEmitter con los
// campos stdout/stderr que el código espera (emiten 'data') y kill().
function createFakeProcess(options = {}) {
  const child = createFakeChild(options);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

// Convierte un error de spawn en un evento 'error' del proceso.
function failChild(child, error) {
  process.nextTick(() => child.emit('error', error));
  return child;
}

function closeChild(child, code) {
  process.nextTick(() => child.emit('close', code));
  return child;
}

module.exports = {
  installHooks,
  restoreHooks,
  createFakeChild,
  createFakeProcess,
  failChild,
  closeChild,
};
