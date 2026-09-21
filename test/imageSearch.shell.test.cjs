const test = require('node:test');
const assert = require('node:assert/strict');
const { installHooks } = require('./helpers/moduleHooks.cjs');

const state = {
  responses: [],
  calls: [],
};

function resetStubs() {
  state.responses = [];
  state.calls = [];
}

function queueResponse(response) {
  state.responses.push({ predicate: null, response });
}

function respondFor(predicate, response) {
  state.responses.push({ predicate, response });
}

async function nextResponse(url, maxBytes, options) {
  state.calls.push({ url, maxBytes, options });
  const index = state.responses.findIndex((entry) => !entry.predicate || entry.predicate(url));
  if (index < 0) throw new Error(`No hay respuesta simulada para ${url}`);
  const entry = state.responses[index];
  if (!entry.predicate) state.responses.splice(index, 1);
  const response = entry.response;
  if (typeof response === 'function') return response(url, maxBytes, options);
  return response;
}

installHooks({
  './urlResolver.cjs': {
    requestPage: (target, maxBytes, options) => nextResponse(String(target), maxBytes, options),
  },
});

let imageSearch;
delete require.cache[require.resolve('../electron/imageSearch.cjs')];
imageSearch = require('../electron/imageSearch.cjs');

const {
  searchImages,
  extractGoogleImages,
  extractBingImages,
  extractDuckDuckGoToken,
  extractDuckDuckGoImages,
  extractWikimediaImages,
  extractOpenverseImages,
  cleanText,
  isImageUrl,
  uniqueImages,
  safeHostname,
  canonicalImageUrl,
  responseCookies,
} = imageSearch;

function textResponse(body) {
  return { status: 200, body, headers: {} };
}

function redirectResponse(location) {
  return { status: 302, location, body: '', headers: {} };
}

const GOOGLE_IMAGE =
  '<html>AF_initDataCallback({data:[{"ou":"https://example.com/foto.jpg","tu":"https://t.gstatic.com/t","ru":"https://example.com/pagina","pt":"Foto"}]})</html>';

const BING_MARKUP =
  '<a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/full.jpg&quot;,&quot;turl&quot;:&quot;https://ts.mm.bing.net/t&quot;,&quot;t&quot;:&quot;Bing es&quot;,&quot;purl&quot;:&quot;https://origen.com/nota&quot;}"></a>';

test('fetchRaw sigue redirecciones y lanza con estados inválidos', async () => {
  resetStubs();
  queueResponse(redirectResponse('https://cdn.example.com/final.jpg'));
  queueResponse(textResponse(BING_MARKUP));
  const results = await searchImages({ query: 'gatos', engine: 'bing' });
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[1].url, 'https://cdn.example.com/final.jpg');
  assert.ok(results.length >= 1);
});

test('searchImages clama la página entre 1 y el máximo', async () => {
  resetStubs();
  respondFor((url) => url.includes('first=316'), textResponse(BING_MARKUP));
  const results = await searchImages({ query: 'gatos', engine: 'bing', page: 99 });
  assert.equal(
    state.calls[0].url,
    'https://www.bing.com/images/search?q=gatos&FORM=HDRSC2&first=316',
  );
  assert.ok(results.length >= 1);
});

test('searchGoogle usa el lote correcto y levanta blockeo', async () => {
  resetStubs();
  respondFor((url) => url.includes('start=24'), textResponse(GOOGLE_IMAGE));
  const results = await searchImages({ query: 'gatos', engine: 'google', page: 2 });
  assert.equal(results[0].imageUrl, 'https://example.com/foto.jpg');
  assert.ok(state.calls[0].url.includes('tbm=isch'));
});

test('searchGoogle informa cuando el buscador pide JavaScript', async () => {
  resetStubs();
  queueResponse(textResponse('enablejs} retry'));
  await assert.rejects(searchImages({ query: 'gatos', engine: 'google' }), /JavaScript/);
});

test('searchGoogle informa cuando no hay imágenes', async () => {
  resetStubs();
  queueResponse(textResponse('<html></html>'));
  await assert.rejects(searchImages({ query: 'gatos', engine: 'google' }), /no devolvió/);
});

