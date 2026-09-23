const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateAddress,
  validatePublicUrl,
  isTextualContentType,
  extractMediafireDirect,
  extractMediafireTitle,
  extractFireloadDirect,
  extractFireloadTitle,
  extractFireloadDlink,
  urlCandidate,
  extractDestination,
} = require('../electron/urlResolver.cjs');

test('identifica rangos IPv4 e IPv6 privados', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.4'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('rechaza protocolos y hosts locales', async () => {
  await assert.rejects(validatePublicUrl('file:///etc/passwd'), /HTTP o HTTPS/);
  await assert.rejects(validatePublicUrl('http://localhost/test'), /direcciones locales/);
});

test('rechaza URLs inválidas, con credenciales o .local', async () => {
  await assert.rejects(validatePublicUrl('no-es-una-url'), /URL válida/);
  await assert.rejects(validatePublicUrl('ftp://ejemplo.com/a.zip'), /HTTP o HTTPS/);
  await assert.rejects(validatePublicUrl('https://user:pass@ejemplo.com/'), /credenciales/);
  await assert.rejects(validatePublicUrl('http://mi-pc.local/a'), /direcciones locales/);
});

test('identifica más rangos privados y públicos', () => {
  assert.equal(isPrivateAddress('10.0.0.1'), true);
  assert.equal(isPrivateAddress('172.16.0.1'), true);
  assert.equal(isPrivateAddress('172.31.255.255'), true);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
  assert.equal(isPrivateAddress('0.0.0.0'), true);
  assert.equal(isPrivateAddress('169.254.1.1'), true);
  assert.equal(isPrivateAddress('224.0.0.1'), true);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::'), true);
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('fc00::1'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('2001:db8::1'), false);
});

test('normaliza URLs candidatas', () => {
  assert.equal(urlCandidate(null), null);
  assert.equal(urlCandidate(''), null);
  assert.equal(urlCandidate('https://ejemplo.com/a.zip'), 'https://ejemplo.com/a.zip');
  assert.equal(urlCandidate('https://ejemplo.com/r?x=1&amp;y=2'), 'https://ejemplo.com/r?x=1&y=2');
  assert.equal(urlCandidate('https%3A%2F%2Fejemplo.com%2Fa.zip'), 'https://ejemplo.com/a.zip');
  assert.equal(urlCandidate('/a.zip', 'https://ejemplo.com/base/'), 'https://ejemplo.com/a.zip');
  assert.equal(urlCandidate('ftp://ejemplo.com/a.zip'), null);
  assert.equal(urlCandidate('no-es-url'), null);
});

test('extrae destino desde parámetros de consulta', () => {
  const current = new URL('https://acortador.com/x?url=https%3A%2F%2Fejemplo.com%2Fa.zip');
  assert.deepEqual(extractDestination(current, ''), {
    url: 'https://ejemplo.com/a.zip',
    method: 'query',
  });
  // Sin parámetros ni cuerpo no hay destino.
  assert.equal(extractDestination(new URL('https://ejemplo.com/a'), ''), null);
  assert.equal(extractDestination(new URL('https://ejemplo.com/a?foo=bar'), ''), null);
});

test('extrae destino desde meta-refresh y enlaces de página', () => {
  const current = new URL('https://publi.com/paso');
  assert.deepEqual(
    extractDestination(
      current,
      '<html><head><meta http-equiv="refresh" content="0; url=https://ejemplo.com/a.zip"></head></html>',
    ),
    { url: 'https://ejemplo.com/a.zip', method: 'meta-refresh' },
  );
  assert.deepEqual(
    extractDestination(
      current,
      '<html><body><a id="downloadButton" href="https://cdn.com/a.zip">Bajar</a></body></html>',
    ),
    { url: 'https://cdn.com/a.zip', method: 'page-link' },
  );
  assert.deepEqual(
    extractDestination(
      current,
      '<html><body><script>window.location="https://cdn.com/a.zip";</script></body></html>',
    ),
    { url: 'https://cdn.com/a.zip', method: 'page-script' },
  );
  assert.deepEqual(
    extractDestination(
      current,
      '<html><body><script>const finalUrl = "https://cdn.com/a.zip";</script></body></html>',
    ),
    { url: 'https://cdn.com/a.zip', method: 'page-script' },
  );
  assert.equal(extractDestination(current, '<html><body>sin enlaces</body></html>'), null);
});

test('extrae la URL directa de MediaFire desde el boton de descarga', () => {
  const base = new URL('https://www.mediafire.com/file/abc12345/foo.zip/file');
  const body = `<div id="download_link">
    <a class="input popsok" aria-label="Download file"
       href="https://download946.mediafire.com/token/abc12345/foo.zip"
       id="downloadButton" rel="nofollow">Download (1.2MB)</a>
  </div>`;
  const direct = extractMediafireDirect(body, base);
  assert.equal(direct, 'https://download946.mediafire.com/token/abc12345/foo.zip');
});

