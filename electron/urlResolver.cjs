const dnsModule = require('node:dns');
const dns = dnsModule.promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { load } = require('cheerio');
const { getDomain } = require('tldts');

const DESTINATION_PARAMS = [
  'url',
  'u',
  'target',
  'dest',
  'destination',
  'redirect',
  'redirect_url',
  'redirect_uri',
  'link',
  'to',
  'out',
];

function isPrivateAddress(address) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

async function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Ingresa una URL válida y completa.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Solo se admiten URLs HTTP o HTTPS.');
  if (url.username || url.password) throw new Error('No se admiten credenciales dentro de la URL.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local'))
    throw new Error('No se admiten direcciones locales.');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error('La URL apunta a una red privada o reservada.');
  return url;
}

function extractCookies(response) {
  const values = response.headers['set-cookie'];
  if (!values) return '';
  return (Array.isArray(values) ? values : [values])
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function isTextualContentType(contentType) {
  return /text\/(?:html|css|plain)|application\/(?:xhtml\+xml|json|xml|javascript|x-javascript)/i.test(
    contentType,
  );
}

function requestPage(url, maxBytes = 1024 * 1024, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-language': 'es,en;q=0.8',
          ...(options.headers || {}),
        },
        lookup: (hostname, options, callback) =>
          dnsModule.lookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error);
            if (addresses.some(({ address }) => isPrivateAddress(address)))
              return callback(new Error('La conexión intentó acceder a una red privada.'));
            return options.all
              ? callback(null, addresses)
              : callback(null, addresses[0].address, addresses[0].family);
          }),
      },
      (response) => {
        const contentType = String(response.headers['content-type'] || '');
        const isText = isTextualContentType(contentType);
        const status = response.statusCode || 0;
        if (status >= 200 && status < 300 && !isText) {
          response.resume();
          return resolve({
            status,
            location: null,
            contentType,
            body: '',
            binary: true,
            headers: response.headers,
            cookies: extractCookies(response),
          });
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes)
            request.destroy(new Error('La respuesta supera el límite de tamaño permitido.'));
          else chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode || 0,
            location: response.headers.location,
            contentType,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            cookies: extractCookies(response),
          }),
        );
      },
    );
    request.setTimeout(12000, () =>
      request.destroy(new Error('La solicitud agotó el tiempo de espera.')),
    );
    request.once('error', reject);
  });
}

function urlCandidate(value, base) {
  if (!value) return null;
  let decoded = value.trim().replaceAll('&amp;', '&');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      break;
    }
  }
  try {
    const candidate = new URL(decoded, base);
    return ['http:', 'https:'].includes(candidate.protocol) ? candidate.href : null;
  } catch {
    return null;
  }
}

