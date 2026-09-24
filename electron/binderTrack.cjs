const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const sevenZip = require('7zip-min');

// --- Binario de 7-Zip embebido (mismo criterio que downloadManager.cjs) ----
function resolveSevenZa() {
  const resourcesPath = process.resourcesPath || '';
  const vendored = [
    path.join(resourcesPath, 'app.asar.unpacked', 'vendor', '7zip', '7z.exe'),
    path.join(__dirname, '..', 'vendor', '7zip', '7z.exe'),
  ];
  for (const candidate of vendored) if (fs.existsSync(candidate)) return candidate;
  const candidate = require('7zip-bin').path7za;
  const unpacked = candidate.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return candidate;
}
sevenZip.config({ binaryPath: resolveSevenZa() });

// --- Utilidades compartidas -------------------------------------------------
const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);
const parseArr = (json) => {
  try {
    const value = JSON.parse(json || '[]');
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};
// Una ruta se considera "local" (embebible en el ZIP) si no es una URL http(s)
// ni un asset embebido de la propia app móvil — mismo criterio que
// `ExportHelper._isLocalPath` en BinderTrack.
const isLocalPath = (value) =>
  !!value && !/^https?:\/\//i.test(value) && !String(value).startsWith('assets/');
const fileExt = (value) => {
  const normalized = String(value).replace(/\\/g, '/');
  const name = normalized.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot !== -1 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : 'jpg';
};
const newId = () => randomUUID();

// --- Mapeo DB (snake_case) <-> modelo (camelCase para el frontend) ---------
function setRowToModel(row) {
  return {
    id: row.id,
    name: row.name,
    releaseDate: row.release_date,
    manufacturer: row.manufacturer,
    series: row.series,
    subseries: row.subseries,
    considerVariants: !!row.consider_variants,
    logoImg: row.logo_img,
    packsImg: parseArr(row.packs_img),
    boxArtImg: parseArr(row.box_art_img),
    miscImg: parseArr(row.misc_img),
    symbolImg: row.symbol_img,
    completed: !!row.completed,
    customCompleted: !!row.custom_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function cardRowToModel(row) {
  return {
    id: row.id,
    name: row.name,
    illustrator: row.illustrator,
    description: row.description,
    img: row.img,
    type: row.type,
    rarity: row.rarity,
    language: row.language,
    owned: integer(row.owned) || 0,
    number: integer(row.number) || 0,
    code: row.code,
    isPromo: !!row.is_promo,
    customCategory: row.custom_category,
    metadata: row.metadata,
    setId: row.set_id,
  };
}
function variantRowToModel(row) {
  return {
    id: row.id,
    cardId: row.card_id,
    type: row.type,
    rarity: row.rarity,
    description: row.description,
    img: row.img,
    owned: integer(row.owned) || 0,
  };
}
function listRowToModel(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    iconColor: integer(row.icon_color) || 0,
  };
}
function listCardRowToModel(row) {
  return {
    id: row.id,
    listId: row.list_id,
    cardId: row.card_id,
    variantId: row.variant_id,
    position: integer(row.position) || 0,
  };
}

class BinderTrackManager {
  constructor(dbPath, mediaDir) {
    this.mediaDir = mediaDir;
    fs.mkdirSync(mediaDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        release_date TEXT NOT NULL DEFAULT '',
        manufacturer TEXT NOT NULL DEFAULT '',
        series TEXT NOT NULL DEFAULT '',
        subseries TEXT,
        consider_variants INTEGER NOT NULL DEFAULT 0,
        logo_img TEXT,
        packs_img TEXT NOT NULL DEFAULT '[]',
        box_art_img TEXT NOT NULL DEFAULT '[]',
        misc_img TEXT NOT NULL DEFAULT '[]',
        symbol_img TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        custom_completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        illustrator TEXT,
        description TEXT,
        img TEXT NOT NULL DEFAULT '',
        type TEXT,
        rarity TEXT,
        language TEXT,
        owned INTEGER NOT NULL DEFAULT 0,
        number INTEGER NOT NULL DEFAULT 0,
        code TEXT NOT NULL DEFAULT '',
        is_promo INTEGER NOT NULL DEFAULT 0,
        custom_category TEXT,
        metadata TEXT,
        set_id TEXT REFERENCES sets(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_binder_cards_set ON cards(set_id);
      CREATE TABLE IF NOT EXISTS card_variants (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        type TEXT,
        rarity TEXT,
        description TEXT,
        img TEXT,
        owned INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_binder_variants_card ON card_variants(card_id);
      CREATE TABLE IF NOT EXISTS custom_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'en progreso' CHECK (status IN ('completado', 'en progreso')),
        icon_color INTEGER
      );
      CREATE TABLE IF NOT EXISTS custom_list_cards (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        variant_id TEXT REFERENCES card_variants(id) ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_binder_list_cards_list ON custom_list_cards(list_id);
    `);
  }

  close() {
    this.db.close();
  }

  // --- Series / sets --------------------------------------------------------
  listSeries() {
    return this.db
      .prepare('SELECT DISTINCT series FROM sets ORDER BY series COLLATE NOCASE')
      .all()
      .map((row) => row.series)
      .filter(Boolean);
  }
  listSubseries(series) {
    return this.db
      .prepare(
        `SELECT DISTINCT subseries FROM sets WHERE series = ? AND subseries IS NOT NULL AND subseries != ''
         ORDER BY subseries COLLATE NOCASE`,
      )
      .all(series)
      .map((row) => row.subseries);
  }
  listSets({ series, subseries } = {}) {
    let sql = 'SELECT * FROM sets';
    const clauses = [];
    const args = [];
    if (series) {
      clauses.push('series = ?');
      args.push(series);
    }
    if (subseries) {
      clauses.push('subseries = ?');
      args.push(subseries);
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
    sql += ' ORDER BY series COLLATE NOCASE, release_date, name COLLATE NOCASE';
    return this.db
      .prepare(sql)
      .all(...args)
      .map((row) => setRowToModel(row));
  }
  getSet(id) {
    const row = this.db.prepare('SELECT * FROM sets WHERE id = ?').get(id);
    return row ? setRowToModel(row) : null;
  }
  getSetRow(id) {
    return this.db.prepare('SELECT * FROM sets WHERE id = ?').get(id);
  }
  sanitizeSetInput(data, current) {
    const name = String(data.name ?? current?.name ?? '').trim();
    if (!name) throw new Error('El nombre del set es obligatorio.');
    const series = String(data.series ?? current?.series ?? '').trim();
    if (!series) throw new Error('La serie es obligatoria.');
    return {
      name,
      releaseDate: String(data.releaseDate ?? current?.releaseDate ?? ''),
      manufacturer: String(data.manufacturer ?? current?.manufacturer ?? ''),
      series,
      subseries: (data.subseries ?? current?.subseries) || null,
      considerVariants: Boolean(data.considerVariants ?? current?.considerVariants ?? false),
      logoImg: (data.logoImg ?? current?.logoImg) || null,
      packsImg: Array.isArray(data.packsImg) ? data.packsImg : (current?.packsImg ?? []),
      boxArtImg: Array.isArray(data.boxArtImg) ? data.boxArtImg : (current?.boxArtImg ?? []),
      miscImg: Array.isArray(data.miscImg) ? data.miscImg : (current?.miscImg ?? []),
      symbolImg: (data.symbolImg ?? current?.symbolImg) || null,
      completed: Boolean(data.completed ?? current?.completed ?? false),
      customCompleted: Boolean(data.customCompleted ?? current?.customCompleted ?? false),
    };
  }
  createSet(data) {
    const set = this.sanitizeSetInput(data, null);
    const id = data.id || newId();
    this.db
      .prepare(
        `INSERT INTO sets (id, name, release_date, manufacturer, series, subseries, consider_variants,
         logo_img, packs_img, box_art_img, misc_img, symbol_img, completed, custom_completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        set.name,
        set.releaseDate,
        set.manufacturer,
        set.series,
        set.subseries,
        set.considerVariants ? 1 : 0,
        set.logoImg,
        JSON.stringify(set.packsImg),
        JSON.stringify(set.boxArtImg),
        JSON.stringify(set.miscImg),
        set.symbolImg,
        set.completed ? 1 : 0,
        set.customCompleted ? 1 : 0,
      );
    return this.getSet(id);
  }
  updateSet(id, patch) {
    const current = this.getSet(id);
    if (!current) throw new Error('El set no existe.');
    const set = this.sanitizeSetInput(patch, current);
    this.db
      .prepare(
        `UPDATE sets SET name = ?, release_date = ?, manufacturer = ?, series = ?, subseries = ?,
         consider_variants = ?, logo_img = ?, packs_img = ?, box_art_img = ?, misc_img = ?,
         symbol_img = ?, completed = ?, custom_completed = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        set.name,
        set.releaseDate,
        set.manufacturer,
        set.series,
        set.subseries,
        set.considerVariants ? 1 : 0,
        set.logoImg,
        JSON.stringify(set.packsImg),
        JSON.stringify(set.boxArtImg),
        JSON.stringify(set.miscImg),
        set.symbolImg,
        set.completed ? 1 : 0,
        set.customCompleted ? 1 : 0,
        id,
      );
    return this.getSet(id);
  }
  deleteSet(id) {
    return integer(this.db.prepare('DELETE FROM sets WHERE id = ?').run(id).changes) > 0;
  }
  countCardsBySet(setId) {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE set_id = ?').get(setId);
    return integer(row.n);
  }

  // --- Cartas -----------------------------------------------------------
  listCards(setId) {
    return this.db
      .prepare('SELECT * FROM cards WHERE set_id = ? ORDER BY number, name COLLATE NOCASE')
      .all(setId)
      .map((row) => cardRowToModel(row));
  }
  searchCards(query) {
    const like = `%${String(query || '').trim()}%`;
    return this.db
      .prepare('SELECT * FROM cards WHERE name LIKE ? ORDER BY name COLLATE NOCASE LIMIT 200')
      .all(like)
      .map((row) => cardRowToModel(row));
  }
  getCard(id) {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    return row ? cardRowToModel(row) : null;
  }
  getCardRow(id) {
    return this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  }
  sanitizeCardInput(data, current) {
    const name = String(data.name ?? current?.name ?? '').trim();
    if (!name) throw new Error('El nombre de la carta es obligatorio.');
    return {
      name,
      illustrator: (data.illustrator ?? current?.illustrator) || null,
      description: (data.description ?? current?.description) || null,
      img: String(data.img ?? current?.img ?? ''),
      type: (data.type ?? current?.type) || null,
      rarity: (data.rarity ?? current?.rarity) || null,
      language: (data.language ?? current?.language) || null,
      owned: Number.isFinite(Number(data.owned ?? current?.owned))
        ? Number(data.owned ?? current?.owned)
        : 0,
      number: Number.isFinite(Number(data.number ?? current?.number))
        ? Number(data.number ?? current?.number)
        : 0,
      code: String(data.code ?? current?.code ?? ''),
      isPromo: Boolean(data.isPromo ?? current?.isPromo ?? false),
      customCategory: (data.customCategory ?? current?.customCategory) || null,
      metadata: (data.metadata ?? current?.metadata) || null,
      setId: data.setId !== undefined ? data.setId : (current?.setId ?? null),
    };
  }
  createCard(data) {
    const card = this.sanitizeCardInput(data, null);
    const id = data.id || newId();
    this.db
      .prepare(
        `INSERT INTO cards (id, name, illustrator, description, img, type, rarity, language, owned,
         number, code, is_promo, custom_category, metadata, set_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        card.name,
        card.illustrator,
        card.description,
        card.img,
        card.type,
        card.rarity,
        card.language,
        card.owned,
        card.number,
        card.code,
        card.isPromo ? 1 : 0,
        card.customCategory,
        card.metadata,
        card.setId,
      );
    return this.getCard(id);
  }
  updateCard(id, patch) {
    const current = this.getCard(id);
    if (!current) throw new Error('La carta no existe.');
    const card = this.sanitizeCardInput(patch, current);
    this.db
      .prepare(
        `UPDATE cards SET name = ?, illustrator = ?, description = ?, img = ?, type = ?, rarity = ?,
         language = ?, owned = ?, number = ?, code = ?, is_promo = ?, custom_category = ?,
         metadata = ?, set_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        card.name,
        card.illustrator,
        card.description,
        card.img,
        card.type,
        card.rarity,
        card.language,
        card.owned,
        card.number,
        card.code,
        card.isPromo ? 1 : 0,
        card.customCategory,
        card.metadata,
        card.setId,
        id,
      );
    return this.getCard(id);
  }
  deleteCard(id) {
    return integer(this.db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes) > 0;
  }

  // --- Variantes ----------------------------------------------------------
  listVariants(cardId) {
    return this.db
      .prepare('SELECT * FROM card_variants WHERE card_id = ? ORDER BY type COLLATE NOCASE')
      .all(cardId)
      .map((row) => variantRowToModel(row));
  }
  getVariant(id) {
    const row = this.db.prepare('SELECT * FROM card_variants WHERE id = ?').get(id);
    return row ? variantRowToModel(row) : null;
  }
  sanitizeVariantInput(data, current) {
    const cardId = data.cardId ?? current?.cardId;
    if (!cardId) throw new Error('La variante necesita una carta asociada.');
    return {
      cardId,
      type: (data.type ?? current?.type) || null,
      rarity: (data.rarity ?? current?.rarity) || null,
      description: (data.description ?? current?.description) || null,
      img: (data.img ?? current?.img) || null,
      owned: Number.isFinite(Number(data.owned ?? current?.owned))
        ? Number(data.owned ?? current?.owned)
        : 0,
    };
  }
  createVariant(data) {
    const variant = this.sanitizeVariantInput(data, null);
    const id = data.id || newId();
    this.db
      .prepare(
        `INSERT INTO card_variants (id, card_id, type, rarity, description, img, owned)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        variant.cardId,
        variant.type,
        variant.rarity,
        variant.description,
        variant.img,
        variant.owned,
      );
    return this.getVariant(id);
  }
  updateVariant(id, patch) {
    const current = this.getVariant(id);
    if (!current) throw new Error('La variante no existe.');
    const variant = this.sanitizeVariantInput(patch, current);
    this.db
      .prepare(
        `UPDATE card_variants SET card_id = ?, type = ?, rarity = ?, description = ?, img = ?, owned = ?
         WHERE id = ?`,
      )
      .run(
        variant.cardId,
        variant.type,
        variant.rarity,
        variant.description,
        variant.img,
        variant.owned,
        id,
      );
    return this.getVariant(id);
  }
  deleteVariant(id) {
    return integer(this.db.prepare('DELETE FROM card_variants WHERE id = ?').run(id).changes) > 0;
  }

  // --- Listas personalizadas -----------------------------------------------
  listCustomLists() {
    return this.db
      .prepare('SELECT * FROM custom_lists ORDER BY name COLLATE NOCASE')
      .all()
      .map((row) => listRowToModel(row));
  }
  getCustomList(id) {
    const row = this.db.prepare('SELECT * FROM custom_lists WHERE id = ?').get(id);
    return row ? listRowToModel(row) : null;
  }
  sanitizeListInput(data, current) {
    const name = String(data.name ?? current?.name ?? '').trim();
    if (!name) throw new Error('El nombre de la lista es obligatorio.');
    const status = String(data.status ?? current?.status ?? 'en progreso');
    if (!['completado', 'en progreso'].includes(status))
      throw new Error('El estado debe ser "completado" o "en progreso".');
    return {
      name,
      status,
      iconColor: Number.isFinite(Number(data.iconColor ?? current?.iconColor))
        ? Number(data.iconColor ?? current?.iconColor)
        : 4278190080,
    };
  }
  createCustomList(data) {
    const list = this.sanitizeListInput(data, null);
    const id = data.id || newId();
    this.db
      .prepare('INSERT INTO custom_lists (id, name, status, icon_color) VALUES (?, ?, ?, ?)')
      .run(id, list.name, list.status, list.iconColor);
    return this.getCustomList(id);
  }
  updateCustomList(id, patch) {
    const current = this.getCustomList(id);
    if (!current) throw new Error('La lista no existe.');
    const list = this.sanitizeListInput(patch, current);
    this.db
      .prepare('UPDATE custom_lists SET name = ?, status = ?, icon_color = ? WHERE id = ?')
      .run(list.name, list.status, list.iconColor, id);
    return this.getCustomList(id);
  }
  deleteCustomList(id) {
    return integer(this.db.prepare('DELETE FROM custom_lists WHERE id = ?').run(id).changes) > 0;
  }
  listCustomListCards(listId) {
    return this.db
      .prepare('SELECT * FROM custom_list_cards WHERE list_id = ? ORDER BY position')
      .all(listId)
      .map((row) => {
        const entry = listCardRowToModel(row);
        const cardRow = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(entry.cardId);
        const variantRow = entry.variantId
          ? this.db.prepare('SELECT * FROM card_variants WHERE id = ?').get(entry.variantId)
          : null;
        return {
          ...entry,
          card: cardRow ? cardRowToModel(cardRow) : null,
          variant: variantRow ? variantRowToModel(variantRow) : null,
        };
      });
  }
  addCardToList({ listId, cardId, variantId }) {
    if (!this.getCustomList(listId)) throw new Error('La lista no existe.');
    if (!this.getCard(cardId)) throw new Error('La carta no existe.');
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS position FROM custom_list_cards WHERE list_id = ?',
      )
      .get(listId);
    const position = integer(row.position) + 1;
    const id = newId();
    this.db
      .prepare(
        'INSERT INTO custom_list_cards (id, list_id, card_id, variant_id, position) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, listId, cardId, variantId || null, position);
    return this.listCustomListCards(listId).find((entry) => entry.id === id);
  }
  removeCardFromList(id) {
    return (
      integer(this.db.prepare('DELETE FROM custom_list_cards WHERE id = ?').run(id).changes) > 0
    );
  }
  reorderCustomListCards(listId, ids) {
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare(
        'UPDATE custom_list_cards SET position = ? WHERE id = ? AND list_id = ?',
      );
      ids.forEach((id, position) => stmt.run(position, id, listId));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listCustomListCards(listId);
  }

  // --- Import/export: helpers de bajo nivel sobre filas crudas -------------
  // Estos métodos trabajan directamente con los mismos nombres de columna
  // (snake_case) que usa el JSON de exportación de BinderTrack, para poder
  // insertar/actualizar sin transformar el payload.
  replaceSetRow(setJson) {
    this.db
      .prepare(
        `INSERT INTO sets (id, name, release_date, manufacturer, series, subseries, consider_variants,
         logo_img, packs_img, box_art_img, misc_img, symbol_img, completed, custom_completed)
         VALUES (@id, @name, @release_date, @manufacturer, @series, @subseries, @consider_variants,
         @logo_img, @packs_img, @box_art_img, @misc_img, @symbol_img, @completed, @custom_completed)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, release_date=excluded.release_date,
         manufacturer=excluded.manufacturer, series=excluded.series, subseries=excluded.subseries,
         consider_variants=excluded.consider_variants, logo_img=excluded.logo_img,
         packs_img=excluded.packs_img, box_art_img=excluded.box_art_img, misc_img=excluded.misc_img,
         symbol_img=excluded.symbol_img, completed=excluded.completed,
         custom_completed=excluded.custom_completed, updated_at=datetime('now')`,
      )
      .run({
        id: setJson.id,
        name: setJson.name || '',
        release_date: setJson.release_date || '',
        manufacturer: setJson.manufacturer || '',
        series: setJson.series || '',
        subseries: setJson.subseries ?? null,
        consider_variants: setJson.consider_variants ? 1 : 0,
        logo_img: setJson.logo_img ?? null,
        packs_img: typeof setJson.packs_img === 'string' ? setJson.packs_img : '[]',
        box_art_img: typeof setJson.box_art_img === 'string' ? setJson.box_art_img : '[]',
        misc_img: typeof setJson.misc_img === 'string' ? setJson.misc_img : '[]',
        symbol_img: setJson.symbol_img ?? null,
        completed: setJson.completed ? 1 : 0,
        custom_completed: setJson.custom_completed ? 1 : 0,
      });
  }
  replaceCardRow(cardJson) {
    this.db
      .prepare(
        `INSERT INTO cards (id, name, illustrator, description, img, type, rarity, language, owned,
         number, code, is_promo, custom_category, metadata, set_id)
         VALUES (@id, @name, @illustrator, @description, @img, @type, @rarity, @language, @owned,
         @number, @code, @is_promo, @custom_category, @metadata, @set_id)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, illustrator=excluded.illustrator,
         description=excluded.description, img=excluded.img, type=excluded.type, rarity=excluded.rarity,
         language=excluded.language, owned=excluded.owned, number=excluded.number, code=excluded.code,
         is_promo=excluded.is_promo, custom_category=excluded.custom_category, metadata=excluded.metadata,
         set_id=excluded.set_id, updated_at=datetime('now')`,
      )
      .run({
        id: cardJson.id,
        name: cardJson.name || '',
        illustrator: cardJson.illustrator ?? null,
        description: cardJson.description ?? null,
        img: cardJson.img || '',
        type: cardJson.type ?? null,
        rarity: cardJson.rarity ?? null,
        language: cardJson.language ?? null,
        owned: Number(cardJson.owned) || 0,
        number: Number(cardJson.number) || 0,
        code: cardJson.code || '',
        is_promo: cardJson.is_promo ? 1 : 0,
        custom_category: cardJson.custom_category ?? null,
        metadata: cardJson.metadata ?? null,
        set_id: cardJson.set_id ?? null,
      });
  }
  replaceVariantRow(variantJson) {
    this.db
      .prepare(
        `INSERT INTO card_variants (id, card_id, type, rarity, description, img, owned)
         VALUES (@id, @card_id, @type, @rarity, @description, @img, @owned)
         ON CONFLICT(id) DO UPDATE SET card_id=excluded.card_id, type=excluded.type,
         rarity=excluded.rarity, description=excluded.description, img=excluded.img, owned=excluded.owned`,
      )
      .run({
        id: variantJson.id,
        card_id: variantJson.card_id || variantJson.cardId,
        type: variantJson.type ?? null,
        rarity: variantJson.rarity ?? null,
        description: variantJson.description ?? null,
        img: variantJson.img ?? null,
        owned: Number(variantJson.owned) || 0,
      });
  }
  insertCardRowIgnore(cardJson) {
    if (this.db.prepare('SELECT id FROM cards WHERE id = ?').get(cardJson.id)) return;
    this.replaceCardRow(cardJson);
  }
  insertVariantRowIgnore(variantJson) {
    if (this.db.prepare('SELECT id FROM card_variants WHERE id = ?').get(variantJson.id)) return;
    this.replaceVariantRow(variantJson);
  }
  insertListRowIgnore(listJson) {
    if (this.db.prepare('SELECT id FROM custom_lists WHERE id = ?').get(listJson.id)) return;
    this.db
      .prepare('INSERT INTO custom_lists (id, name, status, icon_color) VALUES (?, ?, ?, ?)')
      .run(
        listJson.id,
        listJson.name || '',
        listJson.status || 'en progreso',
        listJson.icon_color ?? null,
      );
  }
  insertListEntryRowIgnore(entryJson, listId) {
    if (this.db.prepare('SELECT id FROM custom_list_cards WHERE id = ?').get(entryJson.id)) return;
    this.db
      .prepare(
        'INSERT INTO custom_list_cards (id, list_id, card_id, variant_id, position) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        entryJson.id,
        listId,
        entryJson.card_id,
        entryJson.variant_id ?? null,
        Number(entryJson.position) || 0,
      );
  }
}

// --- Export: construye el ZIP en disco a partir de la BD --------------------
async function copyLocalFileToZipDir(localPath, destAbsolute) {
  const resolved = String(localPath).replace(/\\/g, '/');
  if (!fs.existsSync(resolved)) return false;
  await fsp.mkdir(path.dirname(destAbsolute), { recursive: true });
  await fsp.copyFile(resolved, destAbsolute);
  return true;
}

async function processImageList(rawList, tempDir, subfolder, importBase) {
  const result = [];
  let counter = 1;
  for (const source of rawList) {
    if (isLocalPath(source)) {
      const ext = fileExt(source);
      const relative = `img/${subfolder}/${subfolder.split('/').pop()}${counter}.${ext}`;
      const ok = await copyLocalFileToZipDir(source, path.join(tempDir, ...relative.split('/')));
      result.push(ok ? `${importBase}/${subfolder.split('/').pop()}${counter}.${ext}` : source);
    } else {
      result.push(source);
    }
    counter += 1;
  }
  return result;
}

async function buildSetExportEntry(manager, setId, tempDir, zipSubdir) {
  const row = manager.getSetRow(setId);
  if (!row) throw new Error('El set no existe.');
  const setJson = { ...row };
  const importBase = `bindertrack/imported/${setId}/img`;
  const prefix = zipSubdir ? `${zipSubdir}/` : '';

  if (isLocalPath(row.logo_img)) {
    const ext = fileExt(row.logo_img);
    const ok = await copyLocalFileToZipDir(
      row.logo_img,
      path.join(tempDir, 'img', ...(zipSubdir ? [zipSubdir] : []), 'logo', `logo.${ext}`),
    );
    if (ok) setJson.logo_img = `${importBase}/logo/logo.${ext}`;
  }
  if (isLocalPath(row.symbol_img)) {
    const ext = fileExt(row.symbol_img);
    const ok = await copyLocalFileToZipDir(
      row.symbol_img,
      path.join(tempDir, 'img', ...(zipSubdir ? [zipSubdir] : []), 'symbol', `symbol.${ext}`),
    );
    if (ok) setJson.symbol_img = `${importBase}/symbol/symbol.${ext}`;
  }
  for (const [key, folder] of [
    ['packs_img', 'packs'],
    ['box_art_img', 'box'],
    ['misc_img', 'misc'],
  ]) {
    const list = parseArr(row[key]);
    const rewritten = await processImageList(
      list,
      tempDir,
      zipSubdir ? `${zipSubdir}/${folder}` : folder,
      importBase,
    );
    setJson[key] = JSON.stringify(rewritten);
  }

  const cards = manager.listCards(setId).map((card) => manager.getCardRow(card.id));
  const cardsJson = [];
  for (const cardRow of cards) {
    const cardJson = { ...cardRow };
    if (isLocalPath(cardRow.img)) {
      const ext = fileExt(cardRow.img);
      const ok = await copyLocalFileToZipDir(
        cardRow.img,
        path.join(
          tempDir,
          'img',
          ...(zipSubdir ? [zipSubdir] : []),
          'cards',
          `${cardRow.id}.${ext}`,
        ),
      );
      if (ok) cardJson.img = `${importBase}/cards/${cardRow.id}.${ext}`;
    }
    const variants = manager
      .listVariants(cardRow.id)
      .map((variant) => manager.getVariant(variant.id));
    const variantsJson = [];
    for (const variant of variants) {
      const variantJson = {
        id: variant.id,
        card_id: variant.cardId,
        type: variant.type,
        rarity: variant.rarity,
        description: variant.description,
        img: variant.img,
        owned: variant.owned,
      };
      if (isLocalPath(variant.img)) {
        const ext = fileExt(variant.img);
        const ok = await copyLocalFileToZipDir(
          variant.img,
          path.join(
            tempDir,
            'img',
            ...(zipSubdir ? [zipSubdir] : []),
            'cards',
            `v_${variant.id}.${ext}`,
          ),
        );
        if (ok) variantJson.img = `${importBase}/cards/v_${variant.id}.${ext}`;
      }
      variantsJson.push(variantJson);
    }
    cardJson.variants = variantsJson;
    cardsJson.push(cardJson);
  }
  void prefix;
  return { set: setJson, cards: cardsJson };
}

async function buildListExportEntry(manager, listId, tempDir, zipSubdir) {
  const list = manager.getCustomList(listId);
  if (!list) throw new Error('La lista no existe.');
  const entries = manager.listCustomListCards(listId);
  const importBase = `bindertrack/imported/list_${listId}/img`;
  const cardsJson = [];
  const processed = new Set();
  for (const entry of entries) {
    if (processed.has(entry.cardId)) continue;
    processed.add(entry.cardId);
    const cardRow = manager.getCardRow(entry.cardId);
    if (!cardRow) continue;
    const cardJson = { ...cardRow };
    if (isLocalPath(cardRow.img)) {
      const ext = fileExt(cardRow.img);
      const ok = await copyLocalFileToZipDir(
        cardRow.img,
        path.join(
          tempDir,
          'img',
          ...(zipSubdir ? [zipSubdir] : []),
          'cards',
          `${cardRow.id}.${ext}`,
        ),
      );
      if (ok) cardJson.img = `${importBase}/cards/${cardRow.id}.${ext}`;
    }
    const variantsJson = [];
    for (const variant of manager.listVariants(entry.cardId)) {
      const variantJson = {
        id: variant.id,
        card_id: variant.cardId,
        type: variant.type,
        rarity: variant.rarity,
        description: variant.description,
        img: variant.img,
        owned: variant.owned,
      };
      if (isLocalPath(variant.img)) {
        const ext = fileExt(variant.img);
        const ok = await copyLocalFileToZipDir(
          variant.img,
          path.join(
            tempDir,
            'img',
            ...(zipSubdir ? [zipSubdir] : []),
            'cards',
            `v_${variant.id}.${ext}`,
          ),
        );
        if (ok) variantJson.img = `${importBase}/cards/v_${variant.id}.${ext}`;
      }
      variantsJson.push(variantJson);
    }
    cardJson.variants = variantsJson;
    cardsJson.push(cardJson);
  }
  const listJson = {
    id: list.id,
    name: list.name,
    status: list.status,
    icon_color: list.iconColor,
    entries: entries.map((entry) => ({
      id: entry.id,
      list_id: entry.listId,
      card_id: entry.cardId,
      variant_id: entry.variantId,
      position: entry.position,
    })),
  };
  return { list: listJson, cards: cardsJson };
}

async function packDirToZip(tempDir, destinationZipPath) {
  await fsp.mkdir(path.dirname(destinationZipPath), { recursive: true });
  fs.rmSync(destinationZipPath, { force: true });
  await sevenZip.pack(path.join(tempDir, '*'), destinationZipPath);
}

async function withTempDir(fn) {
  const base = await fsp.mkdtemp(path.join(require('node:os').tmpdir(), 'bindertrack-'));
  try {
    return await fn(base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

async function exportSetZip(manager, setId, destinationZipPath) {
  return withTempDir(async (tempDir) => {
    const entry = await buildSetExportEntry(manager, setId, tempDir, null);
    await fsp.mkdir(path.join(tempDir, 'info'), { recursive: true });
    await fsp.writeFile(
      path.join(tempDir, 'info', 'info.json'),
      JSON.stringify({ set: entry.set, cards: entry.cards }, null, 2),
      'utf8',
    );
    await packDirToZip(tempDir, destinationZipPath);
    return true;
  });
}

async function exportCustomListZip(manager, listId, destinationZipPath) {
  return withTempDir(async (tempDir) => {
    const entry = await buildListExportEntry(manager, listId, tempDir, null);
    await fsp.mkdir(path.join(tempDir, 'info'), { recursive: true });
    await fsp.writeFile(
      path.join(tempDir, 'info', 'info.json'),
      JSON.stringify({ list: entry.list, cards: entry.cards }, null, 2),
      'utf8',
    );
    await packDirToZip(tempDir, destinationZipPath);
    return true;
  });
}

async function exportCollectionZip(manager, destinationZipPath) {
  return withTempDir(async (tempDir) => {
    const sets = manager.listSets();
    const setsJson = [];
    for (const set of sets) {
      const entry = await buildSetExportEntry(manager, set.id, tempDir, `set_${set.id}`);
      setsJson.push(entry);
    }
    const lists = manager.listCustomLists();
    const listsJson = [];
    for (const list of lists) {
      const entry = await buildListExportEntry(manager, list.id, tempDir, `list_${list.id}`);
      listsJson.push(entry);
    }
    await fsp.mkdir(path.join(tempDir, 'info'), { recursive: true });
    await fsp.writeFile(
      path.join(tempDir, 'info', 'info.json'),
      JSON.stringify({ sets: setsJson, lists: listsJson }, null, 2),
      'utf8',
    );
    await packDirToZip(tempDir, destinationZipPath);
    return true;
  });
}

// --- Import: extrae el ZIP y reescribe rutas de imágenes locales -----------
function makeRewriter(importedPrefix, extractBase) {
  return (source) => {
    if (!source) return source;
    if (!String(source).startsWith(importedPrefix)) return source;
    const relative = String(source).slice(importedPrefix.length);
    return path.join(extractBase, ...relative.split('/'));
  };
}
function rewriteImageListField(rawJson, rewrite) {
  try {
    const list = JSON.parse(rawJson || '[]');
    if (!Array.isArray(list)) return rawJson;
    return JSON.stringify(list.map((item) => rewrite(item)));
  } catch {
    return rawJson;
  }
}

async function importSetEntry(manager, entry, mediaDir, zipExtractDir, zipPrefix) {
  const setJson = { ...entry.set };
  const setId = setJson.id;
  const extractBase = path.join(mediaDir, 'imported', setId);
  // Copia las imágenes propias de este set desde el ZIP ya extraído hacia el
  // almacén de medios de la app (equivalente a `<appDocDir>/imported/<id>`).
  const sourceImgDir = zipPrefix
    ? path.join(zipExtractDir, 'img', zipPrefix)
    : path.join(zipExtractDir, 'img');
  if (fs.existsSync(sourceImgDir)) {
    await fsp.mkdir(path.join(extractBase, 'img'), { recursive: true });
    await fsp.cp(sourceImgDir, path.join(extractBase, 'img'), { recursive: true });
  }
  const importedPrefix = `bindertrack/imported/${setId}/`;
  const rewrite = makeRewriter(importedPrefix, extractBase);
  setJson.logo_img = rewrite(setJson.logo_img);
  setJson.symbol_img = rewrite(setJson.symbol_img);
  setJson.packs_img = rewriteImageListField(setJson.packs_img, rewrite);
  setJson.box_art_img = rewriteImageListField(setJson.box_art_img, rewrite);
  setJson.misc_img = rewriteImageListField(setJson.misc_img, rewrite);
  setJson.completed = 0;
  setJson.custom_completed = 0;
  manager.replaceSetRow(setJson);

  for (const rawCard of entry.cards || []) {
    const cardJson = { ...rawCard };
    const variants = cardJson.variants || [];
    delete cardJson.variants;
    cardJson.img = rewrite(cardJson.img) || 'assets/img/placeholder.png';
    cardJson.owned = 0;
    cardJson.set_id = setId;
    manager.replaceCardRow(cardJson);
    for (const rawVariant of variants) {
      const variantJson = {
        ...rawVariant,
        card_id: rawVariant.card_id || rawVariant.cardId,
        owned: 0,
      };
      variantJson.img = rewrite(variantJson.img);
      manager.replaceVariantRow(variantJson);
    }
  }
}

async function importListEntry(manager, entry, mediaDir, zipExtractDir, zipPrefix) {
  const listJson = entry.list;
  const listId = listJson.id;
  const extractBase = path.join(mediaDir, 'imported', `list_${listId}`);
  const sourceImgDir = zipPrefix
    ? path.join(zipExtractDir, 'img', zipPrefix)
    : path.join(zipExtractDir, 'img');
  if (fs.existsSync(sourceImgDir)) {
    await fsp.mkdir(path.join(extractBase, 'img'), { recursive: true });
    await fsp.cp(sourceImgDir, path.join(extractBase, 'img'), { recursive: true });
  }
  const importedPrefix = `bindertrack/imported/list_${listId}/`;
  const rewrite = makeRewriter(importedPrefix, extractBase);

  for (const rawCard of entry.cards || []) {
    const cardJson = { ...rawCard };
    const variants = cardJson.variants || [];
    delete cardJson.variants;
    cardJson.img = rewrite(cardJson.img) || 'assets/img/placeholder.png';
    // La lista puede compartirse sin el set completo al que pertenecen sus
    // cartas; si ese set no existe localmente se deja sin asignar en vez de
    // violar la referencia foránea (la carta igual queda disponible).
    if (cardJson.set_id && !manager.getSet(cardJson.set_id)) cardJson.set_id = null;
    manager.insertCardRowIgnore(cardJson);
    for (const rawVariant of variants) {
      const variantJson = { ...rawVariant, card_id: rawVariant.card_id || rawVariant.cardId };
      variantJson.img = rewrite(variantJson.img) || 'assets/img/placeholder.png';
      manager.insertVariantRowIgnore(variantJson);
    }
  }
  manager.insertListRowIgnore(listJson);
  for (const rawEntry of listJson.entries || []) manager.insertListEntryRowIgnore(rawEntry, listId);
}

// Detecta el tipo de export (set individual / lista / colección completa) e
// importa su contenido, replicando la semántica de `ImportHelper` en Dart:
// los sets se reemplazan (y sus cartas quedan con owned=0, como catálogo
// "en blanco" listo para inventariar), mientras que listas y sus cartas se
// insertan solo si no existen ya (para no pisar datos propios).
async function importZip(manager, zipPath, mediaDir) {
  return withTempDir(async (tempDir) => {
    await sevenZip.unpack(zipPath, tempDir);
    const infoPath = path.join(tempDir, 'info', 'info.json');
    if (!fs.existsSync(infoPath)) throw new Error('El ZIP no contiene info/info.json.');
    const info = JSON.parse(await fsp.readFile(infoPath, 'utf8'));
    let sets = 0;
    let lists = 0;
    if (Array.isArray(info.sets) || Array.isArray(info.lists)) {
      for (const entry of info.sets || []) {
        await importSetEntry(manager, entry, mediaDir, tempDir, `set_${entry.set.id}`);
        sets += 1;
      }
      for (const entry of info.lists || []) {
        await importListEntry(manager, entry, mediaDir, tempDir, `list_${entry.list.id}`);
        lists += 1;
      }
    } else if (info.set) {
      await importSetEntry(manager, info, mediaDir, tempDir, null);
      sets = 1;
    } else if (info.list) {
      await importListEntry(manager, info, mediaDir, tempDir, null);
      lists = 1;
    } else {
      throw new Error('El ZIP no tiene un formato de exportación reconocido de BinderTrack.');
    }
    return { sets, lists };
  });
}

// --- Integración con la sección "Colección" ---------------------------------
// Traduce una carta (y opcionalmente su set/variante) a los `values` de un
// ítem de Colección, emparejando por nombre o etiqueta de columna de forma
// flexible (insensible a mayúsculas/acentos) contra los campos conocidos de
// BinderTrack. Las columnas sin correspondencia simplemente quedan vacías.
function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
function mapCardToCollectionValues(card, set, variant, columns) {
  const dict = {
    name: card.name,
    nombre: card.name,
    illustrator: card.illustrator,
    artist: card.illustrator,
    ilustrador: card.illustrator,
    rarity: card.rarity,
    rareza: card.rarity,
    type: card.type,
    tipo: card.type,
    number: card.number,
    numero: card.number,
    code: card.code,
    codigo: card.code,
    language: card.language,
    idioma: card.language,
    owned: card.owned,
    cantidad: card.owned,
    quantity: card.owned,
    description: card.description,
    descripcion: card.description,
    set: set ? set.name : '',
    setname: set ? set.name : '',
    series: set ? set.series : '',
    serie: set ? set.series : '',
    subseries: set ? set.subseries || '' : '',
    manufacturer: set ? set.manufacturer : '',
    fabricante: set ? set.manufacturer : '',
    variant: variant ? variant.type || '' : '',
    variante: variant ? variant.type || '' : '',
  };
  const values = {};
  for (const column of columns) {
    const candidates = [normalizeKey(column.name), normalizeKey(column.label)];
    const key = candidates.find((candidate) => dict[candidate] !== undefined);
    if (key !== undefined) {
      const value = dict[key];
      if (value !== undefined && value !== null && value !== '') values[column.name] = value;
    }
  }
  return values;
}
// Una imagen solo puede llevarse tal cual a un ítem de Colección si es una
// URL http(s) (el esquema de Colección valida esto); las imágenes locales
// importadas desde un ZIP de BinderTrack se omiten en este campo.
const asCollectionImageUrl = (img) => (/^https?:\/\//i.test(img || '') ? img : null);

module.exports = {
  BinderTrackManager,
  exportSetZip,
  exportCustomListZip,
  exportCollectionZip,
  importZip,
  mapCardToCollectionValues,
  asCollectionImageUrl,
};
