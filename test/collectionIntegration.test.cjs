const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CollectionManager } = require('../electron/collectionManager.cjs');
const { extractPrice, numberFromPrice } = require('../electron/priceScraper.cjs');

const managerForTest = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chucks-collections-'));
  const manager = new CollectionManager(path.join(directory, 'collections.sqlite'));
  return {
    manager,
    close() {
      manager.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
};

test('integra colecciones tipadas, ítems e imágenes URL', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Películas',
      description: 'Catálogo',
      columns: [
        { name: 'year', label: 'Año', type: 'number', required: true },
        { name: 'watched', label: 'Vista', type: 'boolean' },
      ],
    });
    const item = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'Alien',
      values: { year: '1979', watched: true },
      imageUrl: 'https://example.com/alien.jpg',
      tags: ['ciencia ficción'],
    });
    assert.equal(item.values.year, 1979);
    assert.equal(item.imageUrl, 'https://example.com/alien.jpg');
    assert.deepEqual(
      fixture.manager.listItems(collection.id).map((entry) => entry.name),
      ['Alien'],
    );
    assert.throws(
      () => fixture.manager.addItem({ collectionId: collection.id, name: 'Sin año', values: {} }),
      /obligatoria/,
    );
  } finally {
    fixture.close();
  }
});

test('exporta e importa una colección con nombre único', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({ name: 'Libros' });
    fixture.manager.addItem({ collectionId: collection.id, name: 'Dune' });
    const exported = fixture.manager.exportCollection(collection.id);
    const imported = fixture.manager.importCollection(exported, 'rename');
    assert.equal(imported.name, 'Libros (2)');
    assert.equal(fixture.manager.listItems(imported.id)[0].name, 'Dune');
  } finally {
    fixture.close();
  }
});

test('no sobrescribe una colección y borra ítems en cascada', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({ name: 'Juegos' });
    fixture.manager.addItem({ collectionId: collection.id, name: 'Portal' });
    assert.throws(() => fixture.manager.createCollection({ name: 'juegos' }), /Ya existe/);
    assert.equal(fixture.manager.deleteCollection(collection.id), true);
    assert.equal(fixture.manager.getCollection(collection.id), null);
  } finally {
    fixture.close();
  }
});

test('wishlist persiste artículos y múltiples páginas de precio', () => {
  const fixture = managerForTest();
  try {
    const item = fixture.manager.createWishlistItem({
      name: 'Steam Deck',
      manufacturer: 'Valve',
      year: 2022,
    });
    const source = fixture.manager.addWishlistPrice(item.id, {
      store: 'Tienda',
      url: 'https://example.com/steam-deck',
    });
    fixture.manager.updateWishlistPriceResult(source.id, { price: 399.99, currency: 'USD' });
    const saved = fixture.manager.getWishlistItem(item.id);
    assert.equal(saved.prices[0].price, 399.99);
    assert.equal(saved.prices[0].currency, 'USD');
    assert.equal(fixture.manager.listWishlist('valve')[0].name, 'Steam Deck');
    assert.throws(
      () => fixture.manager.addWishlistPrice(item.id, { url: source.url }),
      /ya está agregada/,
    );
    assert.equal(fixture.manager.deleteWishlistItem(item.id), true);
    assert.equal(fixture.manager.getWishlistPrice(source.id), null);
  } finally {
    fixture.close();
  }
});

test('scraper reconoce JSON-LD y formatos decimales de precio', () => {
  const result = extractPrice(`
    <script type="application/ld+json">
      {"@type":"Product","offers":{"price":"1.299,95","priceCurrency":"EUR"}}
    </script>
  `);
  assert.deepEqual(result, { price: 1299.95, currency: 'EUR' });
  assert.equal(numberFromPrice('$ 49.99'), 49.99);
});

test('scraper usa metadatos de producto como fallback', () => {
  const result = extractPrice(`
    <meta property="product:price:amount" content="24.50">
    <meta property="product:price:currency" content="USD">
  `);
  assert.deepEqual(result, { price: 24.5, currency: 'USD' });
});