function extractDestination(current, body) {
  for (const parameter of DESTINATION_PARAMS) {
    const candidate = urlCandidate(current.searchParams.get(parameter), current);
    if (candidate && candidate !== current.href) return { url: candidate, method: 'query' };
  }
  if (!body) return null;
  const $ = load(body);
  const refresh = $('meta[http-equiv="refresh" i]')
    .attr('content')
    ?.match(/url\s*=\s*["']?([^"';]+)/i)?.[1];
  const metaCandidate = urlCandidate(refresh, current);
  if (metaCandidate) return { url: metaCandidate, method: 'meta-refresh' };
  const selector =
    'a#downloadButton, a#skip, a#skip_button, a.skip-ad, a.skip, a.get-link, a.btn-success, a[href][data-destination]';
  const link = $(selector).first();
  const linkCandidate = urlCandidate(link.attr('data-destination') || link.attr('href'), current);
  if (linkCandidate) return { url: linkCandidate, method: 'page-link' };
  const patterns = [
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /(?:destination|redirectUrl|targetUrl|finalUrl)\s*[:=]\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const candidate = urlCandidate(body.match(pattern)?.[1], current);
    if (candidate) return { url: candidate, method: 'page-script' };
  }
  return null;
}

const MEDIAFIRE_FILE = /^(?:www\.|m\.)?mediafire\.com$/i;
const MEDIAFIRE_DIRECT = /^download\d*\.mediafire\.com$/i;
const FIRELOAD_HOST = /^(?:www\.)?fireload\.com$/i;
const FIRELOAD_DIRECT = /^(?:[\w-]+\.)?fireload\.com$/i;

function extractFireloadTitle(body) {
  if (!body) return '';
  const $ = load(body);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text();
  return (title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(?:-\s+)?shared via Fireload$/i, '')
    .replace(/\s*\|\s*Fireload$/i, '')
    .trim();
}

function extractFireloadDlink(body) {
  if (!body) return null;
  const match = body.match(/window\.Fl\s*=\s*\{[^}]*"dlink"\s*:\s*"([^"]+)"/);
  return match?.[1] || null;
}

async function resolveFireloadSession(base, body, cookies) {
  if (!cookies) return null;
  const dlink = extractFireloadDlink(body);
  if (!dlink) return null;
  const target = urlCandidate(dlink.replaceAll('\\/', '/'), base);
  if (!target || !FIRELOAD_HOST.test(new URL(target).hostname)) return null;
  try {
    const response = await requestPage(new URL(target), 64 * 1024, {
      headers: { cookie: cookies },
    });
    if (response.status >= 300 && response.status < 400 && response.location) {
      const cdn = urlCandidate(response.location, base);
      if (cdn && FIRELOAD_DIRECT.test(new URL(cdn).hostname)) return cdn;
    }
  } catch {
    return null;
  }
  return null;
}

// Fireload sirve la descarga real detrás de un botón/formulario en la página
// del archivo. Se intentan varios selectores conocidos y, como respaldo, un
// patrón de URL con el token de descarga incrustado en el HTML/JS de la página.
function extractFireloadDirect(body, base) {
  if (!body) return null;
  const $ = load(body);
  const selector =
    'a#downloadButton, a.download-button, a[href*="/download/"], a[data-download-url], button[data-url], a.btn-download';
  const link = $(selector).first();
  const fromAttr = urlCandidate(
    link.attr('data-download-url') || link.attr('data-url') || link.attr('href'),
    base,
  );
  if (fromAttr) return fromAttr;
  const pattern = /https?:\\?\/\\?\/[^"'<>\s]*fireload\.com\\?\/download\\?\/[^"'<>\s]+/i;
  const candidate = urlCandidate(body.match(pattern)?.[0]?.replaceAll('\\/', '/'), base);
  return candidate;
}

function extractMediafireTitle(body) {
  if (!body) return '';
  const $ = load(body);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text();
  return (title || '').replace(/\s+/g, ' ').trim();
}

function extractMediafireDirect(body, base) {
  if (!body) return null;
  const $ = load(body);
  const fromButton = urlCandidate($('#downloadButton').attr('href'), base);
  if (fromButton && MEDIAFIRE_DIRECT.test(new URL(fromButton).hostname)) return fromButton;
  const pattern = /https:\\?\/\\?\/download\d+\\?\.mediafire\\?\.com\\?\/[^"'<>\s]+/i;
  const candidate = urlCandidate(body.match(pattern)?.[0]?.replaceAll('\\/', '/'), base);
  if (candidate && MEDIAFIRE_DIRECT.test(new URL(candidate).hostname)) return candidate;
  return null;
}

async function resolveUrl(input) {
  const { default: normalizeUrl } = await import('normalize-url');
  let current = await validatePublicUrl(normalizeUrl(input.trim(), { stripAuthentication: true }));
  const visited = new Set();
  const chain = [];
  let usedPageExtraction = false;
  for (let step = 0; step < 12; step += 1) {
    if (visited.has(current.href)) throw new Error('Se detectó un ciclo de redirecciones.');
    visited.add(current.href);
    const response = await requestPage(current);
    chain.push({
      url: current.href,
      status: response.status,
      method: step ? 'redirect' : 'initial',
    });
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = await validatePublicUrl(new URL(response.location, current).href);
      continue;
    }
    if (response.binary) {
      return {
        input,
        finalUrl: current.href,
        domain: getDomain(current.hostname) || current.hostname,
        chain,
        mode: usedPageExtraction ? 'page-link' : chain.length > 1 ? 'short-url' : 'direct',
      };
    }
    const html = response.contentType.includes('html') ? response.body : '';
    if (MEDIAFIRE_FILE.test(current.hostname)) {
      const direct = extractMediafireDirect(html, current);
      const title = extractMediafireTitle(html);
      if (direct) {
        chain[chain.length - 1].method = 'mediafire-direct';
        return {
          input,
          finalUrl: direct,
          domain: getDomain(current.hostname),
          chain,
          mode: 'mediafire-direct',
          title,
        };
      }
      return {
        input,
        finalUrl: current.href,
        domain: getDomain(current.hostname),
        chain,
        mode: 'mediafire-page',
        title,
      };
    }
    if (FIRELOAD_HOST.test(current.hostname)) {
      const direct = extractFireloadDirect(html, current);
      const title = extractFireloadTitle(html);
      if (direct) {
        chain[chain.length - 1].method = 'fireload-direct';
        return {
          input,
          finalUrl: direct,
          domain: getDomain(current.hostname),
          chain,
          mode: 'fireload-direct',
          title,
        };
      }
      const session = await resolveFireloadSession(current, html, response.cookies);
      if (session) {
        chain[chain.length - 1].method = 'fireload-direct';
        return {
          input,
          finalUrl: session,
          domain: getDomain(current.hostname),
          chain,
          mode: 'fireload-direct',
          title,
        };
      }
      return {
        input,
        finalUrl: current.href,
        domain: getDomain(current.hostname),
        chain,
        mode: 'fireload-page',
        title,
      };
    }
    const extracted = extractDestination(current, html);
    if (extracted && !visited.has(extracted.url)) {
      usedPageExtraction = true;
      chain[chain.length - 1].method = extracted.method;
      if (MEDIAFIRE_DIRECT.test(new URL(extracted.url).hostname)) {
        return {
          input,
          finalUrl: extracted.url,
          domain: getDomain(current.hostname) || current.hostname,
          chain,
          mode: 'mediafire-direct',
        };
      }
      if (FIRELOAD_DIRECT.test(new URL(extracted.url).hostname)) {
        return {
          input,
          finalUrl: extracted.url,
          domain: getDomain(current.hostname) || current.hostname,
          chain,
          mode: 'fireload-direct',
        };
      }
      current = await validatePublicUrl(extracted.url);
      continue;
    }
    return {
      input,
      finalUrl: current.href,
      domain: getDomain(current.hostname) || current.hostname,
      chain,
      mode: usedPageExtraction ? 'advertising-page' : chain.length > 1 ? 'short-url' : 'direct',
    };
  }
  throw new Error('La URL superó el máximo de 12 redirecciones.');
}

module.exports = {
  resolveUrl,
  validatePublicUrl,
  isPrivateAddress,
  requestPage,
  isTextualContentType,
  extractMediafireDirect,
  extractMediafireTitle,
  extractFireloadDirect,
  extractFireloadTitle,
  extractFireloadDlink,
  resolveFireloadSession,
  // Helpers puros expuestos para pruebas unitarias.
  urlCandidate,
  extractDestination,
};
