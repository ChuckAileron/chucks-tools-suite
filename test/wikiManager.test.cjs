const test = require('node:test');
const assert = require('node:assert/strict');
const { WikiManager } = require('../electron/wikiManager.cjs');

test('guarda un banner por categoría y permite quitarlo', () => {
  const manager = new WikiManager(':memory:');
  manager.createPage({ title: 'Guía de prueba', category: 'Guías' });

  assert.equal(manager.categories()[0].banner, '');
  assert.equal(
    manager.setCategoryBanner('Guías', 'C:/wiki/guias.png'),
    'C:/wiki/guias.png',
  );
  assert.equal(manager.categories()[0].banner, 'C:/wiki/guias.png');

  manager.setCategoryBanner('Guías', '');
  assert.equal(manager.categories()[0].banner, '');
  manager.close();
});

test('valida categoría y longitud del banner', () => {
  const manager = new WikiManager(':memory:');
  assert.throws(() => manager.setCategoryBanner('', 'banner.png'), /categoría/i);
  assert.throws(() => manager.setCategoryBanner('Guías', 'x'.repeat(2001)), /2000/);
  manager.close();
});
