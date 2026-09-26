const { DatabaseSync } = require('node:sqlite');

// ── Hijitos ──────────────────────────────────────────────────────────────────
// Seguimiento de tareas del equipo dividido en dos tracks fijos (Izumi y
// Pepita). Cada tarea tiene descripción, fecha de compromiso opcional y una
// prioridad (bajo/medio/alto); puede contener subtareas. Todo se persiste en
// SQLite (hijitos.sqlite bajo userData), igual que el resto de la suite.

const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);

// Coordenada de posición del banner como entero 0-100 (%): valores fuera de
// rango o no numéricos se aplanan al valor previo guardado.
const clampPosition = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
};

const PRIORITIES = new Set(['bajo', 'medio', 'alto']);
// Orden de prioridad para ordenar las pendientes (alto primero).
const PRIORITY_WEIGHT = { alto: 0, medio: 1, bajo: 2 };
const TRACK_SEEDS = [
  { slug: 'izumi', name: 'Izumi' },
  { slug: 'pepita', name: 'Pepita' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HijitosManager {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS hijito_tracks (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        banner TEXT NOT NULL DEFAULT '',
        banner_x INTEGER NOT NULL DEFAULT 50,
        banner_y INTEGER NOT NULL DEFAULT 50,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS hijito_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_slug TEXT NOT NULL REFERENCES hijito_tracks(slug) ON DELETE CASCADE,
        description TEXT NOT NULL,
        due_date TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'medio',
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS hijito_subtasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES hijito_tasks(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_hijito_tasks_track ON hijito_tasks(track_slug);
      CREATE INDEX IF NOT EXISTS idx_hijito_subtasks_task ON hijito_subtasks(task_id);
      CREATE TABLE IF NOT EXISTS hijito_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    for (const seed of TRACK_SEEDS) {
      this.db
        .prepare('INSERT OR IGNORE INTO hijito_tracks (slug, name) VALUES (?, ?)')
        .run(seed.slug, seed.name);
    }
    // Migración: columnas de posición del banner por si la tabla ya existía.
    const trackColumns = this.db
      .prepare('PRAGMA table_info(hijito_tracks)')
      .all()
      .map((column) => column.name);
    if (!trackColumns.includes('banner_x')) {
      this.db.exec('ALTER TABLE hijito_tracks ADD COLUMN banner_x INTEGER NOT NULL DEFAULT 50');
    }
    if (!trackColumns.includes('banner_y')) {
      this.db.exec('ALTER TABLE hijito_tracks ADD COLUMN banner_y INTEGER NOT NULL DEFAULT 50');
    }
  }

  close() {
    this.db.close();
  }

  mapTrack(row) {
    return {
      slug:      row.slug,
      name:      row.name,
      banner:    row.banner || '',
      bannerX:   row.banner_x ?? 50,
      bannerY:   row.banner_y ?? 50,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  mapTask(row) {
    return {
      id:          integer(row.id),
      trackSlug:   row.track_slug,
      description: row.description,
      dueDate:     row.due_date,
      priority:    row.priority,
      done:        Boolean(row.done),
      createdAt:   row.created_at,
      updatedAt:   row.updated_at,
    };
  }

  mapSubtask(row) {
    return {
      id:          integer(row.id),
      taskId:      integer(row.task_id),
      description: row.description,
      done:        Boolean(row.done),
      createdAt:   row.created_at,
    };
  }

  getTrack(slug) {
    const row = this.db.prepare('SELECT * FROM hijito_tracks WHERE slug = ?').get(slug);
    return row ? this.mapTrack(row) : null;
  }

  getTask(id) {
    const row = this.db.prepare('SELECT * FROM hijito_tasks WHERE id = ?').get(id);
    return row ? { ...this.mapTask(row), subtasks: this.listSubtasks(integer(row.id)) } : null;
  }

  listSubtasks(taskId) {
    return this.db
      .prepare('SELECT * FROM hijito_subtasks WHERE task_id = ? ORDER BY id')
      .all(taskId)
      .map((row) => this.mapSubtask(row));
  }

  // Valida y normaliza una tarea entrante; `current` es la tarea existente al
  // editar (los campos omitidos conservan su valor). La fecha de compromiso se
  // guarda como "YYYY-MM-DD" (valor de <input type="date">) o vacía.
  sanitizeTask(data, current) {
    const description = String(data.description ?? current?.description ?? '').trim();
    if (!description) throw new Error('La descripción de la tarea es obligatoria.');
    const trackSlug = data.trackSlug || current?.trackSlug;
    if (!this.getTrack(trackSlug)) throw new Error('El gatito no existe.');
    const dueDate = String(data.dueDate ?? current?.dueDate ?? '').trim();
    if (dueDate && !DATE_RE.test(dueDate))
      throw new Error('La fecha de compromiso debe estar en formato YYYY-MM-DD.');
    const priority = String(data.priority ?? current?.priority ?? 'medio');
    if (!PRIORITIES.has(priority)) throw new Error('La prioridad debe ser bajo, medio o alto.');
    return { trackSlug, description, dueDate, priority };
  }

  updateTrack(slug, patch) {
    const track = this.getTrack(slug);
    if (!track) throw new Error('El gatito no existe.');
    const name = String(patch.name ?? track.name).trim() || track.name;
    const banner = String(patch.banner ?? track.banner).trim();
    const bannerX = clampPosition(patch.bannerX, track.bannerX);
    const bannerY = clampPosition(patch.bannerY, track.bannerY);
    this.db
      .prepare(
        "UPDATE hijito_tracks SET name = ?, banner = ?, banner_x = ?, banner_y = ?, updated_at = datetime('now') WHERE slug = ?",
      )
      .run(name, banner, bannerX, bannerY, slug);
    return this.getTrack(slug);
  }

  createTask(data) {
    const task = this.sanitizeTask(data);
    const result = this.db
      .prepare(
        'INSERT INTO hijito_tasks (track_slug, description, due_date, priority) VALUES (?, ?, ?, ?)',
      )
      .run(task.trackSlug, task.description, task.dueDate, task.priority);
    return this.getTask(integer(result.lastInsertRowid));
  }

  updateTask(id, patch) {
    const current = this.getTask(id);
    if (!current) throw new Error('La tarea no existe.');
    const task = this.sanitizeTask(patch, current);
    const done = Boolean(patch.done ?? current.done);
    this.db
      .prepare(
        "UPDATE hijito_tasks SET track_slug = ?, description = ?, due_date = ?, priority = ?, done = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(task.trackSlug, task.description, task.dueDate, task.priority, done ? 1 : 0, id);
    return this.getTask(id);
  }

  // Marca/desmarca como realizada. Si `done` se omite, alterna el estado
  // actual (permite deshacer la acción y volver la tarea a pendientes).
  toggleTask(id, done) {
    const current = this.getTask(id);
    if (!current) throw new Error('La tarea no existe.');
    const next = done === undefined ? !current.done : Boolean(done);
    return this.updateTask(id, { done: next });
  }

  deleteTask(id) {
    const result = this.db.prepare('DELETE FROM hijito_tasks WHERE id = ?').run(id);
    return integer(result.changes) > 0;
  }

  createSubtask(taskId, description) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('La tarea no existe.');
    const clean = String(description || '').trim();
    if (!clean) throw new Error('La descripción de la subtarea es obligatoria.');
    const result = this.db
      .prepare('INSERT INTO hijito_subtasks (task_id, description) VALUES (?, ?)')
      .run(taskId, clean);
    return this.mapSubtask(
      this.db.prepare('SELECT * FROM hijito_subtasks WHERE id = ?').get(integer(result.lastInsertRowid)),
    );
  }

  updateSubtask(id, patch) {
    const current = this.db.prepare('SELECT * FROM hijito_subtasks WHERE id = ?').get(id);
    if (!current) throw new Error('La subtarea no existe.');
    const description = String(patch.description ?? current.description).trim();
    if (!description) throw new Error('La descripción de la subtarea es obligatoria.');
    const done = Boolean(patch.done ?? current.done);
    this.db
      .prepare('UPDATE hijito_subtasks SET description = ?, done = ? WHERE id = ?')
      .run(description, done ? 1 : 0, id);
    return this.mapSubtask(this.db.prepare('SELECT * FROM hijito_subtasks WHERE id = ?').get(id));
  }

  deleteSubtask(id) {
    const result = this.db.prepare('DELETE FROM hijito_subtasks WHERE id = ?').run(id);
    return integer(result.changes) > 0;
  }

  // Banner principal de la sección Hijitos (URL o ruta local), compartido por
  // los dos tracks y guardado en la tabla de ajustes.
  getBanner() {
    const row = this.db.prepare("SELECT value FROM hijito_settings WHERE key = 'banner'").get();
    return row ? row.value : '';
  }

  setBanner(banner) {
    const value = String(banner ?? '').trim();
    if (value.length > 2000) throw new Error('El banner no puede superar los 2000 caracteres.');
    if (value === '') {
      this.db.prepare("DELETE FROM hijito_settings WHERE key = 'banner'").run();
      return '';
    }
    this.db
      .prepare(
        "INSERT INTO hijito_settings (key, value) VALUES ('banner', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(value);
    return value;
  }

  // Devuelve los dos tracks con sus tareas (ordenadas por creación dentro de
  // cada grupo) y los resúmenes para el gráfico de avance de cada gatito:
  // total, realizadas, pendientes y porcentaje.
  listTracks() {
    const trackRows = this.db.prepare('SELECT * FROM hijito_tracks ORDER BY slug').all();
    const taskRows = this.db.prepare('SELECT * FROM hijito_tasks ORDER BY id').all();
    const subtaskRows = this.db.prepare('SELECT * FROM hijito_subtasks ORDER BY id').all();

    const subtasksByTask = new Map();
    for (const row of subtaskRows) {
      const key = integer(row.task_id);
      const list = subtasksByTask.get(key) || [];
      list.push(this.mapSubtask(row));
      subtasksByTask.set(key, list);
    }

    return trackRows.map((trackRow) => {
      const track = this.mapTrack(trackRow);
      const tasks = taskRows
        .filter((row) => row.track_slug === track.slug)
        .map((row) => ({
          ...this.mapTask(row),
          subtasks: subtasksByTask.get(integer(row.id)) || [],
        }));
      const done = tasks.filter((task) => task.done).length;
      const total = tasks.length;
      return {
        ...track,
        tasks,
        stats: {
          total,
          done,
          pending: total - done,
          percent: total ? Math.round((done / total) * 100) : 0,
        },
      };
    });
  }
}

module.exports = { HijitosManager, PRIORITY_WEIGHT };