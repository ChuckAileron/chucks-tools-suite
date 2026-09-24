const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { CollectionManager } = require('../electron/collectionManager.cjs');
const { extractPrice, numberFromPrice } = require('../electron/priceScraper.cjs');

const managerForTest = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chucks-collections-'));
  const dbPath = path.join(directory, 'collections.sqlite');
  const manager = new CollectionManager(dbPath);
  return {
    manager,
    dbPath,
    close() {
      manager.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
};

const withLock = (fixture, fn) => {
  const lock = new DatabaseSync(fixture.dbPath);
  lock.exec('BEGIN IMMEDIATE');
  try {
    fn();
  } finally {
    lock.exec('ROLLBACK');
    lock.close();
  }
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

test('reordena las pestañas de colecciones y las persiste', () => {
  const fixture = managerForTest();
  try {
    const first = fixture.manager.createCollection({ name: 'Primera' });
    const second = fixture.manager.createCollection({ name: 'Segunda' });
    const third = fixture.manager.createCollection({ name: 'Tercera' });
    const names = () => fixture.manager.listCollections().map((collection) => collection.name);
    assert.deepEqual(names(), ['Primera', 'Segunda', 'Tercera']);
    const reordered = fixture.manager.reorderCollections([third.id, first.id, second.id]);
    assert.deepEqual(
      reordered.map((collection) => collection.name),
      ['Tercera', 'Primera', 'Segunda'],
    );
    assert.deepEqual(names(), ['Tercera', 'Primera', 'Segunda']);
    assert.equal(fixture.manager.listCollections()[0].position, 0);
    assert.throws(() => fixture.manager.reorderCollections([first.id, first.id]), /duplicadas/);
    assert.throws(() => fixture.manager.reorderCollections([first.id, 999999]), /no existen/);
  } finally {
    fixture.close();
  }
});

test('las colecciones nuevas se agregan al final del orden', () => {
  const fixture = managerForTest();
  try {
    fixture.manager.createCollection({ name: 'A' });
    fixture.manager.createCollection({ name: 'B' });
    const late = fixture.manager.createCollection({ name: 'C' });
    const collections = fixture.manager.listCollections();
    assert.deepEqual(
      collections.map((entry) => entry.name),
      ['A', 'B', 'C'],
    );
    assert.equal(collections[2].position, collections[0].position + 2);
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

test('tolera JSON corrupto guardado en la base', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({ name: 'Sana' });
    fixture.manager.addItem({ collectionId: collection.id, name: 'Item' });
    const brokenSchema = fixture.manager.db
      .prepare('INSERT INTO collections (name, schema_json) VALUES (?, ?)')
      .run('Rota', '{mal');
    fixture.manager.db
      .prepare(
        'UPDATE collection_items SET metadata_json = ?, tags_json = ? WHERE collection_id = ?',
      )
      .run('{mal', '[no', collection.id);
    assert.deepEqual(fixture.manager.getCollection(brokenSchema.lastInsertRowid).columns, []);
    assert.deepEqual(fixture.manager.listItems(collection.id)[0].values, {});
    assert.deepEqual(fixture.manager.listItems(collection.id)[0].tags, []);
  } finally {
    fixture.close();
  }
});

test('rechaza URLs inválidas en imágenes, columnas y tiendas', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Webs',
      columns: [{ name: 'site', type: 'url' }],
    });
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'X',
          imageUrl: 'http://[abc/',
        }),
      /imagen/,
    );
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'X',
          imageUrl: 'ftp://cdn.example.com/x.jpg',
        }),
      /imagen/,
    );
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'X',
          imageUrl: 123,
        }),
      /imagen/,
    );
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'X',
          values: { site: 'http://[abc/' },
        }),
      /URL/,
    );
    const wishlist = fixture.manager.createWishlistItem({ name: 'Tienda' });
    assert.throws(
      () => fixture.manager.addWishlistPrice(wishlist.id, { url: 'no-es-una-url' }),
      /URL/,
    );
  } finally {
    fixture.close();
  }
});

test('acepta esquemas de columnas escritos como objeto', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Objeto',
      columns: { title: 'string', count: 'number' },
    });
    assert.deepEqual(
      collection.columns.map((column) => `${column.name}:${column.type}`),
      ['title:string', 'count:number'],
    );
  } finally {
    fixture.close();
  }
});

