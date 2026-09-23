const crypto = require('node:crypto');

// Soporte para enlaces compartidos de TeraBox (1024terabox.com / terabox.com /
// terabox.app) usando SOLO Node estándar, sin cuenta ni BDUSS. Una vez obtenido
// el enlace directo (firmado) la descarga se entrega a node-downloader-helper.
//
// El flujo anónimo (el que usan los scrapers) es:
//   1. GET  <host>/s/<codigo>         -> seguimos redirecciones y guardamos cookies
//   2. POST <host>/share/verify       -> { surl, jsToken } -> verifykey
//   3. GET  <host>/api/shortner/v1/msgsharelist -> lista de archivos (dlink o firma)
//   4. Para carpetas se recorre con root=0&fs_id=<padre>.
//
// Los servidores de TeraBox cambian a menudo y pueden pedir captcha; estos pasos
// son la mejor aproximación anónima documentada. La firma de api/download usa la
// combinación shareid+fs_id+timestamp; si el enlace lo requiere, los fallos se
// reportan tal cual para reintentar.

const TERABOX_HOST = /(^|\.)(?:terabox\.com|1024terabox\.com|terabox\.app)$/i;
const BROWSER_UA = 'Mozilla/5.0 Chrome/140 Safari/537.36';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  store(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const set of raw) {
      const first = String(set).split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

// Extrae el código corto de un enlace compartido de TeraBox.
function teraboxShareParts(value) {
  try {
    const url = new URL(value);
    if (!TERABOX_HOST.test(url.hostname)) return '';
    let surl = url.searchParams.get('surl') || '';
    if (!surl) {
      const match = /\/s\/([^/?#]+)/i.exec(url.pathname);
      if (match) surl = match[1].replace(/\/$/, '');
    }
    if (!surl) return '';
    return { host: url.origin, surl };
  } catch {
    return '';
  }
}

async function teraboxRequest(url, { method = 'GET', form, jar } = {}) {
  const headers = { 'User-Agent': BROWSER_UA };
  if (jar) {
    const cookieHeader = jar.header();
    if (cookieHeader) headers.Cookie = cookieHeader;
  }
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  const response = await fetch(url, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  if (jar) jar.store(response.headers);
  return response;
}

async function getPageWithCookies(startUrl, jar, maxHops = 8) {
  let current = startUrl;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const response = await teraboxRequest(current, { jar });
    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) throw new Error(`Terabox respondió ${response.status}.`);
    return { url: current, html: await response.text() };
  }
  throw new Error('Terabox no completó la redirección del enlace.');
}

function extractJsToken(html) {
  const markers = [
    /"jsToken"\s*:\s*"([^"]+)"/i,
    /jsToken\s*[:=]\s*"([^"]+)"/i,
    /jsToken\s*=\s*['"]([^'"]+)['"]/i,
  ];
  for (const pattern of markers) {
    const match = pattern.exec(html || '');
    if (match?.[1]) return match[1];
  }
  return '';
}
function extractPageTitle(html) {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html || '')?.[1] || '';
  return title
    .replace(/-[^-]*Tera(?:Box)?[^-]*$/i, '')
    .replace(/\s*-\s*TeraBox\s*$/i, '')
    .trim();
}

function teraboxErrorMessage(errno) {
  const known = {
    '-2': 'Terabox no procesó la solicitud. Intenta de nuevo.',
    '-3': 'Terabox no encontró el enlace compartido.',
    105: 'Terabox no encontró el enlace compartido.',
    108: 'El enlace de Terabox caducó o fue retirado.',
    257: 'El enlace de Terabox está protegido por contraseña (aún no soportado).',
    403: 'Terabox bloqueó la solicitud (posible anticaptcha). Reintenta más tarde.',
  };
  return known[String(errno)] || `Terabox respondió un error (código ${errno}).`;
}

async function verifyShare({ host, surl, jsToken, jar }) {
  const url = `${host}/share/verify?channel=chunlei&web=1&app_id=250528&clienttype=0`;
  const response = await teraboxRequest(url, {
    method: 'POST',
    form: { pwd: '', vcode: '', vcode_str: '', surl, jsToken: jsToken || '' },
    jar,
  });
  const data = await response.json();
  if (data.errno !== 0 && data.errno !== undefined)
    throw new Error(teraboxErrorMessage(data.errno));
  return typeof data.verifykey === 'string' ? data.verifykey : '';
}

