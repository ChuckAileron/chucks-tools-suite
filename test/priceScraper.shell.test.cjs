const test = require('node:test');
const assert = require('node:assert/strict');
const { installHooks, restoreHooks } = require('./helpers/moduleHooks.cjs');

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

function textResponse(body) {
  return { status: 200, contentType: 'text/html', body, headers: {} };
}

installHooks({
  './urlResolver.cjs': {
    requestPage: async (target, maxBytes) => {
      const url = String(target);
      state.calls.push({ url, maxBytes });
      const index = state.responses.findIndex((item) => !item.predicate || item.predicate(url));
      if (index < 0) throw new Error(`No hay respuesta simulada para ${url}`);
      const entry = state.responses[index];
      if (!entry.predicate) state.responses.splice(index, 1);
      const response = entry.response;
      if (typeof response === 'function') return response(url, maxBytes);
      return response;
    },
    validatePublicUrl: async (value) => String(value),
  },
});

let priceScraper;
delete require.cache[require.resolve('../electron/priceScraper.cjs')];
priceScraper = require('../electron/priceScraper.cjs');

const { scrapePrice, extractPrice, numberFromPrice, currencyFromText, findOffer } = priceScraper;

test('scrapePrice extrae el precio de un JSON-LD', async () => {
  resetStubs();
  queueResponse(
    textResponse(
      '<script type="application/ld+json">{"offers":{"price":"19.99","priceCurrency":"USD"}}</script>',
    ),
  );
  assert.deepEqual(await scrapePrice('https://tienda.com/producto'), {
    price: 19.99,
    currency: 'USD',
  });
  assert.equal(state.calls[0].maxBytes, 5 * 1024 * 1024);
});

test('scrapePrice continúa al metadata si el JSON-LD está malformado', async () => {
  resetStubs();
  queueResponse(
    textResponse(
      '<script type="application/ld+json">{ this no es json</script>' +
        '<meta property="product:price:amount" content="12.5" />',
    ),
  );
  assert.deepEqual(await scrapePrice('https://tienda.com/producto'), {
    price: 12.5,
    currency: null,
  });
});

test('scrapePrice sigue redirecciones y vuelve a validar la URL', async () => {
  resetStubs();
  queueResponse({
    status: 302,
    location: '/mover',
    body: '',
    headers: {},
    contentType: 'text/html',
  });
  queueResponse(textResponse('<meta property="product:price:amount" content="9.5" />'));
  assert.deepEqual(await scrapePrice('https://tienda.com/1'), { price: 9.5, currency: null });
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[1].url, 'https://tienda.com/mover');
});

test('scrapePrice lanza con estados HTTP no 2xx', async () => {
  resetStubs();
  queueResponse({ status: 503, body: '', headers: {}, contentType: 'text/html' });
  await assert.rejects(scrapePrice('https://tienda.com/1'), /HTTP 503/);
});

test('scrapePrice rechaza páginas sin contenido HTML', async () => {
  resetStubs();
  queueResponse({ status: 200, contentType: 'application/json', body: '{}', headers: {} });
  await assert.rejects(scrapePrice('https://tienda.com/1'), /HTML/);
});

test('scrapePrice informa cuando no hay precio reconocible', async () => {
  resetStubs();
  queueResponse(textResponse('<html><body>no hay precio</body></html>'));
  await assert.rejects(scrapePrice('https://tienda.com/1'), /No se encontró un precio/);
});

test('scrapePrice aborta tras el máximo de redirecciones', async () => {
  resetStubs();
  for (let i = 0; i < 6; i += 1) {
    queueResponse({
      status: 302,
      location: `/r${i}`,
      body: '',
      headers: {},
      contentType: 'text/html',
    });
  }
  await assert.rejects(scrapePrice('https://tienda.com/1'), /máximo de redirecciones/);
  assert.equal(state.calls.length, 6);
});

