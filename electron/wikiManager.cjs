const { DatabaseSync } = require('node:sqlite');

// ── Wiki y Documentos ─────────────────────────────────────────────────────────
// Base de conocimiento local: páginas de contenido libre agrupadas por
// categoría, con búsqueda simple y registro de actividad reciente. Todo se
// persiste en SQLite (wiki.sqlite bajo userData), igual que el resto de la
// suite.

const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);

const slugify = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DEFAULT_ICONS = {
  Guías: '📖',
  Procesos: '⚙️',
  Proyectos: '📊',
  Recursos: '🧰',
};

const BANNER_POSITIONS = new Set(['top', 'center', 'bottom']);

class WikiManager {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL DEFAULT 'General',
        icon TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        tag TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        author TEXT NOT NULL DEFAULT '',
        banner TEXT NOT NULL DEFAULT '',
        banner_position TEXT NOT NULL DEFAULT 'center',
        parent_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_category ON wiki_pages(category);
    `);
    // Migración: bases creadas antes de soportar subpáginas no tienen parent_id.
    // Debe ejecutarse antes de crear el índice sobre esa columna.
    const columns = this.db.prepare('PRAGMA table_info(wiki_pages)').all();
    if (!columns.some((column) => column.name === 'parent_id'))
      this.db.exec(
        'ALTER TABLE wiki_pages ADD COLUMN parent_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE',
      );
    if (!columns.some((column) => column.name === 'banner'))
      this.db.exec("ALTER TABLE wiki_pages ADD COLUMN banner TEXT NOT NULL DEFAULT ''");
    if (!columns.some((column) => column.name === 'banner_position'))
      this.db.exec("ALTER TABLE wiki_pages ADD COLUMN banner_position TEXT NOT NULL DEFAULT 'center'");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages(parent_id)');
  }

  close() {
    this.db.close();
  }

  mapPage(row) {
    return {
      id:        integer(row.id),
      title:     row.title,
      slug:      row.slug,
      category:  row.category,
      icon:      row.icon,
      summary:   row.summary,
      content:   row.content,
      tag:       row.tag,
      pinned:    Boolean(row.pinned),
      author:    row.author,
      banner:    row.banner || '',
      bannerPosition: row.banner_position || 'center',
      parentId:  row.parent_id === null ? null : integer(row.parent_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Recorre la cadena de padres desde parentId hacia la raíz: si en algún
  // punto se encuentra id, mover/crear con ese padre formaría un ciclo
  // (p. ej. convertir una página en subpágina de su propia subpágina).
  wouldCreateCycle(id, parentId) {
    const seen = new Set();
    let current = parentId;
    while (current !== null && current !== undefined) {
      if (current === id || seen.has(current)) return true;
      seen.add(current);
      const row = this.db.prepare('SELECT parent_id FROM wiki_pages WHERE id = ?').get(current);
      if (!row) return false;
      current = row.parent_id === null ? null : integer(row.parent_id);
    }
    return false;
  }

  uniqueSlug(title, ignoreId) {
    const base = slugify(title) || 'pagina';
    let slug = base;
    let attempt = 1;
    while (true) {
      const row = this.db
        .prepare('SELECT id FROM wiki_pages WHERE slug = ?')
        .get(slug);
      if (!row || integer(row.id) === ignoreId) return slug;
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
  }

  sanitize(data, current) {
    const title = String(data.title ?? current?.title ?? '').trim();
    if (!title) throw new Error('El título es obligatorio.');
    const category = String(data.category ?? current?.category ?? 'General').trim() || 'General';
    const rawParent = data.parentId !== undefined ? data.parentId : current?.parentId ?? null;
    const parentId = rawParent === null || rawParent === undefined || rawParent === '' ? null : integer(Number(rawParent));
    if (parentId !== null) {
      if (!Number.isInteger(parentId)) throw new Error('La página padre no es válida.');
      if (!this.getPage(parentId)) throw new Error('La página padre no existe.');
      if (current && this.wouldCreateCycle(current.id, parentId))
        throw new Error('No puedes mover una página dentro de sí misma o de una subpágina suya.');
    }
    return {
      title,
      category,
      icon:    String(data.icon ?? current?.icon ?? DEFAULT_ICONS[category] ?? '📄'),
      summary: String(data.summary ?? current?.summary ?? '').trim(),
      content: String(data.content ?? current?.content ?? ''),
      tag:     String(data.tag ?? current?.tag ?? '').trim(),
      pinned:  Boolean(data.pinned ?? current?.pinned ?? false),
      author:  String(data.author ?? current?.author ?? '').trim(),
      banner:  String(data.banner ?? current?.banner ?? '').trim(),
      bannerPosition: BANNER_POSITIONS.has(String(data.bannerPosition ?? current?.bannerPosition ?? 'center'))
        ? String(data.bannerPosition ?? current?.bannerPosition ?? 'center')
        : 'center',
      parentId,
    };
  }

  listPages(query) {
    const term = String(query || '').trim();
    const rows = term
      ? this.db
          .prepare(
            `SELECT * FROM wiki_pages
             WHERE title LIKE ? OR summary LIKE ? OR content LIKE ? OR category LIKE ? OR tag LIKE ?
             ORDER BY updated_at DESC`,
          )
          .all(...Array(5).fill(`%${term}%`))
      : this.db.prepare('SELECT * FROM wiki_pages ORDER BY updated_at DESC').all();
    return rows.map((row) => this.mapPage(row));
  }

  getPage(id) {
    const row = this.db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(id);
    return row ? this.mapPage(row) : null;
  }

  getPageBySlug(slug) {
    const row = this.db.prepare('SELECT * FROM wiki_pages WHERE slug = ?').get(slug);
    return row ? this.mapPage(row) : null;
  }

  createPage(data) {
    const page = this.sanitize(data);
    const slug = this.uniqueSlug(page.title);
    const result = this.db
      .prepare(
        `INSERT INTO wiki_pages (title, slug, category, icon, summary, content, tag, pinned, author, banner, banner_position, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        page.title,
        slug,
        page.category,
        page.icon,
        page.summary,
        page.content,
        page.tag,
        page.pinned ? 1 : 0,
        page.author,
        page.banner,
        page.bannerPosition,
        page.parentId,
      );
    return this.getPage(integer(result.lastInsertRowid));
  }

  updatePage(id, patch) {
    const current = this.getPage(id);
    if (!current) throw new Error('La página no existe.');
    const page = this.sanitize(patch, current);
    const slug =
      patch.title !== undefined && patch.title !== current.title
        ? this.uniqueSlug(page.title, id)
        : current.slug;
    this.db
      .prepare(
        `UPDATE wiki_pages SET title = ?, slug = ?, category = ?, icon = ?, summary = ?,
         content = ?, tag = ?, pinned = ?, author = ?, banner = ?, banner_position = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        page.title,
        slug,
        page.category,
        page.icon,
        page.summary,
        page.content,
        page.tag,
        page.pinned ? 1 : 0,
        page.author,
        page.banner,
        page.bannerPosition,
        page.parentId,
        id,
      );
    return this.getPage(id);
  }

  deletePage(id) {
    const result = this.db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(id);
    return integer(result.changes) > 0;
  }

  // Resumen por categoría: cantidad de páginas y muestra de ícono/etiqueta
  // para pintar las tarjetas "Explorar por categoría" del inicio.
  categories() {
    const rows = this.db
      .prepare(
        `SELECT category, COUNT(*) AS total, MAX(icon) AS icon
         FROM wiki_pages GROUP BY category ORDER BY category COLLATE NOCASE`,
      )
      .all();
    return rows.map((row) => ({
      name:  row.category,
      total: integer(row.total),
      icon:  row.icon || DEFAULT_ICONS[row.category] || '📄',
    }));
  }

  stats() {
    const totalRow = this.db.prepare('SELECT COUNT(*) AS total FROM wiki_pages').get();
    const authorsRow = this.db
      .prepare("SELECT COUNT(DISTINCT author) AS total FROM wiki_pages WHERE author != ''")
      .get();
    const lastRow = this.db.prepare('SELECT MAX(updated_at) AS last FROM wiki_pages').get();
    return {
      total:        integer(totalRow.total),
      contributors: integer(authorsRow.total),
      lastUpdated:  lastRow.last || null,
    };
  }
}

module.exports = { WikiManager, slugify };
