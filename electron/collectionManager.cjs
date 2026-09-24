const { DatabaseSync } = require('node:sqlite');

const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'url', 'tags'];
const TYPE_SET = new Set(COLUMN_TYPES);

const parse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const normalizeColumn = (column) => {
  if (!plainObject(column)) throw new Error('Definición de columna inválida.');
  const name = String(column.name || '').trim();
  const type = String(column.type || 'string');
  if (!name) throw new Error('Toda columna necesita un nombre.');
  if (!TYPE_SET.has(type)) throw new Error(`Tipo de columna no soportado: ${type}.`);
  return {
    name,
    type,
    required: Boolean(column.required),
    label: String(column.label || name).trim() || name,
  };
};
const normalizeColumns = (columns) => {
  const normalized = Array.isArray(columns)
    ? columns.map(normalizeColumn)
    : plainObject(columns)
      ? Object.entries(columns).map(([name, type]) => normalizeColumn({ name, type }))
      : [];
  const names = new Set();
  for (const column of normalized) {
    if (names.has(column.name)) throw new Error(`Columna duplicada: ${column.name}.`);
    names.add(column.name);
  }
  return normalized;
};
const sanitizeValue = (column, value) => {
  if (value === '' || value === null || value === undefined) {
    if (column.type === 'boolean') return false;
    if (column.required) throw new Error(`La columna "${column.label}" es obligatoria.`);
    return undefined;
  }
  if (column.type === 'string') return String(value);
  if (column.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`"${column.label}" debe ser un número.`);
    return number;
  }
  if (column.type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`"${column.label}" debe ser verdadero o falso.`);
  }
  if (column.type === 'date') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`"${column.label}" debe ser una fecha.`);
    return date.toISOString();
  }
  if (column.type === 'url') {
    if (!validUrl(value)) throw new Error(`"${column.label}" debe ser una URL HTTP válida.`);
    return value;
  }
  if (column.type === 'tags') {
    const tags = Array.isArray(value) ? value : String(value).split(',');
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
};
const validateValues = (columns, values) => {
  if (!plainObject(values)) throw new Error('Los valores del ítem deben ser un objeto.');
  const result = {};
  for (const column of columns) {
    const value = sanitizeValue(column, values[column.name]);
    if (value !== undefined) result[column.name] = value;
  }
  return result;
};