test('omite valores vacíos de columnas no obligatorias', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Opcionales',
      columns: [
        { name: 'notes', type: 'string' },
        { name: 'rating', type: 'number' },
      ],
    });
    const item = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'X',
      values: { notes: '', rating: null },
    });
    assert.equal('notes' in item.values, false);
    assert.equal('rating' in item.values, false);
  } finally {
    fixture.close();
  }
});

test('las booleanas obligatorias quedan en falso por defecto', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Booleanas',
      columns: [{ name: 'owned', label: '¿En Colección?', type: 'boolean', required: true }],
    });
    const item = fixture.manager.addItem({ collectionId: collection.id, name: 'X' });
    assert.equal(item.values.owned, false);
    const viaEditor = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'Y',
      values: { owned: '' },
    });
    assert.equal(viaEditor.values.owned, false);
  } finally {
    fixture.close();
  }
});

test('valida booleanos, fechas, URLs y etiquetas en las columnas', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Tipos',
      columns: [
        { name: 'active', type: 'boolean' },
        { name: 'released', type: 'date' },
        { name: 'website', type: 'url' },
        { name: 'tags', type: 'tags' },
      ],
    });
    const item = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'X',
      values: {
        active: 'false',
        released: '2020-05-10',
        website: 'https://example.com',
        tags: ' sci-fi , acción,, ',
      },
    });
    assert.equal(item.values.active, false);
    assert.equal(item.values.released, '2020-05-10T00:00:00.000Z');
    assert.equal(item.values.website, 'https://example.com');
    assert.deepEqual(item.values.tags, ['sci-fi', 'acción']);
    const arrayTags = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'Y',
      values: { tags: ['a', ' b '] },
    });
    assert.deepEqual(arrayTags.values.tags, ['a', 'b']);
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'Z',
          values: { active: 'tal vez' },
        }),
      /verdadero o falso/,
    );
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'Z',
          values: { released: 'no-es-fecha' },
        }),
      /fecha/,
    );
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: collection.id,
          name: 'Z',
          values: { website: 'http://[abc/' },
        }),
      /URL/,
    );
  } finally {
    fixture.close();
  }
});

test('actualiza parcialmente una colección y valida su nombre', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Vieja',
      description: 'antes',
      columns: [{ name: 'a', type: 'string' }],
    });
    const updated = fixture.manager.updateCollection(collection.id, {
      description: 'después',
      columns: { b: 'number' },
    });
    assert.equal(updated.name, 'Vieja');
    assert.equal(updated.description, 'después');
    assert.deepEqual(
      updated.columns.map((column) => `${column.name}:${column.type}`),
      ['b:number'],
    );
    assert.throws(
      () => fixture.manager.updateCollection(collection.id, { name: '   ' }),
      /nombre de la colección/,
    );
    assert.throws(() => fixture.manager.updateCollection(999999, { name: 'X' }), /no existe/);
  } finally {
    fixture.close();
  }
});

test('busca ítems por nombre dentro de la colección', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({ name: 'Busca' });
    fixture.manager.addItem({ collectionId: collection.id, name: 'Portimon' });
    fixture.manager.addItem({ collectionId: collection.id, name: 'Gremio' });
    fixture.manager.addItem({ collectionId: collection.id, name: 'Portobello' });
    assert.deepEqual(
      fixture.manager.listItems(collection.id, 'PORT').map((item) => item.name),
      ['Portimon', 'Portobello'],
    );
  } finally {
    fixture.close();
  }
});

test('actualiza ítems de forma parcial y rechaza los inexistentes', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Items',
      columns: [{ name: 'size', type: 'number' }],
    });
    const item = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'A',
      values: { size: 3 },
    });
    const updated = fixture.manager.updateItem(item.id, {
      name: 'B',
      values: { size: 9 },
      tags: ['x'],
    });
    assert.equal(updated.name, 'B');
    assert.equal(updated.values.size, 9);
    assert.deepEqual(updated.tags, ['x']);
    assert.equal(updated.imageUrl, null);
    assert.throws(() => fixture.manager.updateItem(999999, { name: 'N' }), /ítem no existe/);
  } finally {
    fixture.close();
  }
});

