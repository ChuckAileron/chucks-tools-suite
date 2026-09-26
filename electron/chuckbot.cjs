// chuckbot.cjs — Integración del backend Go de ChuckBot en la suite.
//
// Responsabilidades:
//   - Gestionar el ciclo de vida del binario chuckbot.exe (iniciar/parar)
//     que sirve la API local en http://localhost:8374.
//   - Proxear las peticiones de la UI hacia los endpoints de la API
//     (chat con archivos, control de Ollama) reenviando los eventos SSE
//     al renderer mediante el canal IPC "chuckbot:event".
//   - Guardar el archivo solución en la carpeta del proyecto elegida.
//   - Enviar el archivo solución a VS Code mediante la extensión
//     "Remote Control" (websocket ws://127.0.0.1:<puerto>).

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PORT = 8374;
const API = `http://localhost:${PORT}`;
// Cualquier respuesta (incluso 503 cuando Ollama está apagado) significa
// que el servidor ChuckBot está arriba y escuchando.
const HEALTH_URL = `${API}/api/health`;
const DEFAULT_VSCODE_PORT = 3710;

// ── Ruta del binario ────────────────────────────────────────────────────────
function binaryPath() {
  if (process.platform !== 'win32') {
    const platformPath = path.join(__dirname, '..', 'vendor', 'chuckbot', 'chuckbot');
    if (fs.existsSync(platformPath)) return platformPath;
  }
  if (process.resourcesPath) {
    const packed = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'vendor',
      'chuckbot',
      'chuckbot.exe',
    );
    if (fs.existsSync(packed)) return packed;
  }
  return path.join(__dirname, '..', 'vendor', 'chuckbot', 'chuckbot.exe');
}

// ── Estado del servidor ─────────────────────────────────────────────────────
let proc = null;
// Flag global que indica si el bot se encendió en esta sesión. Mientras esté
// inactiva, las consultas de estado de Ollama responden «apagado» sin tocar
// la API local, evitando el ruido de "ChuckBot no está disponible: fetch
// failed" en cada sondeo cuando el bot nunca se encendió (o ya se apagó).
let startedOnce = false;
const runningStreams = new Map(); // streamId -> AbortController
let nextStreamId = 1;

async function serverReachable() {
  try {
    await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function startServer() {
  if (proc) return { running: true };
  if (await serverReachable()) {
    startedOnce = true;
    return { running: true, external: true };
  }

  const bin = binaryPath();
  if (!fs.existsSync(bin)) {
    return { running: false, error: `No se encontró el binario de ChuckBot en ${bin}.` };
  }

  try {
    proc = spawn(bin, ['--no-ollama', '--no-browser'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    proc = null;
    return { running: false, error: `No se pudo iniciar ChuckBot: ${error.message}` };
  }

  proc.on('error', () => {
    proc = null;
  });
  proc.on('exit', () => {
    proc = null;
  });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await serverReachable()) {
      startedOnce = true;
      return { running: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const up = await serverReachable();
  if (up) {
    startedOnce = true;
    return { running: true };
  }
  return { running: false, error: 'El servidor ChuckBot no respondió a tiempo.' };
}

async function stopServer() {
  if (!proc) {
    const external = await serverReachable();
    startedOnce = external;
    return { running: external, external };
  }
  const child = proc;
  proc = null;
  startedOnce = false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ya terminó */
      }
      resolve({ running: false });
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve({ running: false });
    });
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ya terminó */
      }
    }
  });
}

async function status() {
  const isUp = proc !== null || (await serverReachable());
  if (proc === null && !isUp) return { running: false };
  return { running: true, external: proc === null };
}

