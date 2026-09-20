const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = 'analog-replay-tv.sqlite';
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const VIDEO_EXTENSIONS = [
  '.webm',
  '.mkv',
  '.flv',
  '.vob',
  '.ogv',
  '.ogg',
  '.rrc',
  '.gifv',
  '.mng',
  '.mov',
  '.avi',
  '.qt',
  '.wmv',
  '.yuv',
  '.rm',
  '.asf',
  '.amv',
  '.mp4',
  '.m4p',
  '.m4v',
  '.mpg',
  '.mp2',
  '.mpeg',
  '.mpe',
  '.mpv',
  '.svi',
  '.3gp',
  '.3g2',
  '.mxf',
  '.roq',
  '.nsv',
  '.f4v',
  '.f4p',
  '.f4a',
  '.f4b',
  '.mod',
];

function roamingBase() {
  return (
    process.env.APPDATA ||
    (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming') : os.homedir())
  );
}

// Resuelve la carpeta userData real de AnalogReplayTV: instalación empaquetada
// primero y modo desarrollo (Electron) después. Acepta override por entorno
// para pruebas.
function resolveAnalogDir() {
  const override = process.env.ANALOG_REPLAY_TV_USER_DATA;
  if (override) return override;
  const base = roamingBase();
  const packaged = path.join(base, 'analog-replay-tv');
  const dev = path.join(base, 'Electron');
  if (fs.existsSync(path.join(packaged, DB_FILE))) return packaged;
  if (fs.existsSync(path.join(dev, DB_FILE))) return dev;
  if (fs.existsSync(packaged)) return packaged;
  return dev;
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS channels (
    storage_key TEXT PRIMARY KEY,
    legacy_id TEXT,
    uuid TEXT,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
    data_json TEXT NOT NULL CHECK (json_valid(data_json))
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS channels_uuid_uq
    ON channels(uuid) WHERE uuid IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS channels_number_uq ON channels(number);

  CREATE TABLE IF NOT EXISTS shows (
    storage_key TEXT PRIMARY KEY,
    legacy_id TEXT,
    uuid TEXT,
    name TEXT NOT NULL,
    data_json TEXT NOT NULL CHECK (json_valid(data_json))
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS shows_uuid_uq
    ON shows(uuid) WHERE uuid IS NOT NULL;

  CREATE TABLE IF NOT EXISTS schedule_config (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    data_json TEXT NOT NULL CHECK (json_valid(data_json))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS schedule_months (
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    generated_at TEXT NOT NULL,
    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
    PRIMARY KEY (year, month)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS commercial_config (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    data_json TEXT NOT NULL CHECK (json_valid(data_json))
  ) STRICT;

  INSERT OR IGNORE INTO schema_migrations(version, applied_at)
  VALUES (1, datetime('now'));
`;

let db = null;
let dbDir = null;

function database() {
  const dir = resolveAnalogDir();
  if (db && dbDir === dir) return db;
  if (db) {
    try {
      db.close();
    } catch {
      // ignorar cierre fallido al cambiar de directorio
    }
    db = null;
  }
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, DB_FILE));
  db.exec(SCHEMA);
  dbDir = dir;
  return db;
}

function analogDir() {
  database();
  return dbDir;
}

function transaction(action) {
  const handle = database();
  handle.exec('BEGIN IMMEDIATE');
  try {
    const result = action(handle);
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

function parseRows(rows) {
  return rows.map((row) => JSON.parse(row.data_json));
}

function channelNumberHolder(handle, number) {
  try {
    const row = handle.prepare('SELECT name FROM channels WHERE number = ? LIMIT 1').get(number);
    return row ? String(row.name) : '';
  } catch {
    return '';
  }
}

function duplicateChannelMessage(handle, number) {
  const holder = channelNumberHolder(handle, number);
  return holder
    ? `El número de canal ${number} ya está en uso por «${holder}».`
    : `El número de canal ${number} ya está en uso.`;
}

function friendlyDbError(error, duplicateMessage) {
  // Solo el conflicto sobre channels.number se traduce al mensaje de duplicado:
  // otros UNIQUE (uuid, clave primaria) deben surfear con su error original.
  if (error && /UNIQUE constraint failed:\s*channels\.number/i.test(error.message || '')) {
    throw new Error(duplicateMessage);
  }
  throw error;
}

// ===== Canales =====

function listChannels() {
  const rows = database().prepare('SELECT data_json FROM channels ORDER BY number').all();
  return parseRows(rows);
}

function nextChannelId(handle) {
  const rows = handle.prepare('SELECT legacy_id FROM channels').all();
  const max = rows.reduce((top, row) => {
    const value = Number(row.legacy_id);
    return Number.isFinite(value) ? Math.max(top, value) : top;
  }, 0);
  return max + 1;
}

function createChannel(data) {
  const name = String(data.name || '').trim();
  const number = Number(data.number);
  if (!name) throw new Error('El nombre del canal es requerido.');
  if (!Number.isInteger(number) || number < 1 || number > 999)
    throw new Error('El número de canal debe estar entre 1 y 999.');
  return transaction((handle) => {
    const channel = {
      id: nextChannelId(handle),
      uuid: randomUUID(),
      name,
      number,
      description: String(data.description || ''),
      isEnabled: data.isEnabled !== false,
    };
    try {
      handle
        .prepare(
          'INSERT INTO channels(storage_key, legacy_id, uuid, number, name, is_enabled, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          channel.uuid,
          String(channel.id),
          channel.uuid,
          channel.number,
          channel.name,
          channel.isEnabled ? 1 : 0,
          JSON.stringify(channel),
        );
    } catch (error) {
      friendlyDbError(error, duplicateChannelMessage(handle, number));
    }
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('channels.lastUpdated', new Date().toISOString());
    return channel;
  });
}

function findChannelRow(handle, id) {
  const key = String(id);
  return handle
    .prepare('SELECT * FROM channels WHERE legacy_id = ? OR uuid = ? LIMIT 1')
    .get(key, key);
}

function updateChannel(id, patch) {
  return transaction((handle) => {
    const row = findChannelRow(handle, id);
    if (!row) throw new Error('El canal no existe.');
    const current = JSON.parse(row.data_json);
    const next = { ...current, ...patch, id: current.id, uuid: current.uuid || randomUUID() };
    if (patch.name !== undefined) {
      if (!String(patch.name).trim()) throw new Error('El nombre del canal es requerido.');
      next.name = String(patch.name).trim();
    }
    if (patch.number !== undefined) {
      const number = Number(patch.number);
      if (!Number.isInteger(number) || number < 1 || number > 999)
        throw new Error('El número de canal debe estar entre 1 y 999.');
      next.number = number;
    }
    if (patch.isEnabled !== undefined) next.isEnabled = patch.isEnabled !== false;
    try {
      handle
        .prepare(
          'UPDATE channels SET number = ?, name = ?, is_enabled = ?, uuid = ?, data_json = ? WHERE storage_key = ?',
        )
        .run(
          next.number,
          next.name,
          next.isEnabled ? 1 : 0,
          next.uuid,
          JSON.stringify(next),
          row.storage_key,
        );
    } catch (error) {
      friendlyDbError(error, duplicateChannelMessage(handle, next.number));
    }
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('channels.lastUpdated', new Date().toISOString());
    return next;
  });
}

function deleteChannel(id) {
  return transaction((handle) => {
    const row = findChannelRow(handle, id);
    if (!row) return false;
    handle.prepare('DELETE FROM channels WHERE storage_key = ?').run(row.storage_key);
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('channels.lastUpdated', new Date().toISOString());
    return true;
  });
}

function replaceChannels(channels) {
  const list = Array.isArray(channels) ? channels : [];
  return transaction((handle) => {
    handle.exec('DELETE FROM channels');
    const insert = handle.prepare(
      'INSERT INTO channels(storage_key, legacy_id, uuid, number, name, is_enabled, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    list.forEach((channel, index) => {
      const number = Number(channel.number);
      if (!Number.isInteger(number) || number < 1 || number > 999)
        throw new Error(`Canal inválido en la posición ${index + 1}: número fuera de rango.`);
      const id = channel.id == null ? null : String(channel.id);
      const uuid = typeof channel.uuid === 'string' && channel.uuid ? channel.uuid : null;
      const name = String(channel.name ?? `Canal ${number}`);
      const key = uuid || id || `channel-${index + 1}`;
      insert.run(
        key,
        id,
        uuid,
        number,
        name,
        channel.isEnabled === false ? 0 : 1,
        JSON.stringify({ ...channel, name, number }),
      );
    });
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('channels.lastUpdated', new Date().toISOString());
    return list.length;
  });
}

function importChannelsFile(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El archivo no contiene un JSON válido.');
  }
  const channels = Array.isArray(parsed) ? parsed : parsed.channels;
  if (!Array.isArray(channels)) throw new Error('El archivo no contiene una lista de canales.');
  return replaceChannels(channels);
}

// ===== Programas =====

function listShows() {
  const rows = database().prepare('SELECT data_json FROM shows ORDER BY rowid').all();
  return parseRows(rows);
}

function nextShowId(handle) {
  const rows = handle.prepare('SELECT legacy_id FROM shows').all();
  const max = rows.reduce((top, row) => {
    const value = Number(row.legacy_id);
    return Number.isFinite(value) ? Math.max(top, value) : top;
  }, 0);
  return max + 1;
}

function normalizeShow(data, id) {
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  return {
    id,
    uuid: typeof data.uuid === 'string' && data.uuid ? data.uuid : randomUUID(),
    name: String(data.name || '').trim(),
    channel: Array.isArray(data.channel) ? data.channel.map(String) : [],
    seasons: seasons.map((season, index) => ({
      season: Number(season.season) || index + 1,
      year: Number(season.year) || new Date().getFullYear(),
      episodes: Array.isArray(season.episodes)
        ? season.episodes.map((episode, episodeIndex) => ({
            episode: Number(episode.episode) || episodeIndex + 1,
            title: String(episode.title || ''),
            duration: String(episode.duration || '00:00'),
            ...(episode.fileName ? { fileName: String(episode.fileName) } : {}),
            ...(Array.isArray(episode.fileNames)
              ? { fileNames: episode.fileNames.map(String) }
              : {}),
          }))
        : [],
      contentPath: String(season.contentPath || ''),
      contentPaths: Array.isArray(season.contentPaths) ? season.contentPaths.map(String) : [],
    })),
    airYears: Array.isArray(data.airYears)
      ? data.airYears.map(Number).filter((year) => Number.isInteger(year))
      : [],
    airUntilToDate: !!data.airUntilToDate,
    episodeAiringMode: data.episodeAiringMode === 'once-per-day' ? 'once-per-day' : 'daily-repeat',
  };
}

function createShow(data) {
  if (!String(data.name || '').trim()) throw new Error('El nombre del programa es requerido.');
  return transaction((handle) => {
    const show = normalizeShow(data, nextShowId(handle));
    handle
      .prepare(
        'INSERT INTO shows(storage_key, legacy_id, uuid, name, data_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(show.uuid, String(show.id), show.uuid, show.name, JSON.stringify(show));
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('shows.lastUpdated', new Date().toISOString());
    return show;
  });
}

function updateShow(id, patch) {
  return transaction((handle) => {
    const key = String(id);
    const row = handle
      .prepare('SELECT * FROM shows WHERE legacy_id = ? OR uuid = ? LIMIT 1')
      .get(key, key);
    if (!row) throw new Error('El programa no existe.');
    const current = JSON.parse(row.data_json);
    const merged = normalizeShow({ ...current, ...patch }, current.id);
    merged.uuid = current.uuid || merged.uuid;
    if (!merged.name) throw new Error('El nombre del programa es requerido.');
    handle
      .prepare('UPDATE shows SET name = ?, uuid = ?, data_json = ? WHERE storage_key = ?')
      .run(merged.name, merged.uuid, JSON.stringify(merged), row.storage_key);
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('shows.lastUpdated', new Date().toISOString());
    return merged;
  });
}

function deleteShow(id) {
  return transaction((handle) => {
    const key = String(id);
    const row = handle
      .prepare('SELECT storage_key FROM shows WHERE legacy_id = ? OR uuid = ? LIMIT 1')
      .get(key, key);
    if (!row) return false;
    handle.prepare('DELETE FROM shows WHERE storage_key = ?').run(row.storage_key);
    handle
      .prepare(
        'INSERT INTO app_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('shows.lastUpdated', new Date().toISOString());
    return true;
  });
}

function importShowFile(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El archivo no contiene un JSON válido.');
  }
  const candidates = Array.isArray(parsed.shows)
    ? parsed.shows
    : Array.isArray(parsed)
      ? parsed
      : [parsed];
  const imported = [];
  for (const candidate of candidates) {
    if (!candidate || !String(candidate.name || '').trim()) continue;
    if (!Array.isArray(candidate.seasons)) continue;
    imported.push(createShow(candidate));
  }
  if (!imported.length) throw new Error('El archivo no contiene programas válidos.');
  return imported;
}

// ===== Programación =====

function loadScheduleConfig() {
  const row = database().prepare('SELECT data_json FROM schedule_config WHERE singleton = 1').get();
  return row ? JSON.parse(row.data_json) : null;
}

function saveScheduleConfig(config) {
  database()
    .prepare(
      'INSERT INTO schedule_config(singleton, data_json) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET data_json = excluded.data_json',
    )
    .run(JSON.stringify(config));
}

function freshScheduleConfig() {
  return {
    primaryYear: 0,
    secondaryYears: [],
    lastGenerated: '',
    currentYear: new Date().getFullYear(),
    generatedMonths: [],
  };
}

function scheduleStatus() {
  let config = loadScheduleConfig();
  if (!config) {
    config = freshScheduleConfig();
    saveScheduleConfig(config);
  }
  if (!config.primaryYear) return { status: 'needs_year_selection', config };
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!config.generatedMonths.includes(currentMonthKey)) {
    const result = generateYear(config.primaryYear);
    if (!result.success) return { status: 'needs_year_selection', config, error: result.error };
    config = loadScheduleConfig();
  }
  return { status: 'ready', config };
}

function parseDurationToSeconds(duration) {
  const DEFAULT_SECONDS = 5 * 60;
  if (!duration) return DEFAULT_SECONDS;
  const parts = String(duration)
    .split(':')
    .map((part) => parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return DEFAULT_SECONDS;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return DEFAULT_SECONDS;
}

function isShowAssignedToChannel(show, channel) {
  const channels = Array.isArray(show.channel) ? show.channel : [];
  return channels.some(
    (entry) =>
      entry === channel.uuid ||
      entry === String(channel.id) ||
      String(entry).toLowerCase() === String(channel.name).toLowerCase(),
  );
}

function isShowEligibleForYear(show, year) {
  if (show.airUntilToDate) return true;
  if (Array.isArray(show.airYears) && show.airYears.length > 0) {
    const targetDecade = Math.floor(year / 10);
    return show.airYears.some((airYear) => Math.floor(Number(airYear) / 10) === targetDecade);
  }
  return true;
}

function seasonHasRealContent(season) {
  const candidates = [season.contentPath, ...(season.contentPaths || [])].filter(Boolean);
  return candidates.some((candidatePath) => {
    try {
      return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory();
    } catch {
      return false;
    }
  });
}

function parseEpisodeBlockInfo(title) {
  if (!title) return null;
  const match = String(title)
    .trim()
    .match(/^(\d+)\s*([a-zA-Z])?(?=[\s:.-]|$)/);
  if (!match) return null;
  return { group: parseInt(match[1], 10), part: match[2] ? match[2].toLowerCase() : null };
}

function stripEpisodeBlockCode(title) {
  const stripped = String(title)
    .replace(/^\d+[a-zA-Z]?[\s:.-]*\s*/, '')
    .trim();
  return stripped || String(title);
}

function groupEpisodesIntoBlocks(episodes) {
  const blocks = [];
  let currentGroup = null;
  let currentBlock = [];
  for (const episode of episodes) {
    const info = parseEpisodeBlockInfo(episode.title);
    const groupNumber = info ? info.group : episode.episode;
    const hasPart = info?.part != null;
    if (
      currentBlock.length > 0 &&
      hasPart &&
      currentBlock.some((item) => parseEpisodeBlockInfo(item.title)?.part != null) &&
      currentGroup === groupNumber
    ) {
      currentBlock.push(episode);
    } else {
      currentBlock = [episode];
      blocks.push(currentBlock);
      currentGroup = groupNumber;
    }
  }
  return blocks;
}

function flattenShowEpisodes(show) {
  const flat = [];
  for (const season of show.seasons || []) {
    if (!season.episodes || season.episodes.length === 0) continue;
    if (!seasonHasRealContent(season)) continue;
    for (const block of groupEpisodesIntoBlocks(season.episodes)) {
      const firstPart = block[0];
      const totalDuration = block.reduce(
        (sum, part) => sum + parseDurationToSeconds(part.duration),
        0,
      );
      flat.push({
        show,
        season: season.season,
        episode: firstPart.episode,
        episodeTitle:
          block.length > 1
            ? block.map((part) => stripEpisodeBlockCode(part.title)).join(' / ')
            : firstPart.title,
        durationSeconds: totalDuration,
      });
    }
  }
  return flat;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfNextDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
}

function buildFillerEntry(channelIdentifier, channelName, start, end) {
  return {
    id: randomUUID(),
    showId: 'analog-replay-tv-filler',
    showName: 'AnalogReplayTV',
    season: 0,
    episode: 0,
    episodeTitle: 'Identificación de estación',
    channelId: channelIdentifier,
    channelName,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: `${Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))} min`,
    type: 'filler',
  };
}

function buildChannelYearEntries(channel, shows, year) {
  const showStates = shows
    .filter((show) => isShowAssignedToChannel(show, channel) && isShowEligibleForYear(show, year))
    .map((show) => ({
      show,
      episodes: flattenShowEpisodes(show),
      pointer: 0,
      mode: show.episodeAiringMode === 'once-per-day' ? 'once-per-day' : 'daily-repeat',
    }))
    .filter((state) => state.episodes.length > 0);
  if (showStates.length === 0) return [];

  const SLOT_SECONDS = 30 * 60;
  const channelIdentifier = channel.uuid || String(channel.id);
  const entries = [];
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const yearEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  let cursor = new Date(yearStart);
  let currentDayKey = dayKey(cursor);
  let queue = [...showStates];
  const maxIterations = 500000;
  let iterations = 0;

  while (cursor < yearEnd && iterations < maxIterations) {
    iterations += 1;
    const cursorDayKey = dayKey(cursor);
    if (cursorDayKey !== currentDayKey) {
      for (const state of showStates) state.pointer = (state.pointer + 1) % state.episodes.length;
      queue = [...showStates];
      currentDayKey = cursorDayKey;
    }
    if (queue.length === 0) {
      const dayEnd = startOfNextDay(cursor);
      entries.push(buildFillerEntry(channelIdentifier, channel.name, cursor, dayEnd));
      cursor = dayEnd;
      continue;
    }
    const state = queue.shift();
    const flatEpisode = state.episodes[state.pointer % state.episodes.length];
    const occupiedSlots = Math.max(1, Math.ceil(flatEpisode.durationSeconds / SLOT_SECONDS));
    const totalSlotSeconds = occupiedSlots * SLOT_SECONDS;
    const showStart = new Date(cursor);
    const showEnd = new Date(cursor.getTime() + flatEpisode.durationSeconds * 1000);
    entries.push({
      id: randomUUID(),
      showId:
        flatEpisode.show.uuid ||
        (flatEpisode.show.id != null ? String(flatEpisode.show.id) : flatEpisode.show.name),
      showName: flatEpisode.show.name,
      season: flatEpisode.season,
      episode: flatEpisode.episode,
      episodeTitle: flatEpisode.episodeTitle,
      channelId: channelIdentifier,
      channelName: channel.name,
      startTime: showStart.toISOString(),
      endTime: showEnd.toISOString(),
      duration: `${Math.round(flatEpisode.durationSeconds / 60)} min`,
      type: 'show',
    });
    const slotEnd = new Date(cursor.getTime() + totalSlotSeconds * 1000);
    if (slotEnd.getTime() > showEnd.getTime())
      entries.push(buildFillerEntry(channelIdentifier, channel.name, showEnd, slotEnd));
    cursor = slotEnd;
    if (state.mode === 'daily-repeat') queue.push(state);
  }
  return entries;
}

function monthName(month) {
  return MONTH_NAMES[Math.max(0, month - 1)] || 'unknown';
}

function generateYear(year) {
  try {
    const targetYear = Number.isFinite(Number(year)) ? Number(year) : new Date().getFullYear();
    const channels = listChannels().filter((channel) => channel.isEnabled !== false);
    const shows = listShows();
    const allEntries = [];
    for (const channel of channels) {
      allEntries.push(...buildChannelYearEntries(channel, shows, targetYear));
    }
    const generatedMonths = [];
    const monthlySchedules = [];
    for (let month = 1; month <= 12; month++) {
      const monthEntries = allEntries.filter((entry) => {
        const start = new Date(entry.startTime);
        return start.getFullYear() === targetYear && start.getMonth() + 1 === month;
      });
      monthlySchedules.push({
        month,
        schedule: {
          year: targetYear,
          month,
          monthName: monthName(month),
          entries: monthEntries,
          generated: new Date().toISOString(),
          primaryYear: targetYear,
        },
      });
      generatedMonths.push(`${targetYear}-${String(month).padStart(2, '0')}`);
    }
    transaction((handle) => {
      handle.prepare('DELETE FROM schedule_months WHERE year = ?').run(targetYear);
      const insert = handle.prepare(
        'INSERT INTO schedule_months(year, month, generated_at, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(year, month) DO UPDATE SET generated_at = excluded.generated_at, data_json = excluded.data_json',
      );
      for (const { month, schedule } of monthlySchedules) {
        const generatedAt =
          typeof schedule.generated === 'string' ? schedule.generated : new Date().toISOString();
        insert.run(targetYear, month, generatedAt, JSON.stringify(schedule));
      }
    });
    const config = {
      primaryYear: targetYear,
      secondaryYears: [],
      lastGenerated: new Date().toISOString(),
      currentYear: targetYear,
      generatedMonths,
    };
    saveScheduleConfig(config);
    return { success: true, generatedMonths: generatedMonths.length };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function getMonthSchedule(year, month) {
  const row = database()
    .prepare('SELECT data_json FROM schedule_months WHERE year = ? AND month = ?')
    .get(year, month);
  if (row) return JSON.parse(row.data_json);
  const legacyFilePath = path.join(
    analogDir(),
    'schedules',
    String(year),
    `${monthName(month)}-${year}.json`,
  );
  if (fs.existsSync(legacyFilePath)) {
    const legacySchedule = JSON.parse(fs.readFileSync(legacyFilePath, 'utf8'));
    database()
      .prepare(
        'INSERT INTO schedule_months(year, month, generated_at, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(year, month) DO UPDATE SET generated_at = excluded.generated_at, data_json = excluded.data_json',
      )
      .run(
        year,
        month,
        typeof legacySchedule.generated === 'string'
          ? legacySchedule.generated
          : new Date().toISOString(),
        JSON.stringify(legacySchedule),
      );
    return legacySchedule;
  }
  return null;
}

function resetSchedule() {
  try {
    const dir = analogDir();
    const legacyConfig = path.join(dir, 'schedule-config.json');
    const legacySchedules = path.join(dir, 'schedules');
    if (fs.existsSync(legacyConfig)) fs.unlinkSync(legacyConfig);
    if (fs.existsSync(legacySchedules))
      fs.rmSync(legacySchedules, { recursive: true, force: true });
    fs.mkdirSync(legacySchedules, { recursive: true });
    transaction((handle) => {
      handle.exec('DELETE FROM schedule_months; DELETE FROM schedule_config;');
    });
    const config = {
      primaryYear: 0,
      secondaryYears: [],
      lastGenerated: '',
      currentYear: new Date().getFullYear(),
      generatedMonths: [],
    };
    saveScheduleConfig(config);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ===== Carpetas de video =====

function probeDurationSeconds(filePath) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeout: 15000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const seconds = Number.parseFloat(String(stdout).trim());
        resolve(Number.isFinite(seconds) ? seconds : null);
      },
    );
  });
}

function inferEpisodeTitle(file) {
  return path
    .basename(file, path.extname(file))
    .replace(/^[0-9]+[-_.\s]*/g, '')
    .replace(/[-_.]/g, ' ')
    .trim();
}

async function getFolderVideos(folderPath) {
  const absolute = path.resolve(folderPath);
  const files = (await fsp.readdir(absolute))
    .filter((file) => VIDEO_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return Promise.all(
    files.map(async (file, index) => {
      const seconds = await probeDurationSeconds(path.join(absolute, file));
      return {
        episode: index + 1,
        title: inferEpisodeTitle(file),
        duration:
          seconds == null
            ? '00:00'
            : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`,
        fileName: file,
      };
    }),
  );
}