test('searchDuckDuckGo obtiene token, cookies y JSON de resultados', async () => {
  resetStubs();
  let cookiesSent = '';
  respondFor(
    (url) => url.includes('duckduckgo.com/?q='),
    () => ({
      status: 200,
      body: '<script>vqd="4-12345abc";</script>',
      headers: { 'set-cookie': ['aa=vq=1; Path=/', 'bb=other=2; Path=/'] },
    }),
  );
  respondFor(
    (url) => url.includes('/i.js'),
    () => ({
      status: 200,
      body: JSON.stringify({
        results: [
          {
            image: 'https://example.com/full.jpg',
            thumbnail: 'https://example.com/thumb.jpg',
            title: 'Foto',
            url: 'https://origen.com/nota',
            source: 'Origen',
          },
        ],
      }),
      headers: {},
    }),
  );
  const results = await searchImages({ query: 'gatos', engine: 'duckduckgo' });
  assert.equal(results[0].imageUrl, 'https://example.com/full.jpg');
  assert.equal(state.calls.length, 2);
  assert.ok(state.calls[1].url.includes('vqd=4-12345abc'));
  assert.ok(state.calls[1].url.includes('s=0'));
  cookiesSent = state.calls[1].options.headers.cookie;
  assert.ok(cookiesSent.includes('aa=vq=1'));
  assert.ok(cookiesSent.includes('bb=other=2'));
});

test('searchDuckDuckGo falla sin token', async () => {
  resetStubs();
  queueResponse(textResponse('<html></html>'));
  await assert.rejects(
    searchImages({ query: 'gatos', engine: 'duckduckgo' }),
    /No se pudo iniciar/,
  );
});

test('searchDuckDuckGo reporta bloqueo 403 y errores generales', async () => {
  resetStubs();
  respondFor(
    (url) => url.includes('duckduckgo.com/?q='),
    textResponse('<script>vqd="4-1";</script>'),
  );
  respondFor(
    (url) => url.includes('/i.js'),
    () => {
      const error = new Error('HTTP 403');
      throw error;
    },
  );
  await assert.rejects(
    searchImages({ query: 'gatos', engine: 'duckduckgo' }),
    /DuckDuckGo bloqueó/,
  );

  resetStubs();
  respondFor(
    (url) => url.includes('duckduckgo.com/?q='),
    textResponse('<script>vqd="4-1";</script>'),
  );
  respondFor(
    (url) => url.includes('/i.js'),
    () => {
      throw new Error('red caída');
    },
  );
  await assert.rejects(searchImages({ query: 'gatos', engine: 'duckduckgo' }), /red caída.*motor/i);
});

test('searchDuckDuckGo informa cuando no hay resultados', async () => {
  resetStubs();
  respondFor(
    (url) => url.includes('duckduckgo.com/?q='),
    textResponse('<script>vqd="4-1";</script>'),
  );
  respondFor((url) => url.includes('/i.js'), textResponse('{}'));
  await assert.rejects(
    searchImages({ query: 'gatos', engine: 'duckduckgo' }),
    /no devolvió imágenes/,
  );
});

test('searchWikimedia pide el lote 2 y arma resultados', async () => {
  resetStubs();
  respondFor(
    (url) => url.includes('gsroffset=48'),
    textResponse(
      JSON.stringify({
        query: {
          pages: [
            {
              title: 'File:Ejemplo foto.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/full.jpg?width=2000',
                  thumburl: 'https://upload.wikimedia.org/thumb.jpg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ejemplo',
                },
              ],
            },
          ],
        },
      }),
    ),
  );
  const results = await searchImages({ query: 'gatos', engine: 'wikimedia', page: 3 });
  assert.equal(results[0].imageUrl, 'https://upload.wikimedia.org/full.jpg');
  assert.equal(results[0].source, 'Wikimedia Commons');
  assert.ok(state.calls[0].url.includes('action=query'));
  assert.ok(state.calls[0].url.includes('generator=search'));
});

test('searchWikimedia informa cuando no hay imágenes', async () => {
  resetStubs();
  queueResponse(textResponse('{}'));
  await assert.rejects(
    searchImages({ query: 'gatos', engine: 'wikimedia' }),
    /no tiene imágenes libres/,
  );
});

test('searchOpenverse limita page_size a 20 en peticiones anónimas', async () => {
  resetStubs();
  respondFor(
    (url) => url.includes('api.openverse.org'),
    textResponse(
      JSON.stringify({
        results: [
          {
            url: 'https://api.openverse.org/v1/images/abc/',
            thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/',
            title: 'Foto libre',
            creator: 'autor',
            foreign_landing_url: 'https://www.flickr.com/photos/1',
          },
        ],
      }),
    ),
  );
  const results = await searchImages({ query: 'gatos', engine: 'openverse' });
  assert.equal(results[0].title, 'Foto libre');
  assert.equal(results[0].source, 'autor');
  assert.ok(state.calls[0].url.includes('page_size=20'));
});

