const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installHooks } = require('./helpers/moduleHooks.cjs');

function setup() {
  const state = { requests: [], dnsLookups: [], dnsRecords: null, dnsError: null };

  const promises = {
    lookup(hostname, options) {
      state.dnsLookups.push({ hostname, options, promises: true });
      const records = state.dnsRecords || [{ address: '93.184.216.34', family: 4 }];
      if (!records.length)
        return Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      return Promise.resolve(records);
    },
  };

  function dnsLookup(hostname, options, callback) {
    state.dnsLookups.push({ hostname, options });
    if (state.dnsError) return process.nextTick(() => callback(state.dnsError));
    const records = state.dnsRecords || [{ address: '93.184.216.34', family: 4 }];
    if (options && options.all) return process.nextTick(() => callback(null, records));
    return process.nextTick(() => callback(null, records[0].address, records[0].family));
  }

  function makeRequest(clientName) {
    const request = new EventEmitter();
    request.client = clientName;
    request.setTimeout = (ms, handler) => {
      request.timeoutHandler = handler;
      request.timeoutMs = ms;
    };
    request.destroy = (error) => {
      if (error) request.emit('error', error);
    };
    state.requests.push(request);
    return request;
  }

  function clientGet(clientName) {
    return function get(url, options, callback) {
      const request = makeRequest(clientName);
      request.url = url instanceof URL ? url : new URL(String(url));
      request.options = options;
      request.callback = callback;
      return request;
    };
  }

  installHooks({
    'node:dns': { promises, lookup: dnsLookup },
    'node:https': { get: clientGet('https') },
    'node:http': { get: clientGet('http') },
  });
  delete require.cache[require.resolve('../electron/urlResolver.cjs')];
  return { provider: require('../electron/urlResolver.cjs'), state };
}

async function waitForRequests(state, count, timeoutMs = 5000) {
  const start = Date.now();
  while (state.requests.length < count) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`No se emitieron ${count} solicitudes (solo ${state.requests.length})`);
    await new Promise((r) => setImmediate(r));
  }
}

function response(request, { status = 200, headers = {}, body = '' } = {}) {
  const res = new EventEmitter();
  res.statusCode = status;
  res.headers = { 'content-type': 'text/html; charset=UTF-8', ...headers };
  res.resume = () => {};
  request.callback(res);
  return res;
}

function htmlResponse(request, body, { status = 200, headers = {} } = {}) {
  const res = response(request, { status, headers, body });
  if (body) res.emit('data', Buffer.from(body));
  res.emit('end');
  return res;
}

test('validatePublicUrl resuelve el host por DNS', async () => {
  const { provider, state } = setup();
  const url = await provider.validatePublicUrl('https://ejemplo.com/a.rar');
  assert.equal(url.href, 'https://ejemplo.com/a.rar');
  assert.equal(state.dnsLookups[0].hostname, 'ejemplo.com');
  assert.equal(state.dnsLookups[0].options.all, true);
});

test('validatePublicUrl rechaza hosts DNS redirigidos a redes privadas', async () => {
  const { provider, state } = setup();
  state.dnsRecords = [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(provider.validatePublicUrl('https://ejemplo.com/'), /red privada/);
});

test('validatePublicUrl propaga el fallo del DNS', async () => {
  const { provider, state } = setup();
  state.dnsRecords = [];
  await assert.rejects(provider.validatePublicUrl('https://noexiste.invalid/'), {
    code: 'ENOTFOUND',
  });
});

test('requestPage devuelve el HTML de la respuesta', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/landing'));
  const request = state.requests[0];
  assert.equal(request.client, 'https');
  assert.ok(String(request.options.headers.accept).includes('text/html'));
  htmlResponse(request, '<html>hola</html>');
  const result = await promise;
  assert.equal(result.body, '<html>hola</html>');
  assert.equal(result.status, 200);
});

test('requestPage usa HTTP para enlaces http', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('http://ejemplo.com/landing'));
  assert.equal(state.requests[0].client, 'http');
  htmlResponse(state.requests[0], '<html>x</html>');
  await promise;
});