function normalizeFileName(name) {
  return String(name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractEpisodeCode(fileName) {
  const base = String(fileName).replace(/\.[^./\\]+$/, '');
  const match = base.match(/(\d{1,3}[a-zA-Z]?)/);
  return match ? match[1].toLowerCase() : null;
}

async function matchFolderEpisodes(folderPath, episodes) {
  const results = {};
  const list = Array.isArray(episodes) ? episodes : [];
  if (!folderPath || list.length === 0) return results;
  let files;
  try {
    const entries = await fsp.readdir(path.resolve(folderPath), { withFileTypes: true });
    files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return results;
  }
  for (const episode of list) {
    let match = null;
    const candidates = Array.isArray(episode.fileNames) ? episode.fileNames : [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (files.includes(candidate)) {
        match = candidate;
        break;
      }
      const normalized = normalizeFileName(candidate);
      const fuzzy = files.find((file) => normalizeFileName(file) === normalized);
      if (fuzzy) {
        match = fuzzy;
        break;
      }
    }
    if (!match) {
      for (const candidate of candidates) {
        if (!candidate) continue;
        const code = extractEpisodeCode(candidate);
        if (!code) continue;
        const byCode = files.find((file) => extractEpisodeCode(file) === code);
        if (byCode) {
          match = byCode;
          break;
        }
      }
    }
    results[episode.episode] = match;
  }
  return results;
}

module.exports = {
  DB_FILE,
  resolveAnalogDir,
  analogDir,
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  replaceChannels,
  importChannelsFile,
  listShows,
  createShow,
  updateShow,
  deleteShow,
  importShowFile,
  loadScheduleConfig,
  scheduleStatus,
  generateYear,
  getMonthSchedule,
  resetSchedule,
  getFolderVideos,
  matchFolderEpisodes,
  normalizeFileName,
  extractEpisodeCode,
  parseDurationToSeconds,
  parseEpisodeBlockInfo,
  stripEpisodeBlockCode,
  groupEpisodesIntoBlocks,
  flattenShowEpisodes,
  isShowAssignedToChannel,
  isShowEligibleForYear,
};
