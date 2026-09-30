const { DatabaseSync } = require('node:sqlite');

const EVENT_COLORS = ['teal', 'azul', 'naranja', 'rojo', 'verde', 'morado', 'amarillo'];
const COLOR_SET = new Set(EVENT_COLORS);

const parse = (value, fallback) => {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeTitle = (title) => {
  const value = String(title || '').trim();
  if (!value) throw new Error('El evento necesita un título.');
  return value;
};

const normalizeDate = (date, field = 'Fecha') => {
  const value = String(date || '').trim();
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime()))
    throw new Error(`${field} inválida. Debe tener formato AAAA-MM-DD.`);
  return value;
};

const normalizeTime = (time, field) => {
  if (time === null || time === undefined || time === '') return null;
  const value = String(time).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error(`${field} inválida. Debe tener formato HH:MM.`);
  return value;
};

class CalendarioManager {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'teal',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 1,
        start_time TEXT,
        end_time TEXT,
        description TEXT NOT NULL DEFAULT '',
        images_json TEXT NOT NULL DEFAULT '[]',
        is_holiday INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events(start_date, end_date);
    `);
    const columns = this.db.prepare('PRAGMA table_info(calendar_events)').all();
    if (!columns.some((column) => column.name === 'is_holiday')) {
      this.db.exec(`ALTER TABLE calendar_events ADD COLUMN is_holiday INTEGER NOT NULL DEFAULT 0`);
    }
  }

  close() {
    this.db.close();
  }

  mapEvent(row) {
    if (!row) return null;
    return {
      id: integer(row.id),
      title: row.title,
      label: row.label,
      color: row.color,
      startDate: row.start_date,
      endDate: row.end_date,
      allDay: Boolean(row.all_day),
      startTime: row.start_time,
      endTime: row.end_time,
      description: row.description,
      images: parse(row.images_json, []),
      isHoliday: Boolean(row.is_holiday),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  eventsForRange(start, end) {
    const from = normalizeDate(start, 'Fecha inicial');
    const to = normalizeDate(end, 'Fecha final');
    if (from > to) throw new Error('El rango de consulta es inválido.');
    return this.db
      .prepare(
        'SELECT * FROM calendar_events WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, start_time',
      )
      .all(to, from)
      .map((row) => this.mapEvent(row));
  }

  getEvent(id) {
    return this.mapEvent(this.db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id));
  }

  sanitizeEvent(data) {
    const startDate = normalizeDate(data.startDate, 'Fecha de inicio');
    const endDate = normalizeDate(data.endDate ?? data.startDate, 'Fecha de fin');
    if (endDate < startDate)
      throw new Error('La fecha de fin no puede ser anterior a la de inicio.');
    const allDay = data.allDay === undefined ? true : Boolean(data.allDay);
    const startTime = allDay ? null : normalizeTime(data.startTime, 'Hora de inicio');
    const endTime = allDay ? null : normalizeTime(data.endTime, 'Hora de fin');
    if (!allDay && !startTime)
      throw new Error('Un evento con hora necesita una hora de inicio.');
    const color = String(data.color || 'teal');
    if (!COLOR_SET.has(color)) throw new Error(`Color no soportado: ${color}.`);
    const images = Array.isArray(data.images)
      ? data.images.map((image) => String(image).trim()).filter(Boolean)
      : [];
    return {
      title: normalizeTitle(data.title),
      label: String(data.label || '').trim(),
      color,
      startDate,
      endDate,
      allDay,
      startTime,
      endTime,
      description: String(data.description || ''),
      images,
      isHoliday: Boolean(data.isHoliday),
    };
  }

  createEvent(data) {
    const clean = this.sanitizeEvent(data);
    const result = this.db
      .prepare(
        `INSERT INTO calendar_events
           (title, label, color, start_date, end_date, all_day, start_time, end_time, description, images_json, is_holiday)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clean.title,
        clean.label,
        clean.color,
        clean.startDate,
        clean.endDate,
        clean.allDay ? 1 : 0,
        clean.startTime,
        clean.endTime,
        clean.description,
        JSON.stringify(clean.images),
        clean.isHoliday ? 1 : 0,
      );
    return this.getEvent(integer(result.lastInsertRowid));
  }

  updateEvent(id, patch) {
    const current = this.getEvent(id);
    if (!current) throw new Error('Evento no encontrado.');
    const data = {
      title: patch.title === undefined ? current.title : patch.title,
      label: patch.label === undefined ? current.label : patch.label,
      color: patch.color === undefined ? current.color : patch.color,
      startDate: patch.startDate === undefined ? current.startDate : patch.startDate,
      endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
      allDay: patch.allDay === undefined ? current.allDay : patch.allDay,
      startTime: patch.startTime === undefined ? current.startTime : patch.startTime,
      endTime: patch.endTime === undefined ? current.endTime : patch.endTime,
      description: patch.description === undefined ? current.description : patch.description,
      images: patch.images === undefined ? current.images : patch.images,
      isHoliday: current.isHoliday,
    };
    const clean = this.sanitizeEvent(data);
    this.db
      .prepare(
        `UPDATE calendar_events SET
           title = ?, label = ?, color = ?, start_date = ?, end_date = ?,
           all_day = ?, start_time = ?, end_time = ?, description = ?, images_json = ?, is_holiday = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        clean.title,
        clean.label,
        clean.color,
        clean.startDate,
        clean.endDate,
        clean.allDay ? 1 : 0,
        clean.startTime,
        clean.endTime,
        clean.description,
        JSON.stringify(clean.images),
        clean.isHoliday ? 1 : 0,
        id,
      );
    return this.getEvent(id);
  }

  replaceHolidays(year, holidays) {
    const target = Number(year);
    if (!Number.isInteger(target)) throw new Error('El año solicitado es inválido.');
    const from = `${target}-01-01`;
    const to   = `${target}-12-31`;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('DELETE FROM calendar_events WHERE is_holiday = 1 AND start_date BETWEEN ? AND ?')
        .run(from, to);
      const insert = this.db.prepare(
        `INSERT INTO calendar_events
           (title, label, color, start_date, end_date, all_day, start_time, end_time, description, images_json, is_holiday)
         VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, '[]', 1)`,
      );
      for (const holiday of holidays) {
        const date = String(holiday.date || '').trim();
        if (!DATE_RE.test(date)) continue;
        insert.run(
          normalizeTitle(holiday.title),
          String(holiday.label || '').trim(),
          String(holiday.color || 'rojo'),
          date,
          date,
          String(holiday.description || ''),
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM calendar_events WHERE is_holiday = 1 AND start_date BETWEEN ? AND ?',
      )
      .get(from, to).count;
  }

  deleteEvent(id) {
    return this.db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id).changes > 0;
  }
}

module.exports = { CalendarioManager, EVENT_COLORS };