test('requestPage detecta respuestas binarias sin leer el cuerpo', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/a.zip'));
  const request = state.requests[0];
  response(request, { headers: { 'content-type': 'application/octet-stream' } });
  const result = await promise;
  assert.equal(result.binary, true);
  assert.equal(result.body, '');
});

test('requestPage respeta el límite de tamaño de la respuesta', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/'), 8);
  htmlResponse(state.requests[0], '1234567890123456');
  await assert.rejects(promise, /límite de tamaño/);
});

test('requestPage agota el tiempo de espera', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/'));
  const request = state.requests[0];
  assert.equal(request.timeoutMs, 12000);
  request.timeoutHandler();
  await assert.rejects(promise, /tiempo de espera/);
});

test('requestPage rechaza si el socket falla', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/'));
  state.requests[0].emit('error', new Error('ECONNRESET'));
  await assert.rejects(promise, { message: 'ECONNRESET' });
});

test('requestPage bloquea redirecciones DNS a redes privadas', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/'));
  const request = state.requests[0];
  state.dnsRecords = [{ address: '172.16.1.1', family: 4 }];
  request.options.lookup('ejemplo.com', { all: true }, (error) => {
    assert.equal(error.message, 'La conexión intentó acceder a una red privada.');
  });
  htmlResponse(request, '<html>x</html>');
  await promise;
});

test('requestPage propaga la resolución del DNS en el lookup', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/'));
  const request = state.requests[0];
  request.options.lookup('ejemplo.com', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.equal(addresses[0].address, '93.184.216.34');
  });
  htmlResponse(request, '<html>x</html>');
  await promise;
});

test('resolveUrl resuelve un enlace directo', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://ejemplo.com/a.zip');
  await waitForRequests(state, 1);
  response(state.requests[0], { headers: { 'content-type': 'application/octet-stream' } });
  const resolved = await promise;
  assert.equal(resolved.finalUrl, 'https://ejemplo.com/a.zip');
  assert.equal(resolved.domain, 'ejemplo.com');
  assert.equal(resolved.mode, 'direct');
  assert.deepEqual(
    resolved.chain.map((c) => c.method),
    ['initial'],
  );
});

test('resolveUrl recorre redirecciones cortas', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://acortador.com/x');
  await waitForRequests(state, 1);
  htmlResponse(state.requests[0], '', { status: 302, headers: { location: '/final.zip' } });
  await waitForRequests(state, 2);
  const finalRequest = state.requests[1];
  assert.equal(finalRequest.url.href, 'https://acortador.com/final.zip');
  response(finalRequest, { headers: { 'content-type': 'application/octet-stream' } });
  const resolved = await promise;
  assert.equal(resolved.mode, 'short-url');
  assert.deepEqual(
    resolved.chain.map((c) => c.method),
    ['initial', 'redirect'],
  );
  assert.equal(resolved.chain[0].status, 302);
  assert.equal(resolved.chain[1].status, 200);
});

test('resolveUrl detecta ciclos de redirección', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://ejemplo.com/a');
  await waitForRequests(state, 1);
  htmlResponse(state.requests[0], '', { status: 302, headers: { location: '/b' } });
  await waitForRequests(state, 2);
  htmlResponse(state.requests[1], '', { status: 302, headers: { location: '/a' } });
  await assert.rejects(promise, /ciclo/);
});

test('resolveUrl no supera el límite de 12 redirecciones', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://ejemplo.com/0');
  for (let i = 0; i < 12; i += 1) {
    await waitForRequests(state, i + 1);
    htmlResponse(state.requests[i], '', { status: 302, headers: { location: `/${i + 1}` } });
  }
  await assert.rejects(promise, /máximo de 12/);
});

