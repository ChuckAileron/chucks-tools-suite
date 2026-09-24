const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalize,
  cleanName,
  candidateQueries,
  scoreMatch,
  pickBestResult,
  pickBoxart,
  decodeNuxtPayload,
  extractGamePayload,
  extractDetails,
  parseCsv,
  stringifyCsv,
  detectCsvKeyColumns,
  detectMetadataColumns,
  matchRowsToItems,
  buildItemPatch,
  RESULT_CSV_HEADERS,
  buildResultCsvRows,
} = require('../electron/launchboxMetadata.cjs');

test('normalize elimina acentos, símbolos y colapsa espacios', () => {
  assert.equal(normalize('Pokémon™®!'), 'pokemon');
  assert.equal(normalize('  Super   Mario  World  '), 'super mario world');
  assert.equal(normalize('Métroid PRIME 3'), 'metroid prime 3');
  assert.equal(normalize(''), '');
});

test('cleanName quita el sufijo entre paréntesis y espacios', () => {
  assert.equal(cleanName('Super Mario World (USA)'), 'Super Mario World');
  assert.equal(
    cleanName('Cartoon Network: Punch Time Explosion (879278360082)'),
    'Cartoon Network: Punch Time Explosion',
  );
  assert.equal(cleanName('  Zelda  '), 'Zelda');
});

test('candidateQueries genera variantes de búsqueda', () => {
  const queries = candidateQueries('Super Mario World');
  assert.ok(queries.includes('Super Mario World'));
  const stripped = candidateQueries('Ratchet & Clank Part 3');
  assert.ok(stripped.includes('Ratchet & Clank'));
  assert.ok(stripped.every((query) => query.trim().length > 0));
  const compact = candidateQueries('Star War');
  assert.ok(compact.includes('Star War'));
});

test('parseCsv maneja comas, comillas, BOM y CRLF', () => {
  const csv =
    '\uFEFFName,Platform,Publisher\r\n"Super Mario World","SNES","Nintendo"; no\r\n"Adventure Time, Parte 2","Nintendo 3DS","Outright Games"\r\n';
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ['Name', 'Platform', 'Publisher']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].Name, 'Super Mario World');
  assert.equal(parsed.rows[0].Platform, 'SNES');
  assert.equal(parsed.rows[1].Name, 'Adventure Time, Parte 2');
});

test('parseCsv soporta campos entrecomillados multilínea y quita filas vacías', () => {
  const csv = 'a,b\n"línea\npartida",2\n\n,  \n"x", "y"\n';
  const parsed = parseCsv(csv);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].a, 'línea\npartida');
  assert.equal(parsed.rows[1].a, 'x');
});

test('parseCsv maneja comillas dobles escapadas', () => {
  const parsed = parseCsv('n\n"dijo ""hola""",2');
  assert.equal(parsed.rows[0].n, 'dijo "hola"');
});

test('stringifyCsv escapa correctamente y el resultado es parseable', () => {
  const headers = ['Name', 'Platform'];
  const rows = [{ Name: 'Adventure Time, Parte 2', Platform: 'Nintendo 3DS' }];
  const text = stringifyCsv(rows, headers);
  assert.equal(text, 'Name,Platform\r\n"Adventure Time, Parte 2",Nintendo 3DS');
  assert.deepEqual(parseCsv(text).rows, rows);
});

test('detectCsvKeyColumns reconoce nombres en español e inglés', () => {
  assert.deepEqual(detectCsvKeyColumns(['Name', 'Platform']), {
    nameColumn: 'Name',
    platformColumn: 'Platform',
  });
  assert.deepEqual(detectCsvKeyColumns(['Título', 'Plataforma']), {
    nameColumn: 'Título',
    platformColumn: 'Plataforma',
  });
  assert.equal(detectCsvKeyColumns(['Title']), null);
});

