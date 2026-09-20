const { requestPage } = require('./urlResolver.cjs');

const ENGINES = ['google', 'bing', 'duckduckgo', 'wikimedia'];
const RESULTS_PER_PAGE = 24;
const MAX_PAGE = 10;

function cleanText(value) {
  return String(value || '')
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function isImageUrl(value) {
  return (
    typeof value === 'string' &&
    /^https?:\/\//i.test(value) &&
    !/google\.com|gstatic\.com\/og|favicon|logo/i.test(value)
  );
}

function uniqueImages(results) {
  const seen = new Set();
  return results.filter((result) => {
    if (!result || !isImageUrl(result.imageUrl)) return false;
    if (seen.has(result.imageUrl)) return false;
    seen.add(result.imageUrl);
    return true;
  });
}

function extractGoogleImages(body) {
  if (!body) return [];
  const found = [];
  const pattern = /"ou"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(body)) && found.length < 60) {
    const imageUrl = cleanText(match[1]);
    if (!isImageUrl(imageUrl)) continue;
    const ahead = body.slice(match.index, match.index + 4000);
    const thumbnail = cleanText(ahead.match(/"tu"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]);
    const pageUrl = cleanText(ahead.match(/"ru"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]);
    const title = cleanText(ahead.match(/"pt"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]);
    found.push({
      imageUrl,
      thumbnailUrl: /^https?:\/\//i.test(thumbnail) ? thumbnail : imageUrl,
      title: title || '',
      source: pageUrl ? safeHostname(pageUrl) : 'Google',
      pageUrl: /^https?:\/\//i.test(pageUrl) ? pageUrl : '',
    });
  }
  return uniqueImages(found).slice(0, RESULTS_PER_PAGE);
}

function extractDuckDuckGoToken(body) {
  if (!body) return null;
  return body.match(/vqd\s*=\s*['"]([^'"]+)['"]/)?.[1] || body.match(/vqd=([\d-]+)/)?.[1] || null;
}

function extractDuckDuckGoImages(body) {
  if (!body) return [];
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  const results = Array.isArray(payload.results) ? payload.results : [];
  return uniqueImages(
    results.map((item) => ({
      imageUrl: String(item.image || ''),
      thumbnailUrl: String(item.thumbnail || item.image || ''),
      title: String(item.title || ''),
      source: String(item.source || safeHostname(String(item.url || '')) || 'DuckDuckGo'),
      pageUrl: String(item.url || ''),
      width: Number(item.width) || undefined,
      height: Number(item.height) || undefined,
    })),
  ).slice(0, RESULTS_PER_PAGE);
}

function extractWikimediaImages(body) {
  if (!body) return [];
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  const pages = payload?.query?.pages;
  if (!Array.isArray(pages)) return [];
  return uniqueImages(
    pages.flatMap((page) => {
      const info = page?.imageinfo?.[0];
      if (!info?.url) return [];
      return [
        {
          imageUrl: canonicalImageUrl(info.url),
          thumbnailUrl: canonicalImageUrl(info.thumburl || info.url),
          title: cleanText(
            String(page.title || '')
              .replace(/^File:/, '')
              .replace(/\.[a-z]+$/i, ''),
          ),
          source: 'Wikimedia Commons',
          pageUrl: String(info.descriptionurl || ''),
          width: Number(info.width) || undefined,
          height: Number(info.height) || undefined,
        },
      ];
    }),
  ).slice(0, RESULTS_PER_PAGE);
}

function safeHostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function canonicalImageUrl(value) {
  const text = String(value || '');
  const cut = text.search(/[?#]/);
  return cut < 0 ? text : text.slice(0, cut);
}

function extractBingImages(body) {
  if (!body) return [];
  const found = [];
  const pattern = /m="(\{&quot;.*?\})"/g;
  let match;
  while ((match = pattern.exec(body)) && found.length < 60) {
    let data;
    try {
      data = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    } catch {
      continue;
    }
    if (!data || typeof data.murl !== 'string') continue;
    found.push({
      imageUrl: data.murl,
      thumbnailUrl: typeof data.turl === 'string' && data.turl ? data.turl : data.murl,
      title: typeof data.t === 'string' ? data.t : '',
      source: safeHostname(typeof data.purl === 'string' ? data.purl : '') || 'Bing',
      pageUrl: typeof data.purl === 'string' ? data.purl : '',
    });
  }
  return uniqueImages(found).slice(0, RESULTS_PER_PAGE);
}

async function fetchRaw(url, maxBytes = 3 * 1024 * 1024, options = {}) {
  const target = new URL(url);
  const response = await requestPage(target, maxBytes, options);
  if (response.status >= 300 && response.status < 400 && response.location) {
    return fetchRaw(new URL(response.location, target).href, maxBytes, options);
  }
  if (response.status < 200 || response.status >= 400)
    throw new Error(`El buscador respondió con estado HTTP ${response.status}.`);
  if (!response.body) throw new Error('El buscador no devolvió resultados.');
  return response;
}

async function fetchText(url, maxBytes, options) {
  return (await fetchRaw(url, maxBytes, options)).body;
}

function responseCookies(response) {
  const raw = response?.headers?.['set-cookie'];
  if (!raw) return '';
  return (Array.isArray(raw) ? raw : [raw]).map((entry) => String(entry).split(';')[0]).join('; ');
}

async function searchGoogle(query, page) {
  const start = (page - 1) * RESULTS_PER_PAGE;
  const url =
    `https://www.google.com/search?q=${encodeURIComponent(query)}` +
    `&tbm=isch&hl=es&safe=active&start=${start}`;
  const body = await fetchText(new URL(url));
  const results = extractGoogleImages(body);
  if (!results.length) throw new Error('Google no devolvió imágenes (posible bloqueo temporal).');
  return results;
}

async function searchDuckDuckGo(query, page) {
  const tokenResponse = await fetchRaw(
    new URL(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=images&iax=images&ia=images`,
    ),
  );
  const token = extractDuckDuckGoToken(tokenResponse.body);
  if (!token) throw new Error('No se pudo iniciar la búsqueda en DuckDuckGo.');
  const cookies = responseCookies(tokenResponse);
  const offset = (page - 1) * 100;
  const url =
    `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}` +
    `&vqd=${encodeURIComponent(token)}&f=,,,,,&p=${page}&s=${offset}`;
  let body;
  try {
    body = await fetchText(new URL(url), undefined, {
      headers: {
        ...(cookies ? { cookie: cookies } : {}),
        referer: 'https://duckduckgo.com/',
        accept: 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
  } catch (error) {
    throw new Error(`${error.message} Prueba con otro motor de búsqueda.`);
  }
  const results = extractDuckDuckGoImages(body);
  if (!results.length) throw new Error('DuckDuckGo no devolvió imágenes para esta búsqueda.');
  return results;
}

async function searchBing(query, page) {
  const first = (page - 1) * 35 + 1;
  const url =
    `https://www.bing.com/images/search?q=${encodeURIComponent(query)}` +
    `&FORM=HDRSC2&first=${first}`;
  const body = await fetchText(new URL(url));
  const results = extractBingImages(body);
  if (!results.length) throw new Error('Bing no devolvió imágenes para esta búsqueda.');
  return results;
}

async function searchWikimedia(query, page) {
  const offset = (page - 1) * RESULTS_PER_PAGE;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: String(RESULTS_PER_PAGE),
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '320',
  });
  const body = await fetchText(new URL(`https://commons.wikimedia.org/w/api.php?${params}`));
  const results = extractWikimediaImages(body);
  if (!results.length) throw new Error('Wikimedia Commons no tiene imágenes para esta búsqueda.');
  return results;
}

async function searchImages({ query, engine = 'bing', page = 1 }) {
  const text = String(query || '').trim();
  if (!text) throw new Error('Escribe un término para buscar imágenes.');
  if (!ENGINES.includes(engine)) throw new Error('Motor de búsqueda no soportado.');
  const safePage = Math.min(Math.max(Number(page) || 1, 1), MAX_PAGE);
  if (engine === 'google') return searchGoogle(text, safePage);
  if (engine === 'duckduckgo') return searchDuckDuckGo(text, safePage);
  if (engine === 'wikimedia') return searchWikimedia(text, safePage);
  return searchBing(text, safePage);
}

module.exports = {
  ENGINES,
  RESULTS_PER_PAGE,
  searchImages,
  extractGoogleImages,
  extractBingImages,
  extractDuckDuckGoToken,
  extractDuckDuckGoImages,
  extractWikimediaImages,
};
