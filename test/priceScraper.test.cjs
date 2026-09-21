const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPrice,
  numberFromPrice,
  currencyFromText,
  findOffer,
} = require('../electron/priceScraper.cjs');

test('convierte textos de precio a número', () => {
  assert.equal(numberFromPrice(12), 12);
  assert.equal(numberFromPrice(NaN), null);
  assert.equal(numberFromPrice('19.99'), 19.99);
  assert.equal(numberFromPrice('1.299,99'), 1299.99);
  assert.equal(numberFromPrice('1,299.00'), 1299);
  assert.equal(numberFromPrice('$ 2 500'), 2500);
  assert.equal(numberFromPrice('gratis'), null);
  assert.equal(numberFromPrice(''), null);
  assert.equal(numberFromPrice(null), null);
});

test('detecta moneda desde texto o símbolo', () => {
  assert.equal(currencyFromText('Precio en MXN'), 'MXN');
  assert.equal(currencyFromText('precio eur'), 'EUR');
  assert.equal(currencyFromText('€ 10'), 'EUR');
  assert.equal(currencyFromText('£5'), 'GBP');
  assert.equal(currencyFromText('¥100'), 'JPY');
  assert.equal(currencyFromText('$10'), 'USD');
  assert.equal(currencyFromText('sin moneda'), null);
  assert.equal(currencyFromText(''), null);
  assert.equal(currencyFromText(null), null);
});

test('encuentra ofertas en JSON-LD anidado', () => {
  assert.equal(findOffer(null), null);
  assert.equal(findOffer('texto'), null);
  assert.equal(findOffer([]), null);
  assert.deepEqual(findOffer({ price: '10', priceCurrency: 'EUR' }), {
    price: 10,
    currency: 'EUR',
  });
  assert.deepEqual(findOffer({ lowPrice: '5' }), { price: 5, currency: null });
  assert.deepEqual(findOffer({ offers: [{ price: '7' }] }), { price: 7, currency: null });
  assert.deepEqual(findOffer([{ nada: 1 }, { price: '3.5', priceCurrency: 'USD' }]), {
    price: 3.5,
    currency: 'USD',
  });
  assert.equal(findOffer({ price: 'gratis' }), null);
});

test('extrae precio desde JSON-LD de la página', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@type":"Product","offers":{"price":"19.99","priceCurrency":"USD"}}
  </script></head><body></body></html>`;
  assert.deepEqual(extractPrice(html), { price: 19.99, currency: 'USD' });
});

test('extrae precio desde metadatos de la página', () => {
  const html = `<html><head>
    <meta property="product:price:amount" content="25.50" />
    <meta property="product:price:currency" content="eur" />
  </head><body></body></html>`;
  assert.deepEqual(extractPrice(html), { price: 25.5, currency: 'EUR' });
});

test('extrae precio desde texto visible como respaldo', () => {
  const html = `<html><body><span class="price">$ 1,299.00</span></body></html>`;
  assert.deepEqual(extractPrice(html), { price: 1299, currency: 'USD' });
  assert.equal(extractPrice('<html><body>sin precio</body></html>'), null);
  assert.equal(extractPrice(''), null);
});
