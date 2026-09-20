const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractGoogleImages,
  extractBingImages,
  extractDuckDuckGoToken,
  extractDuckDuckGoImages,
  extractWikimediaImages,
  searchImages,
} = require('../electron/imageSearch.cjs');

test('extrae solo imagenes del HTML de Google sin el contenido', () => {
  const body = `<html><body><p>Contenido del articulo que debe ignorarse</p><script>
    AF_initDataCallback({data:[{"ou":"https://example.com/foto.jpg","tu":"https://encrypted-tbn0.gstatic.com/tbn","ru":"https://example.com/pagina","pt":"Foto de ejemplo"}]});
  </script></body></html>`;
  const results = extractGoogleImages(body);
  assert.equal(results.length, 1);
  assert.equal(results[0].imageUrl, 'https://example.com/foto.jpg');
  assert.equal(results[0].thumbnailUrl, 'https://encrypted-tbn0.gstatic.com/tbn');
  assert.equal(results[0].title, 'Foto de ejemplo');
  assert.equal(results[0].source, 'example.com');
  assert.equal(results[0].pageUrl, 'https://example.com/pagina');
  assert.ok(!JSON.stringify(results).includes('Contenido del articulo'));
});

test('ignora bloques de Google sin URL de imagen valida y elimina duplicados', () => {
  const body = `"ou":"nota-texto" "ou":"https://example.com/a.jpg" "ou":"https://example.com/a.jpg"`;
  assert.equal(extractGoogleImages(body).length, 1);
  assert.equal(extractGoogleImages('').length, 0);
});

test('extrae solo imagenes del HTML de Bing sin el contenido', () => {
  const body = `<html><body><p>Contenido web que debe ignorarse</p>
    <a class="iusc" m="{&quot;purl&quot;:&quot;https://origen.com/nota&quot;,&quot;murl&quot;:&quot;https://example.com/full.jpg&quot;,&quot;turl&quot;:&quot;https://ts3.mm.bing.net/th?id=OIP.x&quot;,&quot;t&quot;:&quot;Titulo bing&quot;}"><img src="t" /></a>
    <a class="iusc" m="{&quot;murl&quot;:&quot;https://example.com/full.jpg&quot;}"><img src="t" /></a>
    <a class="iusc" m="no-json"><img src="t" /></a>
  </body></html>`;
  const results = extractBingImages(body);
  assert.equal(results.length, 1);
  assert.equal(results[0].imageUrl, 'https://example.com/full.jpg');
  assert.equal(results[0].thumbnailUrl, 'https://ts3.mm.bing.net/th?id=OIP.x');
  assert.equal(results[0].title, 'Titulo bing');
  assert.equal(results[0].source, 'origen.com');
  assert.equal(results[0].pageUrl, 'https://origen.com/nota');
  assert.ok(!JSON.stringify(results).includes('Contenido web'));
  assert.equal(extractBingImages('').length, 0);
});

test('extrae el token vqd de DuckDuckGo', () => {
  assert.equal(extractDuckDuckGoToken(`<script>vqd="4-12345abc";</script>`), '4-12345abc');
  assert.equal(extractDuckDuckGoToken(`vqd='7-xyz'`), '7-xyz');
  assert.equal(extractDuckDuckGoToken('<html></html>'), null);
});

test('extrae resultados del JSON de DuckDuckGo', () => {
  const body = JSON.stringify({
    results: [
      {
        image: 'https://example.com/full.jpg',
        thumbnail: 'https://example.com/thumb.jpg',
        title: 'Titulo',
        url: 'https://origen.com/nota',
        source: 'Origen',
        width: 800,
        height: 600,
      },
      { image: 'nota-texto', title: 'Sin imagen' },
    ],
  });
  const results = extractDuckDuckGoImages(body);
  assert.equal(results.length, 1);
  assert.equal(results[0].imageUrl, 'https://example.com/full.jpg');
  assert.equal(results[0].thumbnailUrl, 'https://example.com/thumb.jpg');
  assert.equal(results[0].width, 800);
  assert.equal(extractDuckDuckGoImages('no-json').length, 0);
});

test('extrae resultados del API de Wikimedia Commons', () => {
  const body = JSON.stringify({
    query: {
      pages: [
        {
          title: 'File:Ejemplo foto.jpg',
          imageinfo: [
            {
              url: 'https://upload.wikimedia.org/full.jpg',
              thumburl: 'https://upload.wikimedia.org/thumb.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ejemplo',
              width: 640,
              height: 480,
            },
          ],
        },
        { title: 'File:SinInfo.jpg' },
      ],
    },
  });
  const results = extractWikimediaImages(body);
  assert.equal(results.length, 1);
  assert.equal(results[0].imageUrl, 'https://upload.wikimedia.org/full.jpg');
  assert.equal(results[0].source, 'Wikimedia Commons');
  assert.equal(extractWikimediaImages('{}').length, 0);
});

test('valida la consulta y el motor antes de buscar', async () => {
  await assert.rejects(searchImages({ query: '   ', engine: 'google' }), /término/);
  await assert.rejects(searchImages({ query: 'gatos', engine: 'yahoo' }), /no soportado/);
});
