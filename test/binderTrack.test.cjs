const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BinderTrackManager,
  exportSetZip,
  exportCustomListZip,
  exportCollectionZip,
  importZip,
  mapCardToCollectionValues,
  asCollectionImageUrl,
} = require('../electron/binderTrack.cjs');

function managerForTest() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chucks-binder-'));
  const dbPath = path.join(directory, 'binder.sqlite');
  const mediaDir = path.join(directory, 'media');
  const manager = new BinderTrackManager(dbPath, mediaDir);
  return { manager, directory, mediaDir };
}

function seedSetWithCards(manager, { withLocalImage = false, mediaDir } = {}) {
  const set = manager.createSet({
    name: 'Base Set',
    series: 'Pokémon',
    subseries: 'Original Series',
    releaseDate: '1999-01-09',
    manufacturer: 'Wizards of the Coast',
    considerVariants: true,
  });
  let imgPath = 'https://images.example.com/charizard.png';
  if (withLocalImage) {
    imgPath = path.join(mediaDir, 'source-charizard.png');
    fs.writeFileSync(imgPath, 'fake-image-bytes');
  }
  const card = manager.createCard({
    name: 'Charizard',
    number: 4,
    code: 'B4',
    rarity: 'Rare Holo',
    illustrator: 'Mitsuhiro Arita',
    img: imgPath,
    setId: set.id,
    owned: 2,
  });
  const variant = manager.createVariant({
    cardId: card.id,
    type: '1st Edition',
    owned: 1,
  });
  return { set, card, variant };
}

test('createSet/createCard/createVariant y sus getters básicos', () => {
  const { manager } = managerForTest();
  const { set, card, variant } = seedSetWithCards(manager);
  assert.equal(manager.getSet(set.id).name, 'Base Set');
  assert.equal(manager.listCards(set.id).length, 1);
  assert.equal(manager.listVariants(card.id)[0].id, variant.id);
  assert.deepEqual(manager.listSeries(), ['Pokémon']);
  assert.deepEqual(manager.listSubseries('Pokémon'), ['Original Series']);
});

test('sanitizeSetInput rechaza set sin nombre ni serie', () => {
  const { manager } = managerForTest();
  assert.throws(() => manager.createSet({ name: '', series: 'X' }), /nombre del set/);
  assert.throws(() => manager.createSet({ name: 'X', series: '' }), /serie/);
});

test('updateSet y deleteSet funcionan correctamente', () => {
  const { manager } = managerForTest();
  const { set } = seedSetWithCards(manager);
  const updated = manager.updateSet(set.id, { name: 'Base Set (renombrado)' });
  assert.equal(updated.name, 'Base Set (renombrado)');
  assert.equal(manager.deleteSet(set.id), true);
  assert.equal(manager.getSet(set.id), null);
});

test('deleteSet no elimina las cartas, solo desasocia el set (igual que BinderTrack)', () => {
  const { manager } = managerForTest();
  const { set, card } = seedSetWithCards(manager);
  manager.deleteSet(set.id);
  const survivor = manager.getCard(card.id);
  assert.ok(survivor);
  assert.equal(survivor.setId, null);
});

test('custom lists: crear, agregar cartas, reordenar y eliminar', () => {
  const { manager } = managerForTest();
  const { card } = seedSetWithCards(manager);
  const list = manager.createCustomList({
    name: 'Mi lista',
    status: 'en progreso',
    iconColor: 123,
  });
  const entry = manager.addCardToList({ listId: list.id, cardId: card.id });
  assert.equal(entry.position, 0);
  const entries = manager.listCustomListCards(list.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].card.name, 'Charizard');
  assert.equal(manager.removeCardFromList(entry.id), true);
  assert.equal(manager.listCustomListCards(list.id).length, 0);
});