test('detectMetadataColumns reconoce las columnas de resultados', () => {
  const found = detectMetadataColumns([
    'Name',
    'Platform',
    'Boxart_URL',
    'Release_Date',
    'Publisher',
    'Developer',
  ]);
  assert.equal(found.boxartColumn, 'Boxart_URL');
  assert.equal(found.releaseDateColumn, 'Release_Date');
  assert.equal(found.publisherColumn, 'Publisher');
  assert.equal(found.developerColumn, 'Developer');
  const spanish = detectMetadataColumns([
    'Nombre',
    'Plataforma',
    'Imagen',
    'Fecha de lanzamiento',
    'Editor',
    'Desarrollador',
  ]);
  assert.equal(spanish.boxartColumn, 'Imagen');
  assert.equal(spanish.releaseDateColumn, 'Fecha de lanzamiento');
  assert.equal(spanish.publisherColumn, 'Editor');
  assert.equal(spanish.developerColumn, 'Desarrollador');
});

test('matchRowsToItems empareja por llave exacta nombre + plataforma', () => {
  const items = [
    { id: 1, name: 'Metroid', values: { plataforma: 'NES' } },
    { id: 2, name: 'Metroid', values: { plataforma: 'Game Boy Advance' } },
    { id: 3, name: '  Zelda  ', values: {} },
  ];
  const rows = [
    { name: 'Metroid', platform: 'NES' },
    { name: 'Metroid', platform: 'Nintendo 64' },
    { name: 'Zelda', platform: '' },
  ];
  const { matched, missing } = matchRowsToItems({ items, rows, platformColumn: 'plataforma' });
  assert.equal(matched.length, 2);
  assert.deepEqual(matched[0].itemId, 1);
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0], { name: 'Metroid', platform: 'Nintendo 64' });
});

test('buildItemPatch conserva valores y solo pisa columnas mapeadas', () => {
  const patch = buildItemPatch({
    current: { values: { genero: 'Aventura', plataforma: 'NES' } },
    mapping: {
      releaseDateColumn: 'fecha_lanzamiento',
      publisherColumn: 'editor',
      developerColumn: '',
    },
    metadata: {
      boxartUrl: 'https://img/x.png',
      releaseDate: '1986-08-06T00:00:00',
      publisher: 'Nintendo',
      developer: 'X',
    },
  });
  assert.deepEqual(patch.values, {
    genero: 'Aventura',
    plataforma: 'NES',
    fecha_lanzamiento: '1986-08-06',
    editor: 'Nintendo',
  });
  assert.equal(patch.imageUrl, 'https://img/x.png');
});

test('buildItemPatch no toca nada si no hay metadata', () => {
  const patch = buildItemPatch({
    current: { values: { genero: 'Aventura' } },
    mapping: { releaseDateColumn: 'fecha', publisherColumn: 'editor', developerColumn: 'dev' },
    metadata: { boxartUrl: '', releaseDate: '', publisher: '', developer: '' },
  });
  assert.deepEqual(patch.values, { genero: 'Aventura' });
  assert.equal(patch.imageUrl, undefined);
});

test('scoreMatch premia coincidencia exacta y plataforma', () => {
  const result = { href: '/x', title: 'Super Mario World', platform: 'Super Nintendo' };
  const exact = scoreMatch(result, 'Super Mario World', 'Super Mario World', 'Super Nintendo');
  assert.equal(exact.nameScore, 200);
  assert.equal(exact.platformMatch, true);
  const partial = scoreMatch(result, 'Super Mario World 2', 'Super Mario World 2', '');
  assert.equal(partial.nameScore, 80);
  const weak = scoreMatch(result, 'Zelda', 'Zelda', '');
  assert.equal(weak.nameScore, 0);
});

test('pickBestResult elige coincidencia con plataforma y descarta débiles', () => {
  const results = [
    { href: '/a', title: 'Super Mario World', platform: 'PlayStation' },
    { href: '/b', title: 'Super Mario World', platform: 'Super Nintendo' },
  ];
  const best = pickBestResult(results, 'Super Mario World', 'Super Mario World', 'Super Nintendo');
  assert.equal(best.href, '/b');
  assert.equal(pickBestResult(results, 'Zelda', 'Zelda', ''), null);
});

