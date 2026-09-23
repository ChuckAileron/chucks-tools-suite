const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../electron/teraboxProvider.cjs');

function baseHeaders(extra = {}) {
  return {
    get: (name) => extra[String(name).toLowerCase()] ?? null,
    getSetCookie: () => extra['set-cookie'] || [],
  };
}
function jsonResponse(status, data, extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 400,
    status,
    headers: baseHeaders(extraHeaders),
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}
function htmlResponse(status, html, extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 400,
    status,
    headers: baseHeaders(extraHeaders),
    text: async () => html,
  };
}
function redirectResponse(location, extraHeaders = {}) {
  return {
    ok: false,
    status: 302,
    headers: baseHeaders({ location, ...extraHeaders }),
  };
}
function installFetch(responder) {
  global.fetch = async (url, options = {}) => responder(String(url), options);
}

const HOST = 'https://www.1024terabox.com';
const SURL = '1abcXYZ';
const REDIRECT_URL = `${HOST}/sharing/link?surl=${SURL}&layer=1`;
const PAGE_HTML = `<title>Fotos de la boda - TeraBox</title><script>window.jsToken="tok-123";</script>`;

function standardResponder({
  rootList = [],
  subList = { errno: 0, list: [] },
  verifyErrno = 0,
} = {}) {
  return async (url, options) => {
    if (/\/s\/1abcXYZ$/.test(url) && options.redirect === 'manual') {
      return redirectResponse(REDIRECT_URL, { 'set-cookie': ['BAIDUID=abc; Path=/'] });
    }
    if (url.startsWith(REDIRECT_URL)) {
      return htmlResponse(200, PAGE_HTML, { 'set-cookie': ['ndus=xyz; Path=/'] });
    }
    if (url.includes('/share/verify')) {
      assert.equal(options.method, 'POST');
      assert.ok(options.headers.Cookie.includes('BAIDUID=abc'));
      assert.ok(options.headers.Cookie.includes('ndus=xyz'));
      assert.ok(options.body.includes(`surl=${SURL}`));
      assert.ok(options.body.includes('jsToken=tok-123'));
      return jsonResponse(
        200,
        verifyErrno === 0 ? { errno: 0, verifykey: 'VK1' } : { errno: verifyErrno },
      );
    }
    if (url.includes('/api/shortner/v1/msgsharelist')) {
      const parsed = new URL(url);
      assert.ok(parsed.searchParams.get('verifykey'));
      if (parsed.searchParams.get('root') === '0') return jsonResponse(200, subList);
      return jsonResponse(200, { errno: 0, uk: 'UK1', shareid: 'SID1', list: rootList });
    }
    throw new Error(`URL no manejada en el stub: ${url}`);
  };
}

test('teraboxShareParts reconoce enlaces cortos y con query surl', () => {
  assert.deepEqual(provider.teraboxShareParts('https://www.1024terabox.com/s/1abcXYZ'), {
    host: 'https://www.1024terabox.com',
    surl: '1abcXYZ',
  });
  assert.deepEqual(
    provider.teraboxShareParts('https://terabox.com/sharing/link?surl=1abcXYZ&layer=1'),
    { host: 'https://terabox.com', surl: '1abcXYZ' },
  );
  assert.equal(provider.teraboxShareParts('https://example.com/s/1abc'), '');
});

test('extractJsToken reconoce distintos formatos del token', () => {
  assert.equal(provider.extractJsToken('"jsToken":"abc123"'), 'abc123');
  assert.equal(provider.extractJsToken('window.jsToken = "xyz789"'), 'xyz789');
  assert.equal(provider.extractJsToken('sin token aquí'), '');
});

test('teraboxErrorMessage traduce errno conocidos y desconocidos', () => {
  assert.match(provider.teraboxErrorMessage(108), /caducó/);
  assert.match(provider.teraboxErrorMessage(257), /contraseña/);
  assert.match(provider.teraboxErrorMessage(999), /código 999/);
});

test('teraboxDownloadUrl arma un enlace firmado con los parámetros del share', () => {
  const url = provider.teraboxDownloadUrl({
    host: HOST,
    surl: SURL,
    uk: 'UK1',
    shareid: 'SID1',
    fsId: '42',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, `${HOST}/api/download`);
  assert.equal(parsed.searchParams.get('fs_id'), '42');
  assert.equal(parsed.searchParams.get('surl'), SURL);
  assert.equal(parsed.searchParams.get('uk'), 'UK1');
  assert.equal(parsed.searchParams.get('shareid'), 'SID1');
  assert.ok(parsed.searchParams.get('sign'));
  assert.ok(parsed.searchParams.get('timestamp'));
});

test('expandTeraboxShare recorre carpetas y arma el árbol completo', async () => {
  installFetch(
    standardResponder({
      rootList: [
        {
          fs_id: 11,
          server_filename: 'video.mp4',
          size: 100,
          md5: 'm1',
          dlink: 'https://dm.terabox.com/direct1',
        },
        { fs_id: 22, server_filename: 'Subcarpeta', isdir: 1 },
      ],
      subList: {
        errno: 0,
        list: [{ fs_id: 33, server_filename: 'nested.pdf', size: 50, dlink: '' }],
      },
    }),
  );
  const share = await provider.expandTeraboxShare(`${HOST}/s/${SURL}`);
  assert.equal(share.name, 'Fotos de la boda');
  assert.equal(share.uk, 'UK1');
  assert.equal(share.shareid, 'SID1');
  assert.equal(share.files.length, 2);
  const video = share.files.find((f) => f.fs_id === '11');
  assert.equal(video.dlink, 'https://dm.terabox.com/direct1');
  assert.equal(video.fromFolder, false);
  const nested = share.files.find((f) => f.fs_id === '33');
  assert.equal(nested.path, 'Subcarpeta / nested.pdf');
  assert.equal(nested.fromFolder, true);
  assert.equal(nested.dlink, '');
});

test('expandTeraboxShare rechaza si share/verify devuelve un error', async () => {
  installFetch(standardResponder({ verifyErrno: 108 }));
  await assert.rejects(provider.expandTeraboxShare(`${HOST}/s/${SURL}`), /caducó/);
});

test('expandTeraboxShare rechaza enlaces que no son de TeraBox', async () => {
  await assert.rejects(
    provider.expandTeraboxShare('https://example.com/s/1abc'),
    /no es de TeraBox/,
  );
});

test('refreshTeraboxFile reconstruye el enlace directo de un archivo por fs_id', async () => {
  installFetch(
    standardResponder({
      rootList: [{ fs_id: 11, server_filename: 'video.mp4', size: 100, dlink: '' }],
    }),
  );
  const url = await provider.refreshTeraboxFile(`${HOST}/s/${SURL}`, '11');
  assert.ok(url.startsWith(`${HOST}/api/download?`));
  assert.ok(url.includes('fs_id=11'));
});

test('refreshTeraboxFile devuelve el dlink cuando ya viene firmado', async () => {
  installFetch(
    standardResponder({
      rootList: [
        {
          fs_id: 11,
          server_filename: 'video.mp4',
          size: 100,
          dlink: 'https://dm.terabox.com/direct1',
        },
      ],
    }),
  );
  const url = await provider.refreshTeraboxFile(`${HOST}/s/${SURL}`, '11');
  assert.equal(url, 'https://dm.terabox.com/direct1');
});

test('CookieJar guarda y reenvía cookies de Set-Cookie', () => {
  const jar = new provider.CookieJar();
  jar.store({ getSetCookie: () => ['a=1; Path=/', 'b=2; HttpOnly'] });
  assert.equal(jar.header(), 'a=1; b=2');
});
