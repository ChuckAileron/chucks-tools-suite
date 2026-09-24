const { load } = require('cheerio');
const { requestPage } = require('./urlResolver.cjs');

// Implementación del microservicio "juegos-launchbox-metadata": busca la
// metadata (portada, fecha de lanzamiento, publisher y developer) de un
// videojuego en el GamesDB de LaunchBox usando nombre + plataforma como
// entrada, igual que la versión CLI del workspace vecino.

const BASE_URL = 'https://gamesdb.launchbox-app.com';
const REQUEST_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- HTTP -------------------------------------------------------------------

async function httpGet(url, isCancelled) {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    if (isCancelled && isCancelled()) throw new Error('CANCELLED');
    const response = await requestPage(new URL(current));
    const status = response.status || 0;
    if (status >= 300 && status < 400 && response.location) {
      current = new URL(response.location, current).href;
      continue;
    }
    return response;
  }
  throw new Error('Demasiadas redirecciones.');
}

// --- Normalización de textos -------------------------------------------------

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(raw) {
  return (raw || '').trim().split('(')[0].trim();
}

function candidateQueries(title) {
  const queries = [];
  const add = (query) => {
    const trimmed = (query || '').trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };
  add(title);

  const words = title.split(' ').filter(Boolean);
  add(title.replace(/\s+(Part|Volume|Vol\.?|Chapter|Episode)\s*[ivxldcm0-9]*\s*$/i, '').trim());

  if (words.length > 2) {
    const from = Math.min(words.length - 1, 3);
    for (let n = from; n >= 2 && queries.length < 4; n -= 1) {
      add(words.slice(0, n).join(' '));
    }
  }
  return queries;
}

// --- Resultados de búsqueda ---------------------------------------------------

function parseSearchResults($) {
  const results = [];
  $('a.list-item.link-no-underline[href*="/games/details/"]').each((_, el) => {
    const card = $(el);
    const href = card.attr('href');
    const title = card.find('.cardTitle h3').first().text().trim();
    const platform = card.find('.cardTitle p').first().text().trim();
    if (!href || !title) return;
    results.push({ href, title, platform });
  });
  return results;
}

function scoreMatch(result, originalName, cleanTitle, platform) {
  const nr = normalize(result.title);
  const no = normalize(originalName);
  const nc = normalize(cleanTitle);

  let nameScore = 0;
  if (nr === no || nr === nc) {
    nameScore = 200;
  } else if (nr.includes(nc) || nc.includes(nr) || nr.includes(no) || no.includes(nr)) {
    nameScore = 80;
  } else {
    const tokens = nc.split(' ').filter((token) => token.length > 2);
    const hits = tokens.filter((token) => nr.includes(token)).length;
    if (tokens.length && hits / tokens.length >= 0.6) nameScore = 50;
  }

  let platformMatch = false;
  if (platform) {
    const np = normalize(result.platform);
    const npc = normalize(platform);
    platformMatch = np === npc || np.includes(npc) || npc.includes(np);
  }

  return { nameScore, platformMatch, total: nameScore + (platformMatch ? 40 : 0) };
}

function pickBestResult(results, originalName, cleanTitle, platform) {
  const scored = [];
  for (const result of results) {
    const score = scoreMatch(result, originalName, cleanTitle, platform);
    if (score.nameScore >= 80) scored.push({ result, score });
  }
  if (!scored.length) return null;

  const withPlatform = scored.filter((entry) => entry.score.platformMatch);
  if (withPlatform.length) {
    withPlatform.sort((a, b) => b.score.total - a.score.total);
    return withPlatform[0].result;
  }

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored[0].score.nameScore === 200 ? scored[0].result : null;
}

// --- Payload de Nuxt del detalle ----------------------------------------------

function decodeNuxtPayload(raw) {
  const payload = JSON.parse(raw);
  const seen = new Set();

  function ref(i) {
    if (i === -1) return null;
    if (i < 0 || i >= payload.length) return i;
    const value = payload[i];
    if (seen.has(i)) return value;
    seen.add(i);

    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      if (
        value.length === 2 &&
        typeof value[1] === 'number' &&
        ['ShallowReactive', 'Reactive', 'EmptyRef', 'GameDetailsEntity', 'Map', 'Set'].includes(
          value[0],
        )
      ) {
        return ref(value[1]);
      }
      return value.map((entry) => (typeof entry === 'number' ? ref(entry) : entry));
    }

    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = typeof val === 'number' ? ref(val) : val;
    }
    return out;
  }

  return ref(0);
}