test('pickBoxart prefiere tapa frontal de región Norte América', () => {
  const images = [
    {
      imageFileName: 'back.png',
      imageTypeName: 'Box - Back',
      regionName: 'North America',
      width: 200,
      height: 300,
    },
    {
      imageFileName: 'front-jp.png',
      imageTypeName: 'Box - Front',
      regionName: 'Japan',
      width: 200,
      height: 300,
    },
    {
      imageFileName: 'front-na.png',
      imageTypeName: 'Box - Front',
      regionName: 'North America',
      width: 200,
      height: 300,
    },
  ];
  assert.equal(pickBoxart(images).imageFileName, 'front-na.png');
  assert.equal(pickBoxart([]), null);
});

test('decodeNuxtPayload resuelve la estructura de datos de Nuxt', () => {
  const payload = [
    ['ShallowReactive', 1],
    { data: 2 },
    { 'game/details/5': 3, 'game/details/5lockfields': 8 },
    {
      name: 'Metroid',
      releaseDate: '1986-08-06T00:00:00',
      gameImages: 4,
      gamePublishers: 5,
      gameDevelopers: 6,
    },
    [7],
    [{ name: 'Nintendo' }],
    [{ name: 'Nintendo R&D1' }],
    {
      imageFileName: 'metroid-na.png',
      imageTypeName: 'Box - Front',
      regionName: 'North America',
      width: 220,
      height: 320,
    },
    { lockfields: true },
  ];
  const decoded = decodeNuxtPayload(JSON.stringify(payload));
  assert.equal(decoded.data['game/details/5'].name, 'Metroid');
});

test('extractGamePayload y extractDetails devuelven la metadata del juego', () => {
  const payload = [
    ['ShallowReactive', 1],
    { data: 2 },
    { 'game/details/5': 3, 'game/details/5lockfields': 8 },
    {
      name: 'Metroid',
      releaseDate: '1986-08-06T00:00:00',
      gameImages: 4,
      gamePublishers: 5,
      gameDevelopers: 6,
    },
    [7],
    [{ name: 'Nintendo' }],
    [{ name: 'Nintendo R&D1' }],
    {
      imageFileName: 'metroid-na.png',
      imageTypeName: 'Box - Front',
      regionName: 'North America',
      width: 220,
      height: 320,
    },
    { lockfields: true },
  ];
  const html = `<html><head><script type="application/json" data-nuxt-data="nuxt-app">${JSON.stringify(payload)}</script></head></html>`;
  const game = extractGamePayload(html);
  assert.equal(game.name, 'Metroid');
  const details = extractDetails(game);
  assert.equal(details.boxartUrl, 'https://images.launchbox-app.com//metroid-na.png');
  assert.equal(details.releaseDate, '1986-08-06T00:00:00');
  assert.equal(details.publisher, 'Nintendo');
  assert.equal(details.developer, 'Nintendo R&D1');
  assert.equal(extractGamePayload('<html></html>'), null);
});

test('buildResultCsvRows genera las filas del CSV de resultados', () => {
  const rows = buildResultCsvRows([
    {
      name: 'Metroid',
      platform: 'NES',
      found: true,
      title: 'Metroid',
      metadata: {
        boxartUrl: 'https://img/a.png',
        releaseDate: '1986-08-06',
        publisher: 'Nintendo',
        developer: 'Nintendo R&D1',
      },
    },
    { name: 'Perdido', platform: 'SNES', found: false },
  ]);
  assert.deepEqual(RESULT_CSV_HEADERS, [
    'Name',
    'Platform',
    'Found',
    'LaunchBox Title',
    'Boxart_URL',
    'Release_Date',
    'Publisher',
    'Developer',
  ]);
  assert.equal(rows[0].Found, 'Sí');
  assert.equal(rows[1].Found, 'No');
  assert.equal(rows[1]['LaunchBox Title'], '');
});
