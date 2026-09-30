const { DatabaseSync } = require('node:sqlite');

const TTL_DAYS   = 1;
const TTL_SQL    = `datetime('now', '-${TTL_DAYS} day')`;
const INTEGER_RE = /^\d+$/;

const BOTS_TABLES = new Set(['bots_steam', 'bots_amazon', 'bots_downloads', 'bots_sessions']);

const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);
const text    = (value) => String(value || '').trim();
const price   = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

class BotsManager {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bots_steam (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        price TEXT NOT NULL DEFAULT '',
        original TEXT NOT NULL DEFAULT '',
        discount TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT '',
        price_final REAL,
        price_initial REAL,
        url TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS bots_amazon (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        price REAL,
        currency TEXT,
        image TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS bots_downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        source_title TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS bots_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        user_field TEXT NOT NULL,
        pass_field TEXT NOT NULL,
        submit_selector TEXT NOT NULL,
        success_selector TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const steamColumns = new Set(
      this.db.prepare('PRAGMA table_info(bots_steam)').all().map((column) => column.name),
    );
    const ensureColumn = (name, definition) => {
      if (!steamColumns.has(name)) {
        this.db.exec(`ALTER TABLE bots_steam ADD COLUMN ${name} ${definition}`);
      }
    };
    ensureColumn('tags', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('currency', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('price_final', 'REAL');
    ensureColumn('price_initial', 'REAL');
  }

  close() {
    this.db.close();
  }

  purge(table) {
    if (!BOTS_TABLES.has(table)) throw new Error(`Tabla de bots no soportada: ${table}.`);
    this.db.prepare(`DELETE FROM ${table} WHERE fetched_at < ${TTL_SQL}`).run();
  }

  clear(table) {
    if (!BOTS_TABLES.has(table)) throw new Error(`Tabla de bots no soportada: ${table}.`);
    this.db.prepare(`DELETE FROM ${table}`).run();
  }

  fresh(table) {
    this.purge(table);
    return (
      this.db
        .prepare(`SELECT 1 FROM ${table} WHERE fetched_at >= ${TTL_SQL} LIMIT 1`)
        .get() !== undefined
    );
  }

  freshUrl(table, url) {
    return (
      this.db
        .prepare(`SELECT 1 FROM ${table} WHERE url = ? AND fetched_at >= ${TTL_SQL} LIMIT 1`)
        .get(text(url)) !== undefined
    );
  }

  /* ---------- Steam ---------- */

  steam() {
    this.purge('bots_steam');
    return this.db
      .prepare(
        'SELECT id, title, price, original, discount, tags, currency, price_final, price_initial, url, fetched_at FROM bots_steam ORDER BY fetched_at DESC, id DESC',
      )
      .all()
      .map((row) => ({
        id:           integer(row.id),
        title:        row.title,
        price:        row.price,
        original:     row.original,
        discount:     row.discount,
        tag:          row.tags,
        currency:     row.currency,
        priceFinal:   price(row.price_final),
        priceInitial: price(row.price_initial),
        url:          row.url,
        fetched:      row.fetched_at,
      }));
  }

  saveSteam(deals) {
    const items = Array.isArray(deals) ? deals.slice(0, 300) : [];
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM bots_steam').run();
      const insert = this.db.prepare(
        'INSERT INTO bots_steam (title, price, original, discount, tags, currency, price_final, price_initial, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const deal of items) {
        insert.run(
          text(deal.title),
          text(deal.price),
          text(deal.original),
          text(deal.discount),
          text(deal.tag),
          text(deal.currency),
          price(deal.priceFinal),
          price(deal.priceInitial),
          text(deal.url),
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.steam();
  }

  /* ---------- Amazon ---------- */

  amazon() {
    this.purge('bots_amazon');
    return this.db
      .prepare(
        'SELECT id, url, title, price, currency, image, fetched_at FROM bots_amazon ORDER BY fetched_at DESC, id DESC',
      )
      .all()
      .map((row) => ({
        id:       integer(row.id),
        url:      row.url,
        title:    row.title,
        price:    price(row.price),
        currency: row.currency,
        image:    row.image,
        fetched:  row.fetched_at,
      }));
  }

  saveAmazon(items) {
    const upsert = this.db.prepare(
      `INSERT INTO bots_amazon (url, title, price, currency, image) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         title = excluded.title,
         price = excluded.price,
         currency = excluded.currency,
         image = excluded.image,
         fetched_at = datetime('now')`,
    );
    this.db.exec('BEGIN');
    try {
      for (const item of Array.isArray(items) ? items : []) {
        upsert.run(text(item.url), text(item.title), price(item.price), text(item.currency), text(item.image));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.amazon();
  }

  /* ---------- Enlaces de descarga ---------- */

  downloads() {
    this.purge('bots_downloads');
    return this.db
      .prepare(
        'SELECT id, url, source_title, source_url, fetched_at FROM bots_downloads ORDER BY fetched_at DESC, id DESC',
      )
      .all()
      .map((row) => ({
        id:          integer(row.id),
        url:         row.url,
        sourceTitle: row.source_title,
        sourceUrl:   row.source_url,
        fetched:     row.fetched_at,
      }));
  }

  saveDownloads(items) {
    const upsert = this.db.prepare(
      `INSERT INTO bots_downloads (url, source_title, source_url) VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         source_title = excluded.source_title,
         source_url = excluded.source_url,
         fetched_at = datetime('now')`,
    );
    this.db.exec('BEGIN');
    try {
      for (const item of Array.isArray(items) ? items : []) {
        upsert.run(text(item.url), text(item.sourceTitle), text(item.sourceUrl));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.downloads();
  }

  /* ---------- Sesiones ---------- */

  mapSession(row) {
    if (!row) return null;
    return {
      id:              integer(row.id),
      portal:          row.portal,
      url:             row.url,
      username:        row.username,
      password:        row.password,
      userField:       row.user_field,
      passField:       row.pass_field,
      submitSelector:  row.submit_selector,
      successSelector: row.success_selector,
      createdAt:       row.created_at,
      updatedAt:       row.updated_at,
    };
  }

  sessions() {
    return this.db
      .prepare('SELECT * FROM bots_sessions ORDER BY portal COLLATE NOCASE')
      .all()
      .map((row) => this.mapSession(row));
  }

  getSessionByPortal(portal) {
    return this.mapSession(
      this.db.prepare('SELECT * FROM bots_sessions WHERE portal = ?').get(text(portal)),
    );
  }

  sanitizeSession(data) {
    const portal = text(data.portal);
    if (!portal) throw new Error('La sesión necesita un nombre de portal.');
    const url = text(data.url);
    if (!/^https?:\/\//i.test(url)) throw new Error('El portal necesita una URL válida (http/https).');
    const username = text(data.username);
    if (!username) throw new Error('La sesión necesita un usuario.');
    const password = text(data.password);
    if (!password) throw new Error('La sesión necesita una contraseña.');
    const userField  = text(data.userField);
    const passField  = text(data.passField);
    if (!userField || !passField)
      throw new Error('Faltan los selectores de los campos de usuario y contraseña.');
    return {
      portal,
      url,
      username,
      password,
      userField,
      passField,
      submitSelector: text(data.submitSelector) || 'button[type="submit"], input[type="submit"]',
      successSelector: text(data.successSelector),
    };
  }

  saveSession(data) {
    const clean = this.sanitizeSession(data);
    this.db
      .prepare(
        `INSERT INTO bots_sessions (portal, url, username, password, user_field, pass_field, submit_selector, success_selector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(portal) DO UPDATE SET
           url = excluded.url,
           username = excluded.username,
           password = excluded.password,
           user_field = excluded.user_field,
           pass_field = excluded.pass_field,
           submit_selector = excluded.submit_selector,
           success_selector = excluded.success_selector,
           updated_at = datetime('now')`,
      )
      .run(clean.portal, clean.url, clean.username, clean.password, clean.userField, clean.passField, clean.submitSelector, clean.successSelector);
    return this.getSessionByPortal(clean.portal);
  }

  deleteSession(id) {
    const target = Number(id);
    if (!INTEGER_RE.test(String(target))) throw new Error('El id de la sesión es inválido.');
    return this.db.prepare('DELETE FROM bots_sessions WHERE id = ?').run(target).changes > 0;
  }
}

module.exports = { BotsManager, TTL_DAYS };