test('borra ítems y distingue los que ya no existen', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({ name: 'Caja' });
    const item = fixture.manager.addItem({ collectionId: collection.id, name: 'Uno' });
    assert.equal(fixture.manager.deleteItem(item.id), true);
    assert.equal(fixture.manager.deleteItem(item.id), false);
    assert.equal(fixture.manager.getItem(item.id), null);
  } finally {
    fixture.close();
  }
});

test('actualiza artículos de wishlist y valida el año', () => {
  const fixture = managerForTest();
  try {
    const item = fixture.manager.createWishlistItem({ name: 'Consola', year: 2020 });
    const updated = fixture.manager.updateWishlistItem(item.id, { name: 'Portátil', year: 2023 });
    assert.equal(updated.name, 'Portátil');
    assert.equal(updated.year, 2023);
    assert.throws(
      () => fixture.manager.updateWishlistItem(item.id, { year: 99 }),
      /cuatro dígitos/,
    );
    assert.throws(() => fixture.manager.updateWishlistItem(999999, { name: 'X' }), /no existe/);
  } finally {
    fixture.close();
  }
});

test('borra páginas de precio registradas', () => {
  const fixture = managerForTest();
  try {
    const item = fixture.manager.createWishlistItem({ name: 'Consola' });
    const price = fixture.manager.addWishlistPrice(item.id, {
      url: 'https://example.com/consola',
    });
    fixture.manager.addWishlistPrice(item.id, { url: 'https://otra.com/consola' });
    assert.equal(fixture.manager.deleteWishlistPrice(price.id), true);
    assert.equal(fixture.manager.deleteWishlistPrice(price.id), false);
    assert.equal(fixture.manager.getWishlistItem(item.id).prices.length, 1);
  } finally {
    fixture.close();
  }
});

test('reexpone los errores de SQLite que no son por duplicados', () => {
  const fixture = managerForTest();
  try {
    fixture.manager.createCollection({ name: 'A' });
    fixture.manager.createCollection({ name: 'B' });
    const wishlist = fixture.manager.createWishlistItem({ name: 'X' });
    withLock(fixture, () => {
      assert.throws(() => fixture.manager.createCollection({ name: 'Bloqueada' }), /locked/);
      assert.throws(() => fixture.manager.reorderCollections([2, 1]), /locked/);
      assert.throws(
        () => fixture.manager.addWishlistPrice(wishlist.id, { url: 'https://example.com/x' }),
        /locked/,
      );
    });
    assert.deepEqual(
      fixture.manager.listCollections().map((collection) => collection.name),
      ['A', 'B'],
      'el rollback no deja la reordenación parcial aplicada',
    );
  } finally {
    fixture.close();
  }
});

test('hace rollback de una importación con ítems inválidos', () => {
  const fixture = managerForTest();
  try {
    fixture.manager.createCollection({ name: 'Existente' });
    assert.throws(
      () =>
        fixture.manager.importCollection(
          {
            format: 'chucks-collection',
            version: 1,
            collection: {
              name: 'Defectuosa',
              description: '',
              type: 'generic',
              columns: [{ name: 'year', type: 'number', required: true }],
            },
            items: [{ name: 'Sin año', values: {} }],
          },
          'rename',
        ),
      /obligatoria/,
    );
    assert.deepEqual(
      fixture.manager.listCollections().map((collection) => collection.name),
      ['Existente'],
      'la importación fallida no deja colecciones a medias',
    );
  } finally {
    fixture.close();
  }
});