test('searchOpenverse informa cuando no hay resultados', async () => {
  resetStubs();
  queueResponse(textResponse('{}'));
  await assert.rejects(searchImages({ query: 'gatos', engine: 'openverse' }), /no devolvió/);
});

test('searchImages valida consulta y motor', async () => {
  resetStubs();
  await assert.rejects(searchImages({ query: '  ', engine: 'bing' }), /término/);
  await assert.rejects(searchImages({ query: 'gatos', engine: 'yahoo' }), /no soportado/);
});

test('searchImages rechaza respuestas con estado no 2xx o sin cuerpo', async () => {
  resetStubs();
  queueResponse({ status: 503, body: '', headers: {} });
  await assert.rejects(searchImages({ query: 'gatos', engine: 'bing' }), /HTTP 503/);

  resetStubs();
  queueResponse({ status: 200, body: '', headers: {} });
  await assert.rejects(searchImages({ query: 'gatos', engine: 'bing' }), /no devolvió resultados/);
});

test('searchWikimedia tolera respuestas que no son JSON', async () => {
  resetStubs();
  queueResponse(textResponse('esto no es un json válido'));
  await assert.rejects(
    searchImages({ query: 'gatos', engine: 'wikimedia' }),
    /no tiene imágenes libres/,
  );
});

test('searchBing ignora entradas con JSON roto y sigue con las válidas', async () => {
  resetStubs();
  const broken = '<a class="iusc" m="{&quot;murl&quot;:&quot;incompleto}"></a>';
  queueResponse(textResponse(broken + BING_MARKUP));
  const results = await searchImages({ query: 'gatos', engine: 'bing' });
  assert.ok(results.length >= 1);
  assert.equal(results[0].imageUrl, 'https://example.com/full.jpg');
});

test('cleanText normaliza valores y tolera entradas vacías', () => {
  assert.equal(cleanText('  hola   mundo  '), 'hola mundo');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText(''), '');
  assert.equal(cleanText('a\\u00e9b'), 'aéb');
  assert.equal(cleanText('a\\"b'), 'a"b');
  assert.equal(cleanText('a\\/b'), 'a/b');
});

test('isImageUrl acepta solo http(s) y rechaza marcas de Google/favicon', () => {
  assert.equal(isImageUrl('https://cdn.com/a.jpg'), true);
  assert.equal(isImageUrl(null), false);
  assert.equal(isImageUrl('data:image/png;base64,x'), false);
  assert.equal(isImageUrl('https://www.google.com/logo.png'), false);
  assert.equal(isImageUrl('https://x.com/favicon.ico'), false);
  assert.equal(isImageUrl('https://x.com/sprites/logo.png'), false);
});

test('uniqueImages descarta nulos, URLs no imagen y duplicados', () => {
  const base = 'https://cdn.com/a.jpg';
  const expected = [{ imageUrl: base }];
  assert.deepEqual(uniqueImages([...expected, ...expected]), expected);
  assert.deepEqual(
    uniqueImages([null, { imageUrl: 'ftp://cdn.com/x.jpg' }, ...expected]),
    expected,
  );
  assert.deepEqual(uniqueImages([]), []);
});

test('extractGoogleImages tolera entradas parciales y descarta inválidas', () => {
  const body =
    '<html>' +
    '"ou":"https://cdn.com/ok.jpg","tu":"https://cdn.com/t.jpg","ru":"https://origen.com/nota","pt":"Título" ' +
    '"ou":"ftp://cdn.com/bad.jpg" ' +
    '"ou":"https://cdn.com/page.jpg","ru":"mailto:otro" ' +
    '"ou":"https://cdn.com/thumb.jpg","tu":"data:image/png;base64,abc" ' +
    '"ou":"https://cdn.com/limpia.jpg" ' +
    '</html>';
  const results = extractGoogleImages(body);
  assert.equal(results.length, 4);
  assert.equal(results[0].imageUrl, 'https://cdn.com/ok.jpg');
  assert.equal(results[0].thumbnailUrl, 'https://cdn.com/t.jpg');
  assert.equal(results[0].title, 'Título');
  assert.equal(results[0].pageUrl, 'https://origen.com/nota');
  assert.equal(results[0].source, 'origen.com');
  assert.equal(results[1].imageUrl, 'https://cdn.com/page.jpg');
  assert.equal(results[1].thumbnailUrl, results[1].imageUrl);
  assert.equal(results[1].title, '');
  assert.equal(results[1].pageUrl, '');
  assert.equal(results[2].thumbnailUrl, 'https://cdn.com/thumb.jpg');
  assert.equal(results[2].title, '');
  assert.equal(results[2].pageUrl, '');
  assert.equal(results[2].source, 'Google');
  assert.equal(results[3].imageUrl, 'https://cdn.com/limpia.jpg');
  assert.equal(results[3].thumbnailUrl, results[3].imageUrl);
  assert.equal(results[3].pageUrl, '');
  assert.equal(results[3].source, 'Google');
  assert.equal(
    results.some((r) => r.imageUrl.includes('bad')),
    false,
  );
  assert.deepEqual(extractGoogleImages(''), []);
});