function extractGamePayload(html) {
  const marker = html.indexOf('<script type="application/json" data-nuxt-data="nuxt-app"');
  const startSrc = marker >= 0 ? marker : html.indexOf('id="__NUXT_DATA__"');
  if (startSrc < 0) return null;

  const contentStart = html.indexOf('>', startSrc) + 1;
  const endIdx = html.indexOf('</script>', contentStart);
  if (contentStart <= 0 || endIdx < 0) return null;

  const root = decodeNuxtPayload(html.slice(contentStart, endIdx));

  const resources = root && typeof root.data === 'object' && root.data !== null ? root.data : {};
  for (const [key, value] of Object.entries(resources)) {
    if (
      key.startsWith('game/details/') &&
      !key.endsWith('lockfields') &&
      value &&
      typeof value === 'object' &&
      typeof value.name === 'string'
    ) {
      return value;
    }
  }
  return null;
}

function pickBoxart(images) {
  if (!Array.isArray(images)) return null;

  const fronts = images.filter((img) => img && /^Box - Front/i.test(img.imageTypeName || ''));
  if (!fronts.length) return null;

  const regionOrder = ['North America', 'World', 'Europe', 'Japan'];
  const regionRank = (region) => {
    const idx = regionOrder.indexOf(region || '');
    return idx === -1 ? regionOrder.length : idx;
  };
  const typeRank = (img) => (/reconstructed/i.test(`${img.imageTypeName || ''}`) ? 1 : 0);

  fronts.sort(
    (a, b) =>
      regionRank(a.regionName) - regionRank(b.regionName) ||
      typeRank(a) - typeRank(b) ||
      (b.height || 0) * (b.width || 0) - (a.height || 0) * (a.width || 0),
  );

  return fronts[0];
}

function extractDetails(game) {
  const boxart = pickBoxart(game.gameImages);
  const publishers = (game.gamePublishers || [])
    .map((entry) => entry && entry.name)
    .filter(Boolean);
  const developers = (game.gameDevelopers || [])
    .map((entry) => entry && entry.name)
    .filter(Boolean);

  return {
    boxartUrl:
      boxart && boxart.imageFileName
        ? `https://images.launchbox-app.com//${boxart.imageFileName}`
        : '',
    releaseDate: game.releaseDate || '',
    publisher: publishers.join(', '),
    developer: developers.join(', '),
  };
}

// --- Búsqueda de un juego -------------------------------------------------------