test('scrapePrice redefine la URL con la base de la redirección', async () => {
  resetStubs();
  let validated = [];
  delete require.cache[require.resolve('../electron/priceScraper.cjs')];
  installHooks({
    './urlResolver.cjs': {
      requestPage: async (target) => {
        const url = String(target);
        state.calls.push({ url });
        const index = state.responses.findIndex((item) => !item.predicate || item.predicate(url));
        if (index < 0) throw new Error(`No hay respuesta simulada para ${url}`);
        const entry = state.responses[index];
        if (!entry.predicate) state.responses.splice(index, 1);
        const response = entry.response;
        if (typeof response === 'function') return response(url);
        return response;
      },
      validatePublicUrl: async (value) => {
        validated.push(String(value));
        return String(value);
      },
    },
  });
  const { scrapePrice: freshScrape } = require('../electron/priceScraper.cjs');
  queueResponse({
    status: 301,
    location: 'https://cdn.tienda.com/oferta',
    body: '',
    headers: {},
    contentType: 'text/html',
  });
  queueResponse(textResponse('<meta property="product:price:amount" content="3" />'));
  assert.deepEqual(await freshScrape('https://a.tienda.com/x'), { price: 3, currency: null });
  assert.deepEqual(validated, ['https://a.tienda.com/x', 'https://cdn.tienda.com/oferta']);
  restoreHooks();
});

test('numberFromPrice normaliza formatos internacionales y rechaza inválidos', () => {
  assert.equal(numberFromPrice(19.99), 19.99);
  assert.equal(numberFromPrice(NaN), null);
  assert.equal(numberFromPrice('9.5'), 9.5);
  assert.equal(numberFromPrice('1.234,56'), 1234.56);
  assert.equal(numberFromPrice('1,234.56'), 1234.56);
  assert.equal(numberFromPrice('1,234,56'), null);
  assert.equal(numberFromPrice('$ 9.5'), 9.5);
  assert.equal(numberFromPrice(''), null);
  assert.equal(numberFromPrice('#sin numeros'), null);
});

test('currencyFromText reconoce códigos y símbolos', () => {
  assert.equal(currencyFromText(undefined), null);
  assert.equal(currencyFromText('USD 19.99'), 'USD');
  assert.equal(currencyFromText('19.99 EUR'), 'EUR');
  assert.equal(currencyFromText('12,99 €'), 'EUR');
  assert.equal(currencyFromText('£ 9'), 'GBP');
  assert.equal(currencyFromText('¥ 100'), 'JPY');
  assert.equal(currencyFromText('$ 5'), 'USD');
  assert.equal(currencyFromText('sin pista'), null);
});

test('findOffer busca en arrays, lowPrice y texto de moneda', () => {
  assert.equal(findOffer(null), null);
  assert.equal(findOffer('texto'), null);
  assert.equal(findOffer([]), null);
  assert.deepEqual(findOffer([{ price: '3' }]), { price: 3, currency: null });
  assert.deepEqual(findOffer([{ foo: 'x' }, { price: '1' }]), { price: 1, currency: null });
  assert.deepEqual(findOffer({ lowPrice: '5.5' }), { price: 5.5, currency: null });
  assert.deepEqual(findOffer({ price: '12 €' }), { price: 12, currency: 'EUR' });
  assert.equal(findOffer({ foo: 'bar' }), null);
  assert.equal(findOffer({ price: 'sin numeros' }), null);
  assert.deepEqual(findOffer({ price: null, lowPrice: '2.5', priceCurrency: 'MXN' }), {
    price: 2.5,
    currency: 'MXN',
  });
});

test('extractPrice usa la moneda declarada en el metadata', () => {
  const html =
    '<meta property="product:price:amount" content="9.9" />' +
    '<meta property="product:price:currency" content="mxn" />';
  assert.deepEqual(extractPrice(html), { price: 9.9, currency: 'MXN' });
});

test('extractPrice cae al texto de un elemento de precio', () => {
  const html = '<span class="price">199.00 USD</span>';
  assert.deepEqual(extractPrice(html), { price: 199, currency: 'USD' });
});

test('extractPrice devuelve null sin precio reconocible', () => {
  assert.equal(extractPrice('<html></html>'), null);
});