// ── Control de Ollama (proxea a la API) ────────────────────────────────────
async function ollamaAction(action) {
  // Si la flag global sigue inactiva, el bot nunca se encendió (o ya se
  // apagó): el estado se responde «apagado» sin consultar la API local.
  if (action === 'status' && !startedOnce) return { running: false };
  const method    = action === 'status' ? 'GET' : 'POST';
  const timeoutMs = action === 'start' ? 90000 : action === 'stop' ? 20000 : 8000;
  let res;
  try {
    res = await fetch(`${API}/api/ollama/${action}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (action === 'status') return { running: false };
    if (error.name === 'TimeoutError') {
      throw new Error('Ollama tardó demasiado en responder.');
    }
    throw new Error(`ChuckBot no está disponible: ${error.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (action === 'status') return { running: false };
    throw new Error(body.error || `Ollama respondió con HTTP ${res.status}.`);
  }
  return body;
}

// ── Chat (proxea SSE a eventos IPC) ────────────────────────────────────────
function chat(data, sender) {
  const controller = new AbortController();
  const id = nextStreamId++;
  runningStreams.set(id, controller);
  const send = (type, payload) => sender({ streamId: id, type, data: payload });
  // El stream corre en segundo plano; el id se devuelve al instante para que
  // el renderer lo registre antes de que llegue el primer evento SSE.
  void runChat(id, data, send, controller).catch(() => runningStreams.delete(id));
  return { id };
}

async function runChat(id, data, send, controller) {
  try {
    const res = await fetch(`${API}/api/chat-with-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      send('error', { message: `El servidor ChuckBot respondió con HTTP ${res.status}.` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingEvent = 'message';

    const dispatch = (raw) => {
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* se deja como texto */
      }
      send(pendingEvent === 'message' ? 'chunk' : pendingEvent, parsed);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line === '') {
          pendingEvent = 'message';
          continue;
        }
        if (line.startsWith('event: ')) {
          pendingEvent = line.slice(7).trim();
          continue;
        }
        if (line.startsWith('data: ')) dispatch(line.slice(6).trim());
      }
    }
    if (buffer.startsWith('data: ')) dispatch(buffer.slice(6).trim());
  } catch (error) {
    if (error.name !== 'AbortError') {
      send('error', { message: error.message });
    } else {
      send('cancelled', {});
    }
  } finally {
    runningStreams.delete(id);
  }
}

function cancelChats() {
  for (const controller of runningStreams.values()) controller.abort();
  return true;
}

// ── Archivo solución: guardado en disco ────────────────────────────────────
function saveSolution({ folder, name, content }) {
  const safeName = path.basename(String(name || 'solucion.txt').replace(/[/\\]/g, '_'));
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Ingresa un nombre de archivo válido.');
  }
  if (!folder) throw new Error('Selecciona primero la carpeta del proyecto.');
  const target = path.join(folder, safeName);
  fs.writeFileSync(target, content, 'utf8');
  return { path: target, name: safeName };
}

// ── Envío a VS Code (extensión Remote Control) ─────────────────────────────
async function pushToVsCode({ filePath, port = DEFAULT_VSCODE_PORT }) {
  if (!fs.existsSync(filePath)) throw new Error('El archivo solución no existe todavía.');
  if (typeof WebSocket !== 'function') {
    throw new Error('Este runtime no incluye el cliente WebSocket requerido.');
  }
  const target = `ws://127.0.0.1:${port}`;
  const uri = pathToFileURL(filePath).href;

  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(target);
    } catch (error) {
      reject(new Error(`No se pudo conectar con VS Code (${target}).`));
      return;
    }
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
      reject(
        new Error(
          `VS Code no respondió en el puerto ${port}. Verifica que la extensión "Remote Control" esté habilitada y usa el puerto que muestra su barra de estado.`,
        ),
      );
    }, 5000);
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ command: 'vscode.open', args: [uri] }));
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ya cerrado */
          }
          clearTimeout(timer);
          resolve({ ok: true, filePath });
        }, 250);
      } catch (error) {
        clearTimeout(timer);
        reject(new Error(`No se pudo enviar el comando a VS Code: ${error.message}`));
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error(
          `No se pudo conectar al WebSocket de VS Code (${target}). Verifica que la extensión "Remote Control" esté activa.`,
        ),
      );
    };
    ws.onclose = () => clearTimeout(timer);
  });
}

module.exports = {
  binaryPath,
  startServer,
  stopServer,
  status,
  ollamaAction,
  chat,
  cancelChats,
  saveSolution,
  pushToVsCode,
};