async function searchGame(cleanGameTitle, originalName, platform, isCancelled) {
  for (const query of candidateQueries(cleanGameTitle)) {
    if (isCancelled && isCancelled()) throw new Error('CANCELLED');
    const searchResponse = await httpGet(
      `${BASE_URL}/games/results?title=${encodeURIComponent(query)}`,
      isCancelled,
    );
    if (searchResponse.status === 200) {
      const results = parseSearchResults(load(searchResponse.body));
      const best = pickBestResult(results, originalName, cleanGameTitle, platform);
      if (best) return best;
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return null;
}

async function fetchGameDetails(href, isCancelled) {
  const detailsUrl = href.startsWith('http') ? href : BASE_URL + href;
  const detailsResponse = await httpGet(detailsUrl, isCancelled);
  if (detailsResponse.status !== 200) return null;

  const game = extractGamePayload(detailsResponse.body);
  if (!game) return null;

  return extractDetails(game);
}

async function searchGameMetadata({ name, platform }, isCancelled) {
  const originalName = String(name || '').trim();
  const cleanGameTitle = cleanName(originalName);
  if (!cleanGameTitle) return { found: false };

  const best = await searchGame(cleanGameTitle, originalName, platform, isCancelled);
  if (!best) return { found: false };

  const details = await fetchGameDetails(best.href, isCancelled);
  if (!details) return { found: false };

  return { found: true, title: best.title, platform: best.platform, metadata: details };
}

// --- CSV ---------------------------------------------------------------------

// Parseo RFC-4180 básico: soporta comillas, comas y saltos de línea dentro de
// campos entrecomillados, BOM y CRLF. Devuelve objetos clave-valor por fila.
function parseCsv(text) {
  const buffer = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  let i = 0;
  const length = buffer.length;
  const flushField = () => {
    row.push(field);
    field = '';
  };
  while (i < length) {
    const ch = buffer[i];
    if (quoted) {
      if (ch === '"') {
        if (buffer[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      flushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      flushField();
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    flushField();
    rows.push(row);
  }

  const nonEmpty = rows.filter((entry) => entry.some((value) => value.trim() !== ''));
  const headers = (nonEmpty.shift() || []).map((header) => header.trim());
  return {
    headers,
    rows: nonEmpty.map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? '';
      });
      return record;
    }),
  };
}

function stringifyCsv(rows, headers) {
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(
      headers.map((header) => escape(row[header] === undefined ? '' : row[header])).join(','),
    );
  }
  return lines.join('\r\n');
}

const NAME_COLUMN_RE = /^(nombre|name|título|titulo|title|juego|game)$/i;
const PLATFORM_COLUMN_RE = /^(plataforma|platform)$/i;

function detectCsvKeyColumns(headers) {
  const nameColumn = headers.find((header) => NAME_COLUMN_RE.test(header));
  const platformColumn = headers.find((header) => PLATFORM_COLUMN_RE.test(header));
  if (!nameColumn || !platformColumn) return null;
  return { nameColumn, platformColumn };
}

// Detecta las columnas de metadatos en un CSV de resultados (el generado por
// esta misma herramienta o uno manual con esos campos).
const BOXART_COLUMN_RE = /^(boxart|imagen|image|portada|caratula)/i;
const RELEASE_COLUMN_RE =
  /^(release[ _-]?(date|day)|fecha(?:[ _-]+de)?[ _-]+(lanzamiento|estreno)|lanzamiento)/i;
const PUBLISHER_COLUMN_RE = /^(publisher|editor|public[ae]dora)/i;
const DEVELOPER_COLUMN_RE = /^(developer|desarrollador|desarrollos?|estudio)|^(developer)/i;

function detectMetadataColumns(headers) {
  const boxartColumn = headers.find((header) => BOXART_COLUMN_RE.test(header));
  const releaseDateColumn = headers.find((header) => RELEASE_COLUMN_RE.test(header));
  const publisherColumn = headers.find((header) => PUBLISHER_COLUMN_RE.test(header));
  const developerColumn = headers.find((header) => DEVELOPER_COLUMN_RE.test(header));
  return {
    boxartColumn: boxartColumn || null,
    releaseDateColumn: releaseDateColumn || null,
    publisherColumn: publisherColumn || null,
    developerColumn: developerColumn || null,
  };
}

// --- Coincidencia con los ítems de la colección -------------------------------

// La llave es "nombre + plataforma" con valores exactos (tras recortar
// espacios), tal como los guarda la base de datos de la sección Colección.
function matchRowsToItems({ items, rows, platformColumn }) {
  const norm = (value) => String(value ?? '').trim();
  const matched = [];
  const missing = [];
  for (const row of rows) {
    const name = norm(row.name);
    const platform = norm(row.platform);
    const item = items.find(
      (candidate) =>
        norm(candidate.name) === name &&
        norm(candidate.values?.[platformColumn] ?? '') === platform,
    );
    if (item) matched.push({ name, platform, itemId: item.id, item });
    else missing.push({ name, platform });
  }
  return { matched, missing };
}

// Genera el "parche" a enviar a collectionManager.updateItem con la metadata
// de LaunchBox, conservando el resto de columnas del ítem.
function buildItemPatch({ current, mapping, metadata }) {
  const values = { ...(current?.values || {}) };
  if (mapping?.releaseDateColumn && metadata?.releaseDate) {
    values[mapping.releaseDateColumn] = metadata.releaseDate.slice(0, 10);
  }
  if (mapping?.publisherColumn && metadata?.publisher) {
    values[mapping.publisherColumn] = metadata.publisher;
  }
  if (mapping?.developerColumn && metadata?.developer) {
    values[mapping.developerColumn] = metadata.developer;
  }
  const patch = { values };
  if (metadata?.boxartUrl) patch.imageUrl = metadata.boxartUrl;
  return patch;
}

// --- Construcción del CSV de resultados ---------------------------------------

const RESULT_CSV_HEADERS = [
  'Name',
  'Platform',
  'Found',
  'LaunchBox Title',
  'Boxart_URL',
  'Release_Date',
  'Publisher',
  'Developer',
];

function buildResultCsvRows(results) {
  return results.map((entry) => ({
    Name: entry.name,
    Platform: entry.platform,
    Found: entry.found ? 'Sí' : 'No',
    'LaunchBox Title': entry.title || '',
    Boxart_URL: entry.metadata?.boxartUrl || '',
    Release_Date: entry.metadata?.releaseDate || '',
    Publisher: entry.metadata?.publisher || '',
    Developer: entry.metadata?.developer || '',
  }));
}

module.exports = {
  normalize,
  cleanName,
  candidateQueries,
  scoreMatch,
  pickBestResult,
  parseSearchResults,
  decodeNuxtPayload,
  extractGamePayload,
  pickBoxart,
  extractDetails,
  searchGameMetadata,
  parseCsv,
  stringifyCsv,
  detectCsvKeyColumns,
  detectMetadataColumns,
  matchRowsToItems,
  buildItemPatch,
  RESULT_CSV_HEADERS,
  buildResultCsvRows,
};
