const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// ── Motor de reglas de archivos ────────────────────────────────────────────
// Una regla es una secuencia (stack) de operaciones, cada una con su tipo y
// parámetros, que se aplican al nombre del archivo al terminar la descarga.
// Se persisten como JSON en el archivo de datos del RuleManager.
//
// Las operaciones de "texto", "matemáticas" y "fechas" trabajan sobre el
// nombre base (sin la extensión final); las de "extensión" modifican solo la
// extensión. El stack se aplica en orden, de modo que cada operación ve el
// resultado de la anterior.

function pad2(value) {
  return String(value).padStart(2, '0');
}
function stripDots(value) {
  return String(value).replace(/^[.\s]+|[.\s]+$/g, '');
}
// Separa "Serie.2024.mkv" en base="Serie.2024" y ext="mkv". Si no hay
// extensión, ext queda "".
function splitFileParts(fileName) {
  const text = String(fileName || '');
  const match = /\.([^./\\]+)$/.exec(text);
  if (!match) return { base: text, ext: '' };
  return { base: text.slice(0, match.index), ext: match[1] };
}
function joinFileParts(parts) {
  return parts.ext ? `${parts.base}.${parts.ext}` : parts.base;
}
// Parsea un número de un nombre: admite coma decimal ("1,5"), punto decimal
// ("1.5") y separadores de miles ("1.500").
function parseNumber(text) {
  const cleaned = String(text).replace(/\s/g, '');
  if (cleaned.includes(',')) return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  // Un punto seguido de exactamente 3 dígitos se interpreta como separador de
  // miles ("1.500" = mil quinientos); cualquier otra cosa es decimal ("1.5").
  if (/^\d+\.\d+$/.test(cleaned)) {
    const [integer, fraction] = cleaned.split('.');
    return fraction.length === 3 ? Number(integer) * 1000 + Number(fraction) : Number(cleaned);
  }
  return parseInt(cleaned.replace(/\./g, ''), 10) || 0;
}
function decimalsIn(text) {
  const match = String(text).match(/[.,](\d+)$/);
  return match ? match[1].length : 0;
}
function renderNumber(value, decimals, separator) {
  let out = value.toFixed(decimals);
  if (decimals > 0) out = out.replace(/0+$/, '').replace(/\.$/, '');
  if (separator === ',') out = out.replace('.', ',');
  return out;
}
function numberMatches(base) {
  return [...String(base).matchAll(/(-?\d+(?:[.,]\d+)?)/g)].map((match) => ({
    index:       match.index,
    length:      match[0].length,
    text:        match[0],
    value:       parseNumber(match[0]),
    decimals:    decimalsIn(match[0]),
    separator:   /,/.test(match[0]) ? ',' : '.',
  }));
}
function replaceAt(text, start, length, replacement) {
  return text.slice(0, start) + replacement + text.slice(start + length);
}
function pickNumber(base, params) {
  const matches = numberMatches(base);
  if (!matches.length) return null;
  return params?.position === 'last' ? matches.at(-1) : matches[0];
}
// Busca la primera (o última) fecha en el nombre. Soporta "2024-01-31" (ymd)
// y "31-01-2024" (dmy) con cualquier separador no numérico.
function findDate(base, params) {
  const patterns = [
    { regex: /(\d{4})[^0-9]+(\d{1,2})[^0-9]+(\d{1,2})/g, order: 'ymd' },
    { regex: /(\d{1,2})[^0-9]+(\d{1,2})[^0-9]+(\d{4})/g, order: 'dmy' },
  ];
  const found = [];
  for (const { regex, order } of patterns) {
    for (const match of String(base).matchAll(regex)) {
      const [full, a, b, c] = match;
      // "YYYY-MM-DD": a=año, b=mes, c=día · "DD/MM/YYYY": a=día, b=mes, c=año.
      const [y, m, d] = order === 'ymd' ? [Number(a), Number(b), Number(c)] : [Number(c), Number(b), Number(a)];
      if (m < 1 || m > 12 || d < 1 || d > 31) continue;
      found.push({
        index:  match.index,
        length: full.length,
        y,
        m,
        d,
        order,
        seps:   full.split(/\d+/).filter(Boolean),
      });
    }
  }
  if (!found.length) return null;
  found.sort((x, y) => x.index - y.index);
  return params?.position === 'last' ? found.at(-1) : found[0];
}
// Usa UTC para que sumar días/meses/años no se desfase por huso horario (p. ej.
// el cambio de DST en Chile desliza las fechas si se usa la hora local).
function shiftDate({ y, m, d }, amount, unit) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (unit === 'days') date.setUTCDate(date.getUTCDate() + amount);
  else if (unit === 'months') date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCFullYear(date.getUTCFullYear() + amount);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}
