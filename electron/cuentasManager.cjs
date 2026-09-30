const { DatabaseSync } = require('node:sqlite');

const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'url', 'tags'];
const TYPE_SET = new Set(COLUMN_TYPES);

const parse = (value, fallback) => {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};

const integer = (value) => (typeof value === 'bigint' ? Number(value) : value);

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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
  const normalized =
    Array.isArray(columns)
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
    if (column.required) throw new Error(`El campo "${column.label}" es obligatorio.`);
    return undefined;
  }
  if (column.type === 'string') return String(value);
  if (column.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`El campo "${column.label}" debe ser un número.`);
    return number;
  }
  if (column.type === 'boolean') return Boolean(value);
  if (column.type === 'date') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new Error(`El campo "${column.label}" debe ser una fecha válida.`);
    return date.toISOString();
  }
  if (column.type === 'url') {
    const url = String(value);
    if (!/^https?:\/\//i.test(url)) throw new Error(`El campo "${column.label}" debe ser una URL válida.`);
    return url;
  }
  if (column.type === 'tags') {
    const tags = Array.isArray(value) ? value : String(value).split(',');
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  throw new Error(`Tipo de columna no soportado: ${column.type}.`);
};

const validateValues = (columns, values) => {
  const safe = plainObject(values) ? values : {};
  const out = {};
  for (const column of columns) {
    const value = sanitizeValue(column, safe[column.name]);
    if (value !== undefined) out[column.name] = value;
  }
  return out;
};

const normalizeName = (name) => {
  const value = String(name || '').trim();
  if (!value) throw new Error('La cuenta necesita un nombre.');
  return value;
};

const normalizeAmount = (amount) => {
  const number = Number(amount);
  if (!Number.isFinite(number)) throw new Error('El monto debe ser un número válido.');
  return number;
};

const normalizeRegisterDate = (date) => {
  const value = String(date || '').trim();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00`).getTime())
  )
    throw new Error('La fecha del movimiento debe tener formato AAAA-MM-DD.');
  return value;
};

class CuentasManager {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        schema_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS account_registers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_account_registers_account ON account_registers(account_id);
      CREATE INDEX IF NOT EXISTS idx_account_registers_date ON account_registers(date);
    `);
  }

  close() {
    this.db.close();
  }

  mapAccount(row) {
    if (!row) return null;
    return {
      id: integer(row.id),
      name: row.name,
      description: row.description,
      columns: normalizeColumns(parse(row.schema_json, [])),
      position: integer(row.position),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  mapRegister(row) {
    if (!row) return null;
    return {
      id: integer(row.id),
      accountId: integer(row.account_id),
      name: row.name,
      date: row.date,
      amount: Number(row.amount),
      values: parse(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listAccounts() {
    return this.db
      .prepare('SELECT * FROM accounts ORDER BY position, name COLLATE NOCASE')
      .all()
      .map((row) => this.mapAccount(row));
  }

  getAccount(id) {
    return this.mapAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
  }

  createAccount({ name, description = '', columns = [] }) {
    const normalized = normalizeColumns(columns);
    const clean = normalizeName(name);
    try {
      const position = this.db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM accounts')
        .get().next;
      const result = this.db
        .prepare('INSERT INTO accounts (name, description, schema_json, position) VALUES (?, ?, ?, ?)')
        .run(clean, String(description || ''), JSON.stringify(normalized), integer(position));
      return this.getAccount(integer(result.lastInsertRowid));
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error(`Ya existe una cuenta llamada "${clean}".`);
      throw error;
    }
  }

  updateAccount(id, patch) {
    const current = this.getAccount(id);
    if (!current) throw new Error('Cuenta no encontrada.');
    const name = patch.name === undefined ? current.name : normalizeName(patch.name);
    const description =
      patch.description === undefined ? current.description : String(patch.description || '');
    const columns = patch.columns === undefined ? current.columns : normalizeColumns(patch.columns);
    try {
      this.db
        .prepare(
          "UPDATE accounts SET name = ?, description = ?, schema_json = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(name, description, JSON.stringify(columns), id);
      return this.getAccount(id);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error(`Ya existe una cuenta llamada "${name}".`);
      throw error;
    }
  }

  deleteAccount(id) {
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
  }

  reorderAccounts(ids) {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('Lista de cuentas inválida.');
    const unique = new Set(ids);
    if (unique.size !== ids.length) throw new Error('Lista de cuentas duplicada.');
    const existing = new Set(this.listAccounts().map((account) => account.id));
    for (const id of ids) if (!existing.has(integer(id))) throw new Error('Cuenta inexistente en la lista.');
    this.db.exec('BEGIN');
    try {
      ids.forEach((id, index) =>
        this.db.prepare('UPDATE accounts SET position = ? WHERE id = ?').run(index, integer(id)),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listAccounts();
  }

  listRegisters(accountId, q = '') {
    const query = String(q || '').trim();
    if (query) {
      return this.db
        .prepare(
          'SELECT * FROM account_registers WHERE account_id = ? AND name LIKE ? ORDER BY date DESC, id DESC',
        )
        .all(integer(accountId), `%${query}%`)
        .map((row) => this.mapRegister(row));
    }
    return this.db
      .prepare('SELECT * FROM account_registers WHERE account_id = ? ORDER BY date DESC, id DESC')
      .all(integer(accountId))
      .map((row) => this.mapRegister(row));
  }

  getRegister(id) {
    return this.mapRegister(this.db.prepare('SELECT * FROM account_registers WHERE id = ?').get(id));
  }

  accountColumns(accountId) {
    const account = this.getAccount(accountId);
    if (!account) throw new Error('Cuenta no encontrada.');
    return account.columns;
  }

  sanitizeRegister(accountId, data) {
    const columns = this.accountColumns(accountId);
    return {
      name: String(data?.name || '').trim() || 'Sin concepto',
      date: normalizeRegisterDate(data?.date),
      amount: normalizeAmount(data?.amount),
      values: validateValues(columns, data?.values),
    };
  }

  addRegister({ accountId, name, date, amount, values = {} }) {
    if (!this.getAccount(integer(accountId))) throw new Error('Cuenta no encontrada.');
    const clean = this.sanitizeRegister(accountId, { name, date, amount, values });
    const result = this.db
      .prepare(
        'INSERT INTO account_registers (account_id, name, date, amount, metadata_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(integer(accountId), clean.name, clean.date, clean.amount, JSON.stringify(clean.values));
    return this.getRegister(integer(result.lastInsertRowid));
  }

  updateRegister(id, patch) {
    const current = this.getRegister(id);
    if (!current) throw new Error('Movimiento no encontrado.');
    const clean = this.sanitizeRegister(current.accountId, {
      name: patch.name === undefined ? current.name : patch.name,
      date: patch.date === undefined ? current.date : patch.date,
      amount: patch.amount === undefined ? current.amount : patch.amount,
      values: patch.values === undefined ? current.values : patch.values,
    });
    this.db
      .prepare(
        "UPDATE account_registers SET name = ?, date = ?, amount = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(clean.name, clean.date, clean.amount, JSON.stringify(clean.values), id);
    return this.getRegister(id);
  }

  deleteRegister(id) {
    return this.db.prepare('DELETE FROM account_registers WHERE id = ?').run(id).changes > 0;
  }

  registeredYears(accountId) {
    return this.db
      .prepare(
        "SELECT DISTINCT strftime('%Y', date) AS year FROM account_registers WHERE account_id = ? ORDER BY year DESC",
      )
      .all(integer(accountId))
      .map((row) => Number(row.year));
  }

  monthlyTotals(accountId, year) {
    const theYear = Number(year);
    if (!Number.isInteger(theYear) || theYear < 1900 || theYear > 2999) throw new Error('Año inválido.');
    const rows = this.db
      .prepare(
        `SELECT CAST(strftime('%m', date) AS INTEGER) AS month,
                COUNT(*) AS count,
                SUM(amount) AS total
         FROM account_registers
         WHERE account_id = ? AND strftime('%Y', date) = ?
         GROUP BY month ORDER BY month`,
      )
      .all(integer(accountId), String(theYear));
    const totals = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, total: 0, count: 0 }));
    for (const row of rows) {
      const month = Number(row.month);
      totals[month - 1] = { month, total: Number(row.total), count: Number(row.count) };
    }
    return totals;
  }
}

module.exports = { CuentasManager, COLUMN_TYPES };