test('extractDuckDuckGoToken acepta comillas y formato desnudo', () => {
  assert.equal(extractDuckDuckGoToken('<script>vqd="4-12345abc";</script>'), '4-12345abc');
  assert.equal(extractDuckDuckGoToken('<script>vqd=987654;</script>'), '987654');
  assert.equal(extractDuckDuckGoToken('sin token'), null);
  assert.equal(extractDuckDuckGoToken(''), null);
});

test('extractDuckDuckGoImages tolera JSON inválido y entradas vacías', () => {
  assert.deepEqual(extractDuckDuckGoImages(''), []);
  assert.deepEqual(extractDuckDuckGoImages('no es json'), []);
  const payload = JSON.stringify({
    results: [
      { image: 'https://cdn.com/a.jpg', width: 640, height: 480 },
      {
        image: 'https://cdn.com/b.jpg',
        thumbnail: 'https://cdn.com/t.jpg',
        url: 'https://origen.com/nota',
      },
      { image: 'https://cdn.com/dup.jpg' },
      {},
    ],
  });
  const results = extractDuckDuckGoImages(payload);
  assert.equal(results.length, 3, 'la entrada sin imagen se descarta');
  assert.equal(results[0].thumbnailUrl, 'https://cdn.com/a.jpg');
  assert.equal(results[0].width, 640);
  assert.equal(results[0].height, 480);
  assert.equal(results[0].source, 'DuckDuckGo');
  assert.equal(results[1].source, 'origen.com');
});

test('extractWikimediaImages tolera JSON inválido y páginas sin imagen', () => {
  assert.deepEqual(extractWikimediaImages(''), []);
  assert.deepEqual(extractWikimediaImages('no es json'), []);
  const payload = JSON.stringify({
    query: {
      pages: [
        { title: 'File:Con.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/con.jpg' }] },
        { title: 'File:Sin.jpg', imageinfo: [] },
        { title: '', imageinfo: [{ url: 'https://upload.wikimedia.org/plain.jpg?width=320' }] },
        {
          title: 'File:Tw.jpg',
          imageinfo: [
            {
              url: 'https://cdn.example.com/x.jpg',
              thumburl: 'https://upload.wikimedia.org/tw.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Tw',
            },
          ],
        },
      ],
    },
  });
  const results = extractWikimediaImages(payload);
  assert.equal(results.length, 3);
  assert.equal(results[0].title, 'Con');
  assert.equal(results[0].thumbnailUrl, 'https://upload.wikimedia.org/con.jpg');
  assert.equal(results[0].pageUrl, '');
  assert.equal(results[1].title, '');
  assert.equal(results[1].imageUrl, 'https://upload.wikimedia.org/plain.jpg');
  assert.equal(results[2].thumbnailUrl, 'https://upload.wikimedia.org/tw.jpg');
  assert.equal(results[2].pageUrl, 'https://commons.wikimedia.org/wiki/File:Tw');
});

test('safeHostname limpia el www y tolera URLs inválidas', () => {
  assert.equal(safeHostname('https://www.example.com/a.jpg'), 'example.com');
  assert.equal(safeHostname('no es url'), '');
  assert.equal(safeHostname(''), '');
});

test('canonicalImageUrl recorta consultas y fragmentos', () => {
  assert.equal(canonicalImageUrl('https://x.com/a.jpg'), 'https://x.com/a.jpg');
  assert.equal(canonicalImageUrl('https://x.com/a.jpg?width=2000#x'), 'https://x.com/a.jpg');
  assert.equal(canonicalImageUrl(''), '');
});