test('valida definiciones de columnas y valores', () => {
  const fixture = managerForTest();
  try {
    assert.throws(
      () => fixture.manager.createCollection({ name: 'X', columns: ['no-objeto'] }),
      /Definición de columna inválida/,
    );
    assert.throws(
      () =>
        fixture.manager.createCollection({
          name: 'X',
          columns: [{ name: '  ', type: 'string' }],
        }),
      /necesita un nombre/,
    );
    const sinTipo = fixture.manager.createCollection({
      name: 'X',
      columns: [{ name: 'libre', label: '' }],
    });
    assert.equal(sinTipo.columns[0].type, 'string');
    assert.equal(sinTipo.columns[0].label, 'libre');
    const conEtiqueta = fixture.manager.createCollection({
      name: 'Y',
      columns: [{ name: 'campo', type: 'boolean', label: 'Campo útil' }],
    });
    assert.equal(conEtiqueta.columns[0].label, 'Campo útil');
    const etiquetaVacia = fixture.manager.createCollection({
      name: 'W',
      columns: [{ name: 'respaldo', type: 'boolean', label: '   ' }],
    });
    assert.equal(etiquetaVacia.columns[0].label, 'respaldo');
    assert.throws(
      () => fixture.manager.createCollection({ name: 'Z', columns: [{ type: 'string' }] }),
      /necesita un nombre/,
    );
    assert.throws(
      () =>
        fixture.manager.createCollection({ name: 'X', columns: [{ name: 'a', type: 'bogus' }] }),
      /Tipo de columna no soportado/,
    );
    assert.throws(
      () =>
        fixture.manager.createCollection({
          name: 'X',
          columns: [
            { name: 'a', type: 'string' },
            { name: 'a', type: 'number' },
          ],
        }),
      /duplicada/,
    );
    const vacio = fixture.manager.createCollection({ name: 'Vacio', columns: undefined });
    assert.deepEqual(vacio.columns, []);
    const sinEstructura = fixture.manager.createCollection({ name: 'SinEstructura', columns: 'x' });
    assert.deepEqual(sinEstructura.columns, []);
    const texto = fixture.manager.createCollection({
      name: 'Texto',
      columns: [{ name: 'nota', type: 'string' }],
    });
    const nota = fixture.manager.addItem({
      collectionId: texto.id,
      name: 'A',
      values: { nota: 'hola' },
    });
    assert.equal(nota.values.nota, 'hola');
    assert.throws(
      () => fixture.manager.addItem({ collectionId: texto.id, name: 'C', values: 'no-objeto' }),
      /deben ser un objeto/,
    );
    const numerico = fixture.manager.createCollection({
      name: 'Num',
      columns: [{ name: 'peso', type: 'number' }],
    });
    assert.throws(
      () =>
        fixture.manager.addItem({
          collectionId: numerico.id,
          name: 'P',
          values: { peso: 'pesado' },
        }),
      /debe ser un número/,
    );
    assert.throws(
      () => fixture.manager.createCollection({ name: '   ' }),
      /nombre de la colección/,
    );
    assert.throws(() => fixture.manager.createCollection({}), /nombre de la colección/);
    assert.throws(() => fixture.manager.reorderCollections('no-arreglo'), /Se necesita al menos/);
    assert.throws(() => fixture.manager.reorderCollections([]), /Se necesita al menos/);
    assert.throws(() => fixture.manager.listItems(999999, 'x'), /no existe/);
    assert.throws(() => fixture.manager.addItem({ collectionId: 999999, name: 'F' }), /no existe/);
    assert.throws(
      () => fixture.manager.addItem({ collectionId: texto.id, name: 'T', tags: 'sueltas' }),
      /arreglo/,
    );
  } finally {
    fixture.close();
  }
});

test('conserva datos previos al actualizar ítems de forma parcial', () => {
  const fixture = managerForTest();
  try {
    const collection = fixture.manager.createCollection({
      name: 'Persistente',
      columns: [{ name: 'nivel', type: 'number' }],
    });
    const item = fixture.manager.addItem({
      collectionId: collection.id,
      name: 'Original',
      values: { nivel: 1 },
      tags: ['viejo'],
      imageUrl: 'https://cdn.example.com/orig.png',
    });
    const updated = fixture.manager.updateItem(item.id, { values: { nivel: 5 } });
    assert.equal(updated.name, 'Original');
    assert.equal(updated.values.nivel, 5);
    assert.deepEqual(updated.tags, ['viejo']);
    assert.equal(updated.imageUrl, 'https://cdn.example.com/orig.png');
    const sinParche = fixture.manager.updateItem(item.id, {});
    assert.equal(sinParche.name, 'Original');
    assert.equal(sinParche.values.nivel, 5);
    assert.deepEqual(sinParche.tags, ['viejo']);
    assert.equal(sinParche.imageUrl, 'https://cdn.example.com/orig.png');
    assert.throws(() => fixture.manager.updateItem(item.id, { name: '  ' }), /obligatorio/);
    assert.throws(
      () =>
        fixture.manager.addItem({ collectionId: collection.id, name: 'ConImagen', imageUrl: 'x' }),
      /imagen/,
    );
  } finally {
    fixture.close();
  }
});