test('extrae la URL directa de MediaFire desde JSON escapado', () => {
  const base = new URL('https://www.mediafire.com/file/abc12345/foo.zip/file');
  const body = `<script>const state = {"download_url":"https:\\/\\/download946.mediafire.com\\/token\\/abc12345\\/foo.zip"};</script>`;
  const direct = extractMediafireDirect(body, base);
  assert.equal(direct, 'https://download946.mediafire.com/token/abc12345/foo.zip');
});

test('ignora enlaces de descarga que no sean CDN de MediaFire', () => {
  const base = new URL('https://www.mediafire.com/file/abc12345/foo.zip/file');
  const body = `<a id="downloadButton" href="/download_repair.php?qkey=abc12345&amp;dkey=x">Repair</a>`;
  assert.equal(extractMediafireDirect(body, base), null);
  assert.equal(extractMediafireDirect('', base), null);
});

test('clasifica como textuales las respuestas HTML/JSON/XML', () => {
  assert.equal(isTextualContentType('text/html; charset=UTF-8'), true);
  assert.equal(isTextualContentType('text/plain'), true);
  assert.equal(isTextualContentType('application/json'), true);
  assert.equal(isTextualContentType('application/xml'), true);
  assert.equal(isTextualContentType('application/xhtml+xml'), true);
});

test('clasifica como binarias las respuestas de archivos', () => {
  assert.equal(isTextualContentType('application/x-dosexec'), false);
  assert.equal(isTextualContentType('application/octet-stream'), false);
  assert.equal(isTextualContentType('application/zip'), false);
  assert.equal(isTextualContentType('image/png'), false);
  assert.equal(isTextualContentType(''), false);
});

test('extrae el nombre real del archivo desde el titulo de MediaFire', () => {
  const body = `<html><head>
    <meta property="og:title" content="Dragon Ball - 033" />
    <title>Dragon Ball - 033</title>
  </head></html>`;
  assert.equal(extractMediafireTitle(body), 'Dragon Ball - 033');
  assert.equal(
    extractMediafireTitle('<html><head><title>   Foo\tBar  </title></head></html>'),
    'Foo Bar',
  );
  assert.equal(extractMediafireTitle('<html></html>'), '');
  assert.equal(extractMediafireTitle(''), '');
});

test('extrae la URL directa de Fireload desde el boton de descarga', () => {
  const base = new URL('https://www.fireload.com/file/abc12345/foo.zip');
  const body = `<html><body>
    <a id="downloadButton" href="https://cdn.fireload.com/download/abc12345/foo.zip">Download</a>
  </body></html>`;
  const direct = extractFireloadDirect(body, base);
  assert.equal(direct, 'https://cdn.fireload.com/download/abc12345/foo.zip');
});

test('extrae la URL directa de Fireload desde atributo data-download-url', () => {
  const base = new URL('https://www.fireload.com/file/abc12345/foo.zip');
  const body = `<html><body>
    <a class="btn-download" data-download-url="https://cdn.fireload.com/download/abc12345/foo.zip">Bajar</a>
  </body></html>`;
  assert.equal(
    extractFireloadDirect(body, base),
    'https://cdn.fireload.com/download/abc12345/foo.zip',
  );
});

test('ignora Fireload sin enlace de descarga', () => {
  const base = new URL('https://www.fireload.com/file/abc12345/foo.zip');
  assert.equal(extractFireloadDirect('<html><body>sin enlaces</body></html>', base), null);
  assert.equal(extractFireloadDirect('', base), null);
});

test('extrae el enlace de descarga real de Fireload desde window.Fl.dlink', () => {
  const body = `<script>
    window.Fl = {"dlink": "https://www.fireload.com/abc12345/foo.zip?pt=UVhvU2s\rxR0ZEdVZEdVZEdV", "dwait": "0", "dtext": "Download File"}
  </script>`;
  assert.equal(
    extractFireloadDlink(body),
    'https://www.fireload.com/abc12345/foo.zip?pt=UVhvU2s\rxR0ZEdVZEdVZEdV',
  );
  assert.equal(extractFireloadDlink('<html></html>'), null);
  assert.equal(extractFireloadDlink(''), null);
});

test('extrae el nombre real del archivo desde el titulo de Fireload', () => {
  const body = `<html><head>
    <meta property="og:title" content="Documento importante - shared via Fireload" />
    <title>Documento importante</title>
  </head></html>`;
  assert.equal(extractFireloadTitle(body), 'Documento importante');
  assert.equal(
    extractFireloadTitle(
      '<html><head><meta property="og:title" content="Foo | Fireload" /></head></html>',
    ),
    'Foo',
  );
  assert.equal(
    extractFireloadTitle(
      '<html><head><title>   Foo Bar shared via Fireload </title></head></html>',
    ),
    'Foo Bar',
  );
  assert.equal(extractFireloadTitle('<html></html>'), '');
  assert.equal(extractFireloadTitle(''), '');
});