test('resolveUrl extrae el CDN directo de MediaFire', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://www.mediafire.com/file/abc/foo.zip/file');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    `<html><head><meta property="og:title" content="Foo" /></head>
     <body><a id="downloadButton" href="https://download946.mediafire.com/token/abc/foo.zip">Bajar</a></body></html>`,
  );
  const resolved = await promise;
  assert.equal(resolved.mode, 'mediafire-direct');
  assert.equal(resolved.title, 'Foo');
  assert.equal(resolved.finalUrl, 'https://download946.mediafire.com/token/abc/foo.zip');
  assert.equal(resolved.domain, 'mediafire.com');
});

test('resolveUrl sigue un enlace de descarga de la página', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://publi.com/salto');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><body><a id="downloadButton" href="https://cdn.com/final.zip">Bajar</a></body></html>',
  );
  await waitForRequests(state, 2);
  const cdn = state.requests[1];
  assert.equal(cdn.url.href, 'https://cdn.com/final.zip');
  response(cdn, { headers: { 'content-type': 'application/octet-stream' } });
  const resolved = await promise;
  assert.equal(resolved.mode, 'page-link');
  assert.deepEqual(
    resolved.chain.map((c) => c.method),
    ['page-link', 'redirect'],
  );
});

test('resolveUrl marca páginas publicitarias cuando no hay enlace final', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://publi.com/ad');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><head><meta http-equiv="refresh" content="0; url=https://publi.com/paso2"></head></html>',
  );
  await waitForRequests(state, 2);
  htmlResponse(state.requests[1], '<html><body>sin enlaces</body></html>');
  const resolved = await promise;
  assert.equal(resolved.mode, 'advertising-page');
  assert.deepEqual(
    resolved.chain.map((c) => c.method),
    ['meta-refresh', 'redirect'],
  );
  assert.equal(resolved.finalUrl, 'https://publi.com/paso2');
});

test('resolveUrl tolera destinos con codificación inválida', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://publi.com/salto');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><body><a id="downloadButton" href="https://cdn.com/a%zz.bin">Bajar</a></body></html>',
  );
  await waitForRequests(state, 2);
  const cdn = state.requests[1];
  assert.equal(cdn.url.href, 'https://cdn.com/a%zz.bin');
  response(cdn, { headers: { 'content-type': 'application/octet-stream' } });
  const resolved = await promise;
  assert.equal(resolved.mode, 'page-link');
  assert.equal(resolved.finalUrl, 'https://cdn.com/a%zz.bin');
});

test('resolveUrl marca una página de MediaFire sin enlace directo', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://www.mediafire.com/file/abc/foo.zip/file');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><head><meta property="og:title" content="Foo" /></head><body>sin enlace</body></html>',
  );
  const resolved = await promise;
  assert.equal(resolved.mode, 'mediafire-page');
  assert.equal(resolved.finalUrl, 'https://mediafire.com/file/abc/foo.zip/file');
  assert.equal(resolved.title, 'Foo');
  assert.equal(state.requests.length, 1);
});

test('resolveUrl extrae el CDN de MediaFire desde otra página', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://publi.com/salto');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><body><a id="downloadButton" href="https://download999.mediafire.com/token/abc/foo.zip">Bajar</a></body></html>',
  );
  const resolved = await promise;
  assert.equal(resolved.mode, 'mediafire-direct');
  assert.equal(resolved.finalUrl, 'https://download999.mediafire.com/token/abc/foo.zip');
  assert.equal(state.requests.length, 1);
});

test('isPrivateAddress detecta rangos IPv4 e IPv6 reservados', () => {
  const { provider, state } = setup();
  assert.equal(state.requests.length, 0);
  const privates = [
    '0.1.2.3',
    '10.0.0.5',
    '127.0.0.1',
    '169.254.10.1',
    '172.16.9.9',
    '172.31.9.9',
    '192.168.1.1',
    '224.0.0.1',
    '239.1.1.1',
    '::ffff:10.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'fe90::1',
    'fea0::1',
    'feb0::1',
  ];
  for (const value of privates) assert.equal(provider.isPrivateAddress(value), true, value);
  const publics = [
    '8.8.8.8',
    '93.184.216.34',
    '169.255.0.1',
    '172.15.1.1',
    '172.32.1.1',
    '192.169.1.1',
    '191.168.1.1',
    '2001:db8::1',
    'fe00::1',
  ];
  for (const value of publics) assert.equal(provider.isPrivateAddress(value), false, value);
});

test('validatePublicUrl valida el formato sin llegar al DNS', async () => {
  const { provider, state } = setup();
  await assert.rejects(provider.validatePublicUrl('no es una url'), /Ingresa una URL válida/);
  await assert.rejects(provider.validatePublicUrl('ftp://ejemplo.com/a'), /Solo se admiten/);
  await assert.rejects(
    provider.validatePublicUrl('https://usuario:clave@ejemplo.com/a'),
    /credenciales/,
  );
  await assert.rejects(provider.validatePublicUrl('https://localhost/a'), /locales/);
  await assert.rejects(provider.validatePublicUrl('https://equipo.local/a'), /locales/);
  assert.equal(state.dnsLookups.length, 0);
});

test('requestPage propaga el fallo del lookup y admite resolución simple', async () => {
  const { provider, state } = setup();
  const promise = provider.requestPage(new URL('https://ejemplo.com/'));
  const request = state.requests[0];
  htmlResponse(request, '<html>x</html>');
  await promise;

  state.dnsError = new Error('ESERVFAIL');
  await new Promise((resolve) => {
    request.options.lookup('ejemplo.com', { all: true }, (error) => {
      assert.equal(error.message, 'ESERVFAIL');
      resolve();
    });
  });

  state.dnsError = null;
  await new Promise((resolve) => {
    request.options.lookup('ejemplo.com', {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, '93.184.216.34');
      assert.equal(family, 4);
      resolve();
    });
  });
});

test('requestPage reporta estados no 2xx y respuestas sin content-type', async () => {
  const { provider, state } = setup();
  const error = provider.requestPage(new URL('https://ejemplo.com/error'));
  const request = state.requests[0];
  const res = response(request, { status: 503, body: 'cuerpo' });
  res.emit('data', Buffer.from('cuerpo'));
  res.emit('end');
  const first = await error;
  assert.equal(first.status, 503);
  assert.equal(first.binary, undefined);
  assert.equal(first.body, 'cuerpo');

  const plain = provider.requestPage(new URL('https://ejemplo.com/otro'));
  const plainRequest = state.requests[1];
  const plainResponse = new EventEmitter();
  plainResponse.statusCode = undefined;
  plainResponse.headers = {};
  plainResponse.resume = () => {};
  plainRequest.callback(plainResponse);
  plainResponse.emit('data', Buffer.from('x'));
  plainResponse.emit('end');
  const second = await plain;
  assert.equal(second.status, 0);
  assert.equal(second.contentType, '');
  assert.equal(second.body, 'x');
});

test('urlCandidate acepta enlaces http(s) y descarta el resto', () => {
  const { provider } = setup();
  assert.equal(provider.urlCandidate('https://cdn.com/a.zip', undefined), 'https://cdn.com/a.zip');
  assert.equal(
    provider.urlCandidate('//cdn.com/a.zip', 'https://base.com'),
    'https://cdn.com/a.zip',
  );
  assert.equal(provider.urlCandidate('ftp://cdn.com/a.zip', undefined), null);
  assert.equal(provider.urlCandidate('http://[abc/', 'https://base.com'), null);
});

test('extractDestination usa parámetros, meta-refresh, enlaces y scripts', () => {
  const { provider } = setup();
  assert.deepEqual(
    provider.extractDestination(
      new URL('https://x.com/?x=1'),
      '<meta http-equiv="refresh" content="0; url=https://dest.com/m.zip">',
    ),
    { url: 'https://dest.com/m.zip', method: 'meta-refresh' },
  );
  assert.deepEqual(
    provider.extractDestination(
      new URL('https://x.com/?to=https://dest.com/f.zip'),
      '<html></html>',
    ),
    { url: 'https://dest.com/f.zip', method: 'query' },
  );
  assert.equal(provider.extractDestination(new URL('https://x.com/?x=1'), ''), null);
  assert.deepEqual(
    provider.extractDestination(
      new URL('https://pub.com/ad'),
      '<html><script>window.location.href = "https://cdn.com/final.zip";</script></html>',
    ),
    { url: 'https://cdn.com/final.zip', method: 'page-script' },
  );
  assert.deepEqual(
    provider.extractDestination(
      new URL('https://pub.com/ad'),
      '<html><script>redirectUrl = "https://cdn.com/f2.zip";</script></html>',
    ),
    { url: 'https://cdn.com/f2.zip', method: 'page-script' },
  );
});

test('extractMediafireTitle usa og:title y cae al <title>', () => {
  const { provider } = setup();
  assert.equal(provider.extractMediafireTitle(''), '');
  assert.equal(provider.extractMediafireTitle('<html>sin titulo'), '');
  assert.equal(
    provider.extractMediafireTitle('<html><head><title>  Mi   archivo  </title></head></html>'),
    'Mi archivo',
  );
  assert.equal(
    provider.extractMediafireTitle(
      '<html><head><meta property="og:title" content="  OG  " /></head></html>',
    ),
    'OG',
  );
});

test('extractMediafireDirect encuentra el CDN por botón o patrón en texto', () => {
  const { provider } = setup();
  assert.equal(provider.extractMediafireDirect('', undefined), null);
  assert.equal(
    provider.extractMediafireDirect(
      '<a id="downloadButton" href="https://download946.mediafire.com/t/abc.zip"></a>',
      'https://www.mediafire.com/',
    ),
    'https://download946.mediafire.com/t/abc.zip',
  );
  assert.equal(
    provider.extractMediafireDirect(
      '<script>var link = "https:\\/\\/download12.mediafire.com\\/node\\/\\/file.zip";</script>',
      'https://www.mediafire.com/',
    ),
    'https://download12.mediafire.com/node//file.zip',
  );
  assert.equal(
    provider.extractMediafireDirect(
      '<a id="downloadButton" href="https://cdn.com/x.zip"></a>',
      'https://www.mediafire.com/',
    ),
    null,
  );
});

test('resolveUrl resuelve binarios y páginas de texto en hosts IP', async () => {
  const { provider, state } = setup();
  const binary = provider.resolveUrl('https://93.184.216.34/x.zip');
  await waitForRequests(state, 1);
  response(state.requests[0], { headers: { 'content-type': 'application/octet-stream' } });
  const direct = await binary;
  assert.equal(direct.mode, 'direct');
  assert.equal(direct.domain, '93.184.216.34');

  const text = provider.resolveUrl('https://93.184.216.34/planos');
  await waitForRequests(state, 2);
  const plainResponse = response(state.requests[1], { headers: { 'content-type': 'text/plain' } });
  plainResponse.emit('data', Buffer.from('texto plano'));
  plainResponse.emit('end');
  const plain = await text;
  assert.equal(plain.mode, 'direct');
  assert.equal(plain.finalUrl, 'https://93.184.216.34/planos');
});

test('resolveUrl extrae un CDN de MediaFire desde una página en IP', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://93.184.216.34/ad');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><body><a id="downloadButton" href="https://download999.mediafire.com/token/abc/foo.zip">Bajar</a></body></html>',
  );
  const resolved = await promise;
  assert.equal(resolved.mode, 'mediafire-direct');
  assert.equal(resolved.domain, '93.184.216.34');
});

test('resolveUrl marca páginas publicitarias en hosts IP', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://93.184.216.34/a1');
  await waitForRequests(state, 1);
  htmlResponse(
    state.requests[0],
    '<html><head><meta http-equiv="refresh" content="0; url=https://93.184.216.34/a2"></head></html>',
  );
  await waitForRequests(state, 2);
  htmlResponse(state.requests[1], '<html><body>sin enlaces</body></html>');
  const resolved = await promise;
  assert.equal(resolved.mode, 'advertising-page');
  assert.equal(resolved.domain, '93.184.216.34');
});
test('resolveUrl recorre redirecciones a páginas de texto sin enlace', async () => {
  const { provider, state } = setup();
  const promise = provider.resolveUrl('https://acortador.com/x');
  await waitForRequests(state, 1);
  htmlResponse(state.requests[0], '', { status: 302, headers: { location: '/end' } });
  await waitForRequests(state, 2);
  htmlResponse(state.requests[1], '<html>sin enlaces</html>');
  const resolved = await promise;
  assert.equal(resolved.mode, 'short-url');
  assert.equal(resolved.finalUrl, 'https://acortador.com/end');
});