test('cubre los caminos secundarios de la wishlist', () => {
  const fixture = managerForTest();
  try {
    assert.throws(() => fixture.manager.createWishlistItem({}), /obligatorio/);
    const item = fixture.manager.createWishlistItem({ name: 'Retro', manufacturer: 'Nintendo' });
    const updated = fixture.manager.updateWishlistItem(item.id, {});
    assert.equal(updated.name, 'Retro');
    assert.equal(updated.manufacturer, 'Nintendo');
    assert.equal(updated.year, null);
    assert.throws(
      () => fixture.manager.addWishlistPrice(999999, { url: 'https://example.com/x' }),
      /no existe/,
    );
    assert.throws(() => fixture.manager.addWishlistPrice(item.id, {}), /URL/);
    const price = fixture.manager.addWishlistPrice(item.id, { url: 'https://example.com/x' });
    assert.equal(fixture.manager.getWishlistPrice(999999), null);
    assert.equal(fixture.manager.getWishlistPrice(price.id).url, 'https://example.com/x');
    const touched = fixture.manager.updateWishlistPriceResult(price.id, { price: 'abc' });
    assert.equal(touched.price, null);
    assert.equal(touched.currency, null);
    assert.equal(fixture.manager.updateWishlistPriceResult(999999, { price: 1 }), null);
    assert.deepEqual(
      fixture.manager.listWishlist().map((w) => w.name),
      ['Retro'],
    );
    assert.deepEqual(
      fixture.manager.listWishlist('RETRO').map((w) => w.name),
      ['Retro'],
    );
  } finally {
    fixture.close();
  }
});

test('cubre exportación e importación en escenarios extremos', () => {
  const fixture = managerForTest();
  try {
    assert.throws(() => fixture.manager.exportCollection(999999), /no existe/);
    assert.throws(() => fixture.manager.importCollection({}), /no contiene una colección válida/);
    assert.throws(
      () =>
        fixture.manager.importCollection({
          format: 'chucks-collection',
          version: 1,
          collection: { name: '   ' },
        }),
      /no tiene nombre/,
    );
    assert.throws(
      () =>
        fixture.manager.importCollection({
          format: 'chucks-collection',
          version: 1,
          collection: {},
        }),
      /no tiene nombre/,
    );
    const sinDatos = fixture.manager.importCollection({
      format: 'chucks-collection',
      version: 1,
      collection: { name: 'SinDatos' },
    });
    assert.deepEqual(sinDatos.columns, []);
    const conSoloNombre = fixture.manager.importCollection({
      format: 'chucks-collection',
      version: 1,
      collection: { name: 'Minima' },
      items: [{ name: 'Puro' }],
    });
    const minimos = fixture.manager.listItems(conSoloNombre.id);
    assert.equal(minimos.length, 1);
    assert.deepEqual(minimos[0].values, {});
    assert.deepEqual(minimos[0].tags, []);
    assert.equal(minimos[0].imageUrl, null);
    fixture.manager.createCollection({ name: 'Duplicada' });
    const renombrada = fixture.manager.importCollection(
      {
        format: 'chucks-collection',
        version: 1,
        collection: { name: 'Duplicada', schema: [{ name: 'a', type: 'string' }] },
        items: [
          { name: 'Legacy', metadata: { a: 'x' }, imagePath: 'https://cdn.example.com/pic.png' },
        ],
      },
      'rename',
    );
    assert.equal(renombrada.name, 'Duplicada (2)');
    assert.throws(
      () =>
        fixture.manager.importCollection(
          {
            format: 'chucks-collection',
            version: 1,
            collection: { name: 'Duplicada' },
          },
          'replace',
        ),
      /Ya existe/,
    );
    assert.throws(
      () => fixture.manager.importCollection(12345),
      /no contiene una colección válida/,
    );
  } finally {
    fixture.close();
  }
});