class CollectionManager {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'generic',
        schema_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS collection_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        image_url TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_collection_items_collection
        ON collection_items(collection_id);
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        manufacturer TEXT NOT NULL DEFAULT '',
        year INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS wishlist_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wishlist_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
        store TEXT NOT NULL,
        url TEXT NOT NULL,
        price REAL,
        currency TEXT,
        checked_at TEXT,
        error TEXT,
        UNIQUE(wishlist_id, url)
      );
      CREATE INDEX IF NOT EXISTS idx_wishlist_prices_item ON wishlist_prices(wishlist_id);
    `);
    const columns = this.db.prepare('PRAGMA table_info(collections)').all();
    if (!columns.some((column) => column.name === 'position'))
      this.db.exec('ALTER TABLE collections ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  }

  close() {
    this.db.close();
  }

  mapCollection(row) {
    return row
      ? {
          id: integer(row.id),
          name: row.name,
          description: row.description,
          type: row.type,
          columns: normalizeColumns(parse(row.schema_json, [])),
          position: integer(row.position),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  mapItem(row) {
    return row
      ? {
          id: integer(row.id),
          collectionId: integer(row.collection_id),
          name: row.name,
          values: parse(row.metadata_json, {}),
          imageUrl: row.image_url,
          tags: parse(row.tags_json, []),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  listCollections() {
    return this.db
      .prepare('SELECT * FROM collections ORDER BY position, name COLLATE NOCASE')
      .all()
      .map((row) => this.mapCollection(row));
  }

  getCollection(id) {
    return this.mapCollection(this.db.prepare('SELECT * FROM collections WHERE id = ?').get(id));
  }

  createCollection({ name, description = '', type = 'generic', columns = [] }) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) throw new Error('El nombre de la colección es obligatorio.');
    const schema = normalizeColumns(columns);
    const position =
      integer(
        this.db.prepare('SELECT COALESCE(MAX(position), -1) AS position FROM collections').get()
          .position,
      ) + 1;
    try {
      const result = this.db
        .prepare(
          'INSERT INTO collections (name, description, type, schema_json, position) VALUES (?, ?, ?, ?, ?)',
        )
        .run(normalizedName, String(description), String(type), JSON.stringify(schema), position);
      return this.getCollection(integer(result.lastInsertRowid));
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE/i.test(error.message))
        throw new Error(`Ya existe una colección llamada "${normalizedName}".`);
      throw error;
    }
  }

  updateCollection(id, patch) {
    const current = this.getCollection(id);
    if (!current) throw new Error('La colección no existe.');
    const next = {
      name: String(patch.name ?? current.name).trim(),
      description: String(patch.description ?? current.description),
      type: String(patch.type ?? current.type),
      columns: normalizeColumns(patch.columns ?? current.columns),
    };
    if (!next.name) throw new Error('El nombre de la colección es obligatorio.');
    this.db
      .prepare(
        `UPDATE collections SET name = ?, description = ?, type = ?, schema_json = ?,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(next.name, next.description, next.type, JSON.stringify(next.columns), id);
    return this.getCollection(id);
  }

  deleteCollection(id) {
    return integer(this.db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes) > 0;
  }

  reorderCollections(ids) {
    const list = Array.isArray(ids) ? ids.map(integer) : [];
    if (!list.length) throw new Error('Se necesita al menos una colección.');
    if (new Set(list).size !== list.length)
      throw new Error('El orden contiene colecciones duplicadas.');
    const existing = new Set(
      this.db
        .prepare('SELECT id FROM collections')
        .all()
        .map((row) => integer(row.id)),
    );
    if (!list.every((id) => existing.has(id)))
      throw new Error('El orden incluye colecciones que no existen.');
    this.db.exec('BEGIN');
    try {
      const reorder = this.db.prepare('UPDATE collections SET position = ? WHERE id = ?');
      list.forEach((id, position) => reorder.run(position, id));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listCollections();
  }

  listItems(collectionId, q = '') {
    if (!this.getCollection(collectionId)) throw new Error('La colección no existe.');
    const rows = q.trim()
      ? this.db
          .prepare(
            `SELECT * FROM collection_items WHERE collection_id = ? AND name LIKE ?
             ORDER BY name COLLATE NOCASE`,
          )
          .all(collectionId, `%${q.trim()}%`)
      : this.db
          .prepare(
            'SELECT * FROM collection_items WHERE collection_id = ? ORDER BY name COLLATE NOCASE',
          )
          .all(collectionId);
    return rows.map((row) => this.mapItem(row));
  }

  getItem(id) {
    return this.mapItem(this.db.prepare('SELECT * FROM collection_items WHERE id = ?').get(id));
  }

  sanitizeItem(collectionId, data, current) {
    const collection = this.getCollection(collectionId);
    if (!collection) throw new Error('La colección no existe.');
    const name = String(data.name ?? current?.name ?? '').trim();
    if (!name) throw new Error('El nombre del ítem es obligatorio.');
    const imageUrl = data.imageUrl !== undefined ? data.imageUrl : current?.imageUrl;
    if (imageUrl && !validUrl(imageUrl)) throw new Error('La imagen debe ser una URL HTTP válida.');
    const tags = data.tags ?? current?.tags ?? [];
    if (!Array.isArray(tags)) throw new Error('Las etiquetas deben ser un arreglo.');
    return {
      name,
      imageUrl: imageUrl || null,
      tags: tags.map((tag) => String(tag).trim()).filter(Boolean),
      values: validateValues(collection.columns, data.values ?? current?.values ?? {}),
    };
  }

  addItem(data) {
    const item = this.sanitizeItem(data.collectionId, data);
    const result = this.db
      .prepare(
        `INSERT INTO collection_items (collection_id, name, metadata_json, image_url, tags_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        data.collectionId,
        item.name,
        JSON.stringify(item.values),
        item.imageUrl,
        JSON.stringify(item.tags),
      );
    return this.getItem(integer(result.lastInsertRowid));
  }

  updateItem(id, patch) {
    const current = this.getItem(id);
    if (!current) throw new Error('El ítem no existe.');
    const item = this.sanitizeItem(current.collectionId, patch, current);
    this.db
      .prepare(
        `UPDATE collection_items SET name = ?, metadata_json = ?, image_url = ?, tags_json = ?,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(item.name, JSON.stringify(item.values), item.imageUrl, JSON.stringify(item.tags), id);
    return this.getItem(id);
  }

  deleteItem(id) {
    return (
      integer(this.db.prepare('DELETE FROM collection_items WHERE id = ?').run(id).changes) > 0
    );
  }

  mapWishlistPrice(row) {
    return {
      id: integer(row.id),
      wishlistId: integer(row.wishlist_id),
      store: row.store,
      url: row.url,
      price: row.price === null ? null : Number(row.price),
      currency: row.currency,
      checkedAt: row.checked_at,
      error: row.error,
    };
  }

  getWishlistItem(id) {
    const row = this.db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: integer(row.id),
      name: row.name,
      manufacturer: row.manufacturer,
      year: row.year === null ? null : integer(row.year),
      prices: this.db
        .prepare(
          'SELECT * FROM wishlist_prices WHERE wishlist_id = ? ORDER BY store COLLATE NOCASE',
        )
        .all(id)
        .map((price) => this.mapWishlistPrice(price)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listWishlist(q = '') {
    const rows = q.trim()
      ? this.db
          .prepare(
            `SELECT id FROM wishlist_items WHERE name LIKE ? OR manufacturer LIKE ?
             ORDER BY name COLLATE NOCASE`,
          )
          .all(`%${q.trim()}%`, `%${q.trim()}%`)
      : this.db.prepare('SELECT id FROM wishlist_items ORDER BY name COLLATE NOCASE').all();
    return rows.map((row) => this.getWishlistItem(integer(row.id)));
  }

  sanitizeWishlist(data, current) {
    const name = String(data.name ?? current?.name ?? '').trim();
    if (!name) throw new Error('El nombre del artículo es obligatorio.');
    const manufacturer = String(data.manufacturer ?? current?.manufacturer ?? '').trim();
    const rawYear = data.year ?? current?.year ?? null;
    const year = rawYear === '' || rawYear === null ? null : Number(rawYear);
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999))
      throw new Error('El año debe contener cuatro dígitos.');
    return { name, manufacturer, year };
  }

  createWishlistItem(data) {
    const item = this.sanitizeWishlist(data);
    const result = this.db
      .prepare('INSERT INTO wishlist_items (name, manufacturer, year) VALUES (?, ?, ?)')
      .run(item.name, item.manufacturer, item.year);
    return this.getWishlistItem(integer(result.lastInsertRowid));
  }

  updateWishlistItem(id, patch) {
    const current = this.getWishlistItem(id);
    if (!current) throw new Error('El artículo de wishlist no existe.');
    const item = this.sanitizeWishlist(patch, current);
    this.db
      .prepare(
        `UPDATE wishlist_items SET name = ?, manufacturer = ?, year = ?,
         updated_at = datetime('now') WHERE id = ?`,
      )
      .run(item.name, item.manufacturer, item.year, id);
    return this.getWishlistItem(id);
  }

  deleteWishlistItem(id) {
    return integer(this.db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id).changes) > 0;
  }

  addWishlistPrice(wishlistId, data) {
    if (!this.getWishlistItem(wishlistId)) throw new Error('El artículo de wishlist no existe.');
    const url = String(data.url || '').trim();
    if (!validUrl(url)) throw new Error('La página de tienda debe ser una URL HTTP válida.');
    const store = String(data.store || new URL(url).hostname.replace(/^www\./, '')).trim();
    try {
      const result = this.db
        .prepare('INSERT INTO wishlist_prices (wishlist_id, store, url) VALUES (?, ?, ?)')
        .run(wishlistId, store, url);
      return this.mapWishlistPrice(
        this.db.prepare('SELECT * FROM wishlist_prices WHERE id = ?').get(result.lastInsertRowid),
      );
    } catch (error) {
      if (/UNIQUE/i.test(error.message))
        throw new Error('Esa página ya está agregada al artículo.');
      throw error;
    }
  }

  getWishlistPrice(id) {
    const row = this.db.prepare('SELECT * FROM wishlist_prices WHERE id = ?').get(id);
    return row ? this.mapWishlistPrice(row) : null;
  }

  deleteWishlistPrice(id) {
    return integer(this.db.prepare('DELETE FROM wishlist_prices WHERE id = ?').run(id).changes) > 0;
  }

  updateWishlistPriceResult(id, result) {
    const price = Number(result.price);
    this.db
      .prepare(
        `UPDATE wishlist_prices SET price = COALESCE(?, price), currency = COALESCE(?, currency),
         checked_at = ?, error = ? WHERE id = ?`,
      )
      .run(
        Number.isFinite(price) ? price : null,
        result.currency || null,
        new Date().toISOString(),
        result.error || null,
        id,
      );
    const row = this.db.prepare('SELECT * FROM wishlist_prices WHERE id = ?').get(id);
    return row ? this.mapWishlistPrice(row) : null;
  }

  exportCollection(id) {
    const collection = this.getCollection(id);
    if (!collection) throw new Error('La colección no existe.');
    return {
      format: 'chucks-collection',
      version: 1,
      exportedAt: new Date().toISOString(),
      collection: {
        name: collection.name,
        description: collection.description,
        type: collection.type,
        columns: collection.columns,
      },
      items: this.listItems(id).map(({ name, values, imageUrl, tags }) => ({
        name,
        values,
        imageUrl,
        tags,
      })),
    };
  }

  importCollection(payload, mode = 'rename') {
    if (
      !plainObject(payload) ||
      payload.format !== 'chucks-collection' ||
      !plainObject(payload.collection)
    )
      throw new Error('El archivo no contiene una colección válida.');
    const source = payload.collection;
    let name = String(source.name || '').trim();
    if (!name) throw new Error('La colección importada no tiene nombre.');
    const existing = this.db
      .prepare('SELECT id FROM collections WHERE name = ? COLLATE NOCASE')
      .get(name);
    if (existing && mode === 'rename') {
      const base = name;
      let suffix = 2;
      while (this.db.prepare('SELECT id FROM collections WHERE name = ? COLLATE NOCASE').get(name))
        name = `${base} (${suffix++})`;
    } else if (existing) throw new Error(`Ya existe una colección llamada "${name}".`);
    this.db.exec('BEGIN');
    try {
      const collection = this.createCollection({
        name,
        description: source.description,
        type: source.type,
        columns: source.columns || source.schema || [],
      });
      for (const item of Array.isArray(payload.items) ? payload.items : [])
        this.addItem({
          collectionId: collection.id,
          name: item.name,
          values: item.values || item.metadata || {},
          imageUrl: item.imageUrl || item.imagePath || null,
          tags: item.tags || [],
        });
      this.db.exec('COMMIT');
      return collection;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

module.exports = { CollectionManager, COLUMN_TYPES };
