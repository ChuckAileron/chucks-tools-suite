const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateAddress,
  validatePublicUrl,
  isTextualContentType,
  extractMediafireDirect,
  extractMediafireTitle,
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
