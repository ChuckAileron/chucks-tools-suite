const { BrowserWindow } = require('electron');

const NAVIGATE_TIMEOUT = 60000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class BotCancelled extends Error {
  constructor() {
    super('El bot fue cancelado.');
    this.name = 'BotCancelled';
  }
}

const delay = (ms, cancelled) =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (cancelled.value) resolve();
      else if (Date.now() - started >= ms) resolve();
      else setTimeout(tick, 50);
    };
    setTimeout(tick, Math.min(50, ms));
  });

const exec = (win, script) =>
  win.webContents.executeJavaScript(script, true).catch((error) => {
    throw new Error(`Error ejecutando paso en la página: ${String(error)}`);
  });

const clickScript = (selector, text) => `(() => {
  const selector = ${JSON.stringify(selector)};
  const text = ${JSON.stringify(text)};
  const bySelector = (() => {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch { return null; }
  })();
  const byText = text
    ? [...document.querySelectorAll(
        'a, button, [role="button"], input[type="submit"], input[type="button"], [onclick]',
      )].find((node) => (node.textContent || '').trim().toLowerCase().includes(text.toLowerCase()))
    : null;
  const element = bySelector || byText || null;
  if (!element) return { ok: false, why: 'selector o texto no encontrado' };
  element.click();
  return { ok: true };
})()`;

const typeScript = (selector, text) => `(() => {
  const selector = ${JSON.stringify(selector)};
  const value = ${JSON.stringify(text)};
  const element = document.querySelector(selector);
  if (!element) return { ok: false };
  const setter =
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`;

const submitScript = (selector, text) => `(() => {
  const selector = ${JSON.stringify(selector)};
  const text = ${JSON.stringify(text)};
  let element = null;
  try { element = selector ? document.querySelector(selector) : null; } catch {}
  if (!element && text) {
    element = [...document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"]',
    )].find((node) => (node.textContent || node.value || '')
      .toLowerCase().includes(text.toLowerCase())) || null;
  }
  if (element) element.click();
  const form = document.querySelector('form');
  if (!element && form && typeof form.requestSubmit === 'function') form.requestSubmit();
  return { ok: true };
})()`;

const collectScript = (script) =>
  typeof script === 'string'
    ? script
    : '(() => { try { return String(document.title); } catch { return ""; } })()';

const collectLinksScript = (pattern, schemeFilter) => `(() => {
  const pattern = ${JSON.stringify(pattern)};
  const scheme = ${JSON.stringify(schemeFilter)};
  let matcher = null;
  if (pattern) {
    try { matcher = new RegExp(pattern, 'i'); } catch {}
  }
  const base = location.href;
  const found = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {
    let url;
    try { url = new URL(anchor.getAttribute('href'), base).href; }
    catch { continue; }
    if (!scheme.test(url)) continue;
    if (!matcher || matcher.test(url)) found.add(url);
  }
  return [...found];
})()`;

const authedScript = (successSelector) => `(() => {
  const selector = ${JSON.stringify(successSelector)};
  let ok = false;
  if (selector) {
    try { ok = !!document.querySelector(selector); } catch { ok = false; }
  }
  return {
    ok,
    title: document.title || '',
    url: location.href,
    time: new Date().toLocaleTimeString('es-CL'),
  };
})()`;

function createBotWindow(partition) {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
}

async function loadUrl(win, url) {
  let timer;
  let settle = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (settle) return;
      reject(new Error('El sitio no respondió a tiempo.'));
    }, NAVIGATE_TIMEOUT);
  });
  const failed = new Promise((resolve, reject) => {
    win.webContents.once('did-fail-load', (_event, code, description) => {
      if (settle) return;
      reject(new Error(`La carga falló (${code}): ${description}`));
    });
  });
  const load = win
    .loadURL(url)
    .then(() => { settle = true; })
    .catch((error) => {
      if (settle) return;
      if (String(error).includes('ERR_ABORTED')) return;
      throw error;
    });
  try {
    await Promise.race([load, timeout, failed]);
  } finally {
    settle = true;
    clearTimeout(timer);
    failed.catch(() => {});
  }
}

async function runFlow({ win, steps, cancelled, onStep, onLog }) {
  const results = {};
  const total = steps.length;
  for (let index = 0; index < total; index += 1) {
    if (cancelled.value) throw new BotCancelled();
    const step = steps[index];
    const label = step.label || step.type || 'paso';
    onStep(index, total, label);
    try {
      switch (step.type) {
        case 'navigate':
          onLog(`Abriendo ${step.url}`, 'info');
          await loadUrl(win, step.url);
          if (step.waitMs) await delay(step.waitMs, cancelled);
          break;
        case 'wait':
          await delay(step.ms || 1000, cancelled);
          break;
        case 'click': {
          const clicked = await exec(win, clickScript(step.selector, step.text));
          if (!clicked.ok)
            throw new Error(`No se pudo hacer clic: ${clicked.why || 'elemento ausente'}.`);
          if (step.waitMs) await delay(step.waitMs, cancelled);
          break;
        }
        case 'type': {
          const typed = await exec(win, typeScript(step.selector, step.text));
          if (!typed.ok)
            throw new Error(`No se encontró el campo de entrada ${step.selector || ''}.`);
          break;
        }
        case 'submit':
          await exec(win, submitScript(step.selector, step.text));
          if (step.waitMs) await delay(step.waitMs, cancelled);
          break;
        case 'collect':
          results[step.key || 'collected'] = await exec(win, collectScript(step.script));
          break;
        case 'collect-links':
          results[step.key || 'links'] = await exec(
            win,
            collectLinksScript(step.pattern || '', step.scheme || /^https?:$/),
          );
          break;
        case 'authed-check':
          results[step.key || 'authed'] = await exec(win, authedScript(step.successSelector));
          break;
        case 'task':
          results[step.key || step.label] = await step.fn();
          break;
        default:
          throw new Error(`Tipo de paso no soportado: ${step.type}.`);
      }
    } catch (error) {
      if (cancelled.value) throw new BotCancelled();
      throw error;
    }
  }
  return results;
}

class BotEngine {
  constructor(partition) {
    this.partition = partition;
    this.cancelled = { value: false };
    this.win = null;
  }

  cancel() {
    this.cancelled.value = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  async run({ steps, onStep, onLog }) {
    this.win = createBotWindow(this.partition || 'persist:bots');
    this.win.webContents.setUserAgent(USER_AGENT);
    try {
      return await runFlow({
        win: this.win,
        steps,
        cancelled: this.cancelled,
        onStep,
        onLog,
      });
    } finally {
      if (this.win && !this.win.isDestroyed()) this.win.destroy();
      this.win = null;
    }
  }
}

module.exports = {
  BotEngine,
  BotCancelled,
  collectLinksScript,
  clickScript,
  typeScript,
  submitScript,
  authedScript,
  DEVICE_LINK_RE:
    /\.(zip|rar|7z|tar|gz|bz2|mp4|mkv|avi|mov|mp3|flac|wav|pdf|apk|exe|msi|iso|dmg|deb|rpm|torrent)(\?.*)?$/i,
};