test('exportSetZip + importZip preserva la estructura pero resetea owned/completed', async () => {
  const { manager, directory, mediaDir } = managerForTest();
  const { set, card, variant } = seedSetWithCards(manager, { withLocalImage: true, mediaDir });
  const zipPath = path.join(directory, 'export.zip');
  await exportSetZip(manager, set.id, zipPath);
  assert.equal(fs.existsSync(zipPath), true);

  const { manager: manager2, mediaDir: mediaDir2 } = managerForTest();
  const result = await importZip(manager2, zipPath, mediaDir2);
  assert.deepEqual(result, { sets: 1, lists: 0 });

  const importedSet = manager2.getSet(set.id);
  assert.ok(importedSet);
  assert.equal(importedSet.name, 'Base Set');
  assert.equal(importedSet.series, 'Pokémon');
  assert.equal(importedSet.completed, false);

  const importedCard = manager2.getCard(card.id);
  assert.ok(importedCard);
  assert.equal(importedCard.name, 'Charizard');
  assert.equal(importedCard.owned, 0); // se resetea al importar un set
  // La imagen local se reescribe a una ruta real dentro de mediaDir2 y el
  // archivo debe existir físicamente ahí.
  assert.ok(
    fs.existsSync(importedCard.img),
    `la imagen importada debe existir: ${importedCard.img}`,
  );

  const importedVariants = manager2.listVariants(card.id);
  assert.equal(importedVariants.length, 1);
  assert.equal(importedVariants[0].id, variant.id);
  assert.equal(importedVariants[0].owned, 0);
});

test('exportCustomListZip + importZip preserva owned de las cartas de la lista', async () => {
  const { manager, directory } = managerForTest();
  const { card } = seedSetWithCards(manager);
  const list = manager.createCustomList({ name: 'Favoritas', status: 'en progreso', iconColor: 1 });
  manager.addCardToList({ listId: list.id, cardId: card.id });
  const zipPath = path.join(directory, 'list.zip');
  await exportCustomListZip(manager, list.id, zipPath);

  const { manager: manager2, mediaDir: mediaDir2 } = managerForTest();
  const result = await importZip(manager2, zipPath, mediaDir2);
  assert.deepEqual(result, { sets: 0, lists: 1 });

  const importedCard = manager2.getCard(card.id);
  assert.ok(importedCard);
  assert.equal(importedCard.owned, 2); // las cartas de listas preservan "owned"

  const importedList = manager2.getCustomList(list.id);
  assert.ok(importedList);
  assert.equal(importedList.name, 'Favoritas');
  const entries = manager2.listCustomListCards(list.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].cardId, card.id);
});

test('exportCollectionZip + importZip trae sets y listas juntos', async () => {
  const { manager, directory } = managerForTest();
  const { set, card } = seedSetWithCards(manager);
  const list = manager.createCustomList({ name: 'Todas', status: 'en progreso', iconColor: 2 });
  manager.addCardToList({ listId: list.id, cardId: card.id });
  const zipPath = path.join(directory, 'collection.zip');
  await exportCollectionZip(manager, zipPath);

  const { manager: manager2, mediaDir: mediaDir2 } = managerForTest();
  const result = await importZip(manager2, zipPath, mediaDir2);
  assert.deepEqual(result, { sets: 1, lists: 1 });
  assert.ok(manager2.getSet(set.id));
  assert.ok(manager2.getCustomList(list.id));
  assert.equal(manager2.listCustomListCards(list.id).length, 1);
});

test('mapCardToCollectionValues empareja columnas por nombre o etiqueta, insensible a acentos', () => {
  const { manager } = managerForTest();
  const { set, card } = seedSetWithCards(manager);
  const columns = [
    { name: 'rareza', label: 'Rareza', type: 'string', required: false },
    { name: 'campo_2', label: 'Número', type: 'number', required: false },
    { name: 'sin_match', label: 'Campo sin relación', type: 'string', required: false },
  ];
  const values = mapCardToCollectionValues(card, set, null, columns);
  assert.equal(values.rareza, 'Rare Holo');
  assert.equal(values.campo_2, 4);
  assert.equal(values.sin_match, undefined);
});

test('asCollectionImageUrl solo acepta URLs http(s)', () => {
  assert.equal(asCollectionImageUrl('https://example.com/x.png'), 'https://example.com/x.png');
  assert.equal(asCollectionImageUrl('C:\\local\\image.png'), null);
  assert.equal(asCollectionImageUrl(''), null);
  assert.equal(asCollectionImageUrl(undefined), null);
});

test('importZip lanza error si el ZIP no tiene info/info.json reconocible', async () => {
  const { manager, directory, mediaDir } = managerForTest();
  const zipPath = path.join(directory, 'bad.zip');
  const sevenZip = require('7zip-min');
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-zip-'));
  fs.writeFileSync(path.join(badDir, 'nada.txt'), 'x');
  await sevenZip.pack(path.join(badDir, '*'), zipPath);
  await assert.rejects(importZip(manager, zipPath, mediaDir), /info\/info\.json/);
});