async function shareList({ host, surl, verifykey, jar, fsId = '' }) {
  const url = new URL(`${host}/api/shortner/v1/msgsharelist`);
  url.searchParams.set('shorturl', surl);
  url.searchParams.set('root', fsId ? '0' : '1');
  if (fsId) url.searchParams.set('fs_id', String(fsId));
  url.searchParams.set('scene', '0');
  url.searchParams.set('web', '1');
  url.searchParams.set('channel', 'chunlei');
  url.searchParams.set('clienttype', '0');
  url.searchParams.set('app_id', '250528');
  if (verifykey) url.searchParams.set('verifykey', verifykey);
  const response = await teraboxRequest(url.href, { jar });
  const data = await response.json();
  if (data.errno !== 0 && data.errno !== undefined)
    throw new Error(teraboxErrorMessage(data.errno));
  return data;
}

async function collectFiles(share, fsId, trail, files, limit) {
  if (files.length >= limit) return;
  const data = await shareList({ ...share, fsId });
  for (const item of data.list || []) {
    if (files.length >= limit) return;
    if (!item) continue;
    const name = item.server_filename || 'Archivo de Terabox';
    if (item.isdir || item.is_degree === '1' || item.fs_id === undefined) {
      await collectFiles(share, item.fs_id, [...trail, name], files, limit);
      continue;
    }
    files.push({
      fs_id: String(item.fs_id),
      name,
      size: item.size || 0,
      md5: item.md5 || '',
      dlink: typeof item.dlink === 'string' && item.dlink ? item.dlink : '',
      path: [...trail, name].filter(Boolean).join(' / '),
      fromFolder: trail.length > 0,
    });
  }
}

// Resuelve todo el árbol de un enlace compartido de TeraBox.
async function expandTeraboxShare(url, { limit = 200 } = {}) {
  const parts = teraboxShareParts(url);
  if (!parts) throw new Error('El enlace no es de TeraBox.');
  const jar = new CookieJar();
  const page = await getPageWithCookies(`${parts.host}/s/${parts.surl}`, jar);
  const finalUrl = new URL(page.url);
  const surl = finalUrl.searchParams.get('surl') || parts.surl;
  const jsToken = extractJsToken(page.html);
  const verifykey = await verifyShare({ host: parts.host, surl, jsToken, jar });
  const root = await shareList({ host: parts.host, surl, verifykey, jar });
  const files = [];
  await collectFiles({ host: parts.host, surl, verifykey, jar }, '', [], files, limit);
  if (!files.length) throw new Error('TeraBox no devolvió archivos de este enlace.');
  return {
    host: parts.host,
    surl,
    uk: String(root.uk || ''),
    shareid: String(root.shareid || ''),
    name: extractPageTitle(page.html) || 'TeraBox',
    url,
    files,
  };
}

// Construye el enlace firmado de api/download para un archivo concreto. La firma
// (md5 de shareid+fs_id+timestamp) es la empleada por el web anónimo; algunos
// enlaces exigen el sign de la sesión (BDUSS) en cuyo caso este es best-effort.
function teraboxDownloadUrl({ host, surl, uk, shareid, fsId }) {
  const timestamp = Date.now();
  const sign = crypto.createHash('md5').update(`${shareid}${fsId}${timestamp}`).digest('hex');
  const params = new URLSearchParams({
    channel: 'chunlei',
    web: '1',
    app_id: '250528',
    clienttype: '0',
    surl,
    fs_id: String(fsId),
    uk: String(uk || ''),
    shareid: String(shareid || ''),
    sign,
    timestamp: String(timestamp),
  });
  return `${host}/api/download?${params.toString()}`;
}

// Vuelve a resolver el enlace directo de un archivo (para reanudar o refrescar).
async function refreshTeraboxFile(url, fsId) {
  const share = await expandTeraboxShare(url);
  const file = share.files.find((item) => item.fs_id === String(fsId));
  if (!file) return '';
  return (
    file.dlink ||
    teraboxDownloadUrl({
      host: share.host,
      surl: share.surl,
      uk: share.uk,
      shareid: share.shareid,
      fsId: file.fs_id,
    })
  );
}

module.exports = {
  teraboxShareParts,
  teraboxDownloadUrl,
  expandTeraboxShare,
  refreshTeraboxFile,
  extractJsToken,
  teraboxErrorMessage,
  CookieJar,
};
