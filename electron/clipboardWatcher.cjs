const { EventEmitter } = require('node:events');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HANDLER = {
  win32: 'clipboard-event-handler-win32.exe',
  darwin: 'clipboard-event-handler-mac',
  linux: 'clipboard-event-handler-linux',
}[process.platform];

function handlerBinary() {
  let binary = path.join(path.dirname(require.resolve('clipboard-event')), 'platform', HANDLER);
  if (process.resourcesPath && binary.includes('app.asar')) {
    binary = binary.replace('app.asar', 'app.asar.unpacked');
  }
  return binary;
}

const events = new EventEmitter();
let child = null;

class ClipboardWatcher {
  start() {
    if (child) return;
    child = execFile(handlerBinary());
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('CLIPBOARD_CHANGE')) events.emit('change');
    });
    child.on('error', () => {
      child = null;
    });
  }
  stop() {
    if (child) {
      child.kill();
      child = null;
    }
  }
}

module.exports = { watcher: new ClipboardWatcher(), events };