function renderDate(date, order, seps) {
  const [first, second, third] =
    order === 'ymd' ? [String(date.y).padStart(4, '0'), pad2(date.m), pad2(date.d)] : [pad2(date.d), pad2(date.m), String(date.y).padStart(4, '0')];
  if (seps?.length) return `${first}${seps[0]}${second}${seps[1] || ''}${third}`;
  return `${first}${second}${third}`;
}
const TARGET_PATTERNS = {
  'YYYY-MM-DD': ({ y, m, d }) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`,
  'DD-MM-YYYY': ({ y, m, d }) => `${pad2(d)}-${pad2(m)}-${String(y).padStart(4, '0')}`,
  'DD/MM/YYYY': ({ y, m, d }) => `${pad2(d)}/${pad2(m)}/${String(y).padStart(4, '0')}`,
  'YYYY.MM.DD': ({ y, m, d }) => `${String(y).padStart(4, '0')}.${pad2(m)}.${pad2(d)}`,
  'YYYYMMDD':   ({ y, m, d }) => `${String(y).padStart(4, '0')}${pad2(m)}${pad2(d)}`,
};

// Las claves coinciden con los tipos usados por el editor del renderer
// (src/RuleEditor.tsx). Cada operación conoce cómo aplicar sus parámetros.
const OPERATIONS = {
  'ext-change': {
    apply(parts, params) {
      const extension = stripDots(params?.extension);
      if (extension) parts.ext = extension.replace(/[^a-zA-Z0-9_-]/g, '');
    },
  },
  'ext-add': {
    apply(parts, params) {
      const extension = stripDots(params?.extension);
      if (extension) parts.ext = parts.ext ? `${parts.ext}.${extension}` : extension;
    },
  },
  'text-upper': { apply: (parts) => void (parts.base = parts.base.toUpperCase()) },
  'text-lower': { apply: (parts) => void (parts.base = parts.base.toLowerCase()) },
  'text-title': {
    // Solo sube la primera letra de cada palabra, sin alterar el resto
    // (no convierte "NBA" en "Nba").
    apply: (parts) =>
      void (parts.base = parts.base.replace(
        /(^|\s)(\p{L})/gu,
        (_, space, letter) => space + letter.toUpperCase(),
      )),
  },
  'text-trim': {
    apply: (parts) => void (parts.base = parts.base.replace(/\s+/g, ' ').trim()),
  },
  'text-replace': {
    apply(parts, params) {
      const search = String(params?.search ?? '');
      if (!search) return;
      parts.base = parts.base.split(search).join(String(params?.replace ?? ''));
    },
  },
  'text-remove': {
    apply(parts, params) {
      const search = String(params?.search ?? '');
      if (!search) return;
      parts.base = parts.base.split(search).join('');
    },
  },
  'text-prefix': { apply: (parts, params) => void (parts.base = `${String(params?.text ?? '')}${parts.base}`) },
  'text-suffix': { apply: (parts, params) => void (parts.base = `${parts.base}${String(params?.text ?? '')}`) },
  'math-number': {
    apply(parts, params) {
      const match = pickNumber(parts.base, params);
      if (!match) return;
      const value = Number(params?.value) || 0;
      let result  = match.value;
      if (params?.op === 'subtract') result = match.value - value;
      else if (params?.op === 'multiply') result = match.value * value;
      else if (params?.op === 'divide') {
        if (!value) return;
        result = match.value / value;
      } else result = match.value + value;
      parts.base = replaceAt(
        parts.base,
        match.index,
        match.length,
        renderNumber(result, match.decimals, match.separator),
      );
    },
  },
  'math-round': {
    apply(parts, params) {
      const match = pickNumber(parts.base, params);
      if (!match) return;
      const decimals = Math.max(0, Math.min(6, Number(params?.decimals) || 0));
      parts.base = replaceAt(
        parts.base,
        match.index,
        match.length,
        renderNumber(Number(match.value.toFixed(decimals)), decimals, match.separator),
      );
    },
  },
  'date-shift': {
    apply(parts, params) {
      const match = findDate(parts.base, params);
      if (!match) return;
      const shifted = shiftDate(match, Number(params?.amount) || 0, params?.unit || 'days');
      parts.base = replaceAt(parts.base, match.index, match.length, renderDate(shifted, match.order, match.seps));
    },
  },
  'date-format': {
    apply(parts, params) {
      const match = findDate(parts.base, params);
      if (!match) return;
      const format = TARGET_PATTERNS[params?.target];
      if (!format) return;
      parts.base = replaceAt(parts.base, match.index, match.length, format(match));
    },
  },
};

// Valida y normaliza una operación entrante: descarta tipos desconocidos y
// conserva solo los parámetros que el tipo conoce (defaults seguros).
const FIELD_DEFS = {
  'ext-change':   [{ key: 'extension', type: 'text' }],
  'ext-add':      [{ key: 'extension', type: 'text' }],
  'text-replace': [
    { key: 'search', type: 'text' },
    { key: 'replace', type: 'text' },
  ],
  'text-remove':  [{ key: 'search', type: 'text' }],
  'text-prefix':  [{ key: 'text', type: 'text' }],
  'text-suffix':  [{ key: 'text', type: 'text' }],
  'math-number':  [
    { key: 'op', type: 'select', options: ['add', 'subtract', 'multiply', 'divide'] },
    { key: 'value', type: 'number' },
    { key: 'position', type: 'select', options: ['first', 'last'] },
  ],
  'math-round': [
    { key: 'decimals', type: 'number' },
    { key: 'position', type: 'select', options: ['first', 'last'] },
  ],
  'date-shift': [
    { key: 'amount', type: 'number' },
    { key: 'unit', type: 'select', options: ['days', 'months', 'years'] },
    { key: 'position', type: 'select', options: ['first', 'last'] },
  ],
  'date-format': [
    { key: 'target', type: 'select', options: Object.keys(TARGET_PATTERNS) },
    { key: 'position', type: 'select', options: ['first', 'last'] },
  ],
};
const TEXT_ONLY = ['text-upper', 'text-lower', 'text-title', 'text-trim'];

function defaultFor(field) {
  if (field.type === 'number') return 0;
  if (field.options?.length) return field.options[0];
  return '';
}
function normalizeOperation(raw) {
  const type = raw?.type && Object.hasOwn(OPERATIONS, raw.type) ? raw.type : null;
  if (!type) return null;
  const clean = { type };
  for (const field of FIELD_DEFS[type] || []) {
    const value = raw[field.key];
    if (field.type === 'number') {
      const number = Number(value);
      clean[field.key] = Number.isFinite(number) ? number : defaultFor(field);
    } else if (field.options) {
      clean[field.key] = field.options.includes(value) ? value : defaultFor(field);
    } else {
      const text = String(value ?? '');
      clean[field.key] = text.length ? text : defaultFor(field);
    }
  }
  return clean;
}

// Aplica una secuencia de operaciones (el stack de una regla) a un nombre.
function applyRule(operations, fileName) {
  const parts = splitFileParts(fileName);
  for (const raw of operations || []) {
    const operation = OPERATIONS[raw?.type];
    if (!operation) continue;
    operation.apply(parts, raw || {});
  }
  return joinFileParts(parts);
}
function normalizeRule(input) {
  const rule = {
    id:         typeof input?.id === 'string' && input.id ? input.id : randomUUID(),
    name:       String(input?.name || '').trim() || 'Sin nombre',
    operations: [],
  };
  for (const raw of input?.operations || []) {
    const operation = normalizeOperation(raw);
    if (operation) rule.operations.push(operation);
  }
  return rule;
}

// Persistencia: guarda las reglas como JSON (rules.json bajo userData).
class RuleManager {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.rules = new Map();
    this.load();
  }
  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      for (const raw of data.rules || []) {
        const rule = normalizeRule(raw);
        this.rules.set(rule.id, rule);
      }
    } catch {
      // Archivo inexistente o corrupto: se parte de cero.
    }
  }
  list() {
    return [...this.rules.values()];
  }
  get(id) {
    return this.rules.get(id);
  }
  save(input) {
    const rule = normalizeRule(input);
    this.rules.set(rule.id, rule);
    this.persist();
    return rule;
  }
  remove(id) {
    const removed = this.rules.delete(id);
    if (removed) this.persist();
    return removed;
  }
  persist() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    fs.writeFileSync(this.dataFile, JSON.stringify({ rules: this.list() }, null, 2));
  }
}

module.exports = {
  RuleManager,
  applyRule,
  normalizeRule,
  normalizeOperation,
  // Helpers puros expuestos para pruebas unitarias.
  splitFileParts,
  joinFileParts,
  parseNumber,
  findDate,
  TEXT_ONLY,
};