test('extractOpenverseImages tolera JSON inválido y entradas vacías', () => {
  assert.deepEqual(extractOpenverseImages(''), []);
  assert.deepEqual(extractOpenverseImages('no es json'), []);
  const payload = JSON.stringify({
    results: [
      { url: 'https://api.openverse.org/v1/images/1/', creator: 'autor' },
      {
        url: 'https://api.openverse.org/v1/images/2/',
        thumbnail: 'https://x/t.jpg',
        provider: 'Flickr',
        foreign_landing_url: 'https://www.flickr.com/f/2',
      },
      { url: 'https://api.openverse.org/v1/images/3/' },
      {},
    ],
  });
  const results = extractOpenverseImages(payload);
  assert.equal(results.length, 3, 'la entrada sin imagen se descarta');
  assert.equal(results[0].source, 'autor');
  assert.equal(results[0].thumbnailUrl, 'https://api.openverse.org/v1/images/1/');
  assert.equal(results[1].source, 'Flickr');
  assert.equal(results[1].pageUrl, 'https://www.flickr.com/f/2');
  assert.equal(results[2].source, 'Openverse');
});

test('extractBingImages tolera JSON inválido y entradas parciales', () => {
  assert.deepEqual(extractBingImages(''), []);
  const body =
    '<a class="iusc" m="{&quot;turl&quot;:&quot;https://t.com/x.jpg&quot;}"></a>' +
    '<a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.com/a.jpg&quot;}"></a>' +
    '<a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.com/b.jpg&quot;,&quot;t&quot;:&quot;T2&quot;,&quot;purl&quot;:&quot;no-es-url&quot;}"></a>' +
    '<a class="iusc" m="{&quot;murl&quot;:&quot;https://cdn.com/c.jpg&quot;,&quot;turl&quot;:&quot;https://t.com/c.jpg&quot;,&quot;t&quot;:&quot;C&quot;,&quot;purl&quot;:&quot;https://www.example.com/nota&quot;}"></a>';
  const results = extractBingImages(body);
  assert.equal(results.length, 3);
  assert.equal(results[0].imageUrl, 'https://cdn.com/a.jpg');
  assert.equal(results[0].thumbnailUrl, 'https://cdn.com/a.jpg');
  assert.equal(results[0].title, '');
  assert.equal(results[0].pageUrl, '');
  assert.equal(results[0].source, 'Bing');
  assert.equal(results[1].title, 'T2');
  assert.equal(results[1].pageUrl, 'no-es-url');
  assert.equal(results[1].source, 'Bing');
  assert.equal(results[2].title, 'C');
  assert.equal(results[2].thumbnailUrl, 'https://t.com/c.jpg');
  assert.equal(results[2].source, 'example.com');
});

test('responseCookies une cookies en string o array', () => {
  assert.equal(responseCookies({}), '');
  assert.equal(responseCookies({ headers: { 'set-cookie': 'aa=1; Path=/' } }), 'aa=1');
  assert.equal(
    responseCookies({ headers: { 'set-cookie': ['aa=1; Path=/', 'bb=2; Path=/'] } }),
    'aa=1; bb=2',
  );
});

test('searchBing informa cuando un cuerpo válido no trae imágenes', async () => {
  resetStubs();
  queueResponse(textResponse('<html><body>sin resultados</body></html>'));
  await assert.rejects(searchImages({ query: 'gatos', engine: 'bing' }), /no devolvió imágenes/);
});

test('searchDuckDuckGo envuelve errores sin mensaje', async () => {
  resetStubs();
  respondFor(
    (url) => url.includes('duckduckgo.com/?q='),
    textResponse('<script>vqd="4-1";</script>'),
  );
  respondFor(
    (url) => url.includes('/i.js'),
    () => {
      throw new Error();
    },
  );
  await assert.rejects(
    searchImages({ query: 'gatos', engine: 'duckduckgo' }),
    /Prueba con otro motor/,
  );
});

test('searchImages limpia consultas vacías y recorta páginas por debajo de 1', async () => {
  resetStubs();
  await assert.rejects(searchImages({ engine: 'bing' }), /término/);

  resetStubs();
  respondFor((url) => url.includes('first=1'), textResponse(BING_MARKUP));
  const results = await searchImages({ query: 'gatos', engine: 'bing', page: 0 });
  assert.ok(state.calls[0].url.includes('first=1'));
  assert.ok(results.length >= 1);
});
