const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// --- Categorización de archivos -----------------------------------------
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  'ts',
  'mts',
  'm2ts',
  'vob',
  'ogv',
  '3gp',
  '3g2',
  'asf',
]);
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'tiff',
  'tif',
  'heic',
  'svg',
]);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus']);
const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'csv',
  'rtf',
  'odt',
  'odp',
  'ods',
]);
// Carpetas de sistema que no aportan valor al inventario y pueden bloquear
// la lectura por permisos; se omiten al recorrer el disco.
const SKIP_NAMES = new Set([
  'System Volume Information',
  '$RECYCLE.BIN',
  '.Trashes',
  '.Spotlight-V100',
  '.fseventsd',
  '.Trash-1000',
]);
const THUMBNAIL_SIZE = 240;

function extensionOf(name) {
  const ext = path.extname(name);
  return ext ? ext.slice(1).toLowerCase() : '';
}
function categorize(name, isDirectory) {
  if (isDirectory) return 'folder';
  const ext = extensionOf(name);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return 'other';
}
const isMediaCategory = (category) =>
  category === 'video' || category === 'image' || category === 'audio';
const supportsThumbnail = (category) =>
  category === 'video' || category === 'image' || category === 'document';

// --- Rutas relativas (independientes de la letra de unidad) -------------
function toPosixRelative(rootAbsolute, targetAbsolute) {
  const relative = path.relative(rootAbsolute, targetAbsolute);
  return relative.split(path.sep).join('/');
}
function splitRelative(relativePath) {
  const idx = relativePath.lastIndexOf('/');
  return idx === -1
    ? { parentPath: '', name: relativePath }
    : { parentPath: relativePath.slice(0, idx), name: relativePath.slice(idx + 1) };
}
function joinRelative(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}
function driveRootFromPath(selectedPath) {
  return path.parse(path.resolve(selectedPath)).root;
}
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// --- Detección de volúmenes conectados -----------------------------------
// Se busca un identificador estable por volumen (no ligado a la letra de
// unidad) para reconocer un HDD aunque el sistema operativo le asigne otra
// letra (D:, E:, F:, ...) en una conexión posterior.
async function listSystemVolumes() {
  if (process.platform === 'win32') {
    try {
      const output = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { [PSCustomObject]@{ DriveLetter = $_.DriveLetter; UniqueId = $_.UniqueId; Label = $_.FileSystemLabel; Size = $_.Size } } | ConvertTo-Json -Compress',
        ],
        { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      );
      const trimmed = String(output || '').trim();
      if (!trimmed) return [];
      const parsed = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .filter((row) => row && row.DriveLetter)
        .map((row) => ({
          mountPoint: `${row.DriveLetter}:\\`,
          volumeId: row.UniqueId || null,
          label: row.Label || '',
          totalBytes: Number(row.Size) || 0,
        }));
    } catch {
      return [];
    }
  }
  // macOS/Linux: listado best-effort. No hay un identificador de volumen
  // universal disponible sin dependencias adicionales, así que la
  // reconexión se valida por ruta de montaje cuando falta un volumeId.
  try {
    const output = execFileSync('df', ['-P', '-k'], { timeout: 15000, encoding: 'utf8' });
    return output
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 6 && parts[5].startsWith('/'))
      .map((parts) => ({
        mountPoint: parts[5],
        volumeId: null,
        label: parts[0],
        totalBytes: Number(parts[1]) * 1024 || 0,
      }));
  } catch {
    return [];
  }
}

// Decide si un HDD registrado está conectado actualmente y bajo qué punto
// de montaje, comparando primero por identificador estable de volumen y,
// si no existe, por la última ruta de montaje conocida.
function resolveConnection(drive, volumes) {
  let matched = null;
  if (drive.volumeId) matched = volumes.find((v) => v.volumeId && v.volumeId === drive.volumeId);
  if (!matched && drive.lastMountPoint) {
    matched = volumes.find(
      (v) => path.resolve(v.mountPoint) === path.resolve(drive.lastMountPoint),
    );
  }
  return matched
    ? { connected: true, mountPoint: matched.mountPoint, volume: matched }
    : { connected: false, mountPoint: drive.lastMountPoint || '', volume: null };
}

// --- ffprobe / ffmpeg -----------------------------------------------------
const run = (command, args, options = {}) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { maxBuffer: 1024 * 1024 * 16, ...options }, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, { stdout, stderr })) : resolve(stdout),
    ),
  );

// Extrae propiedades técnicas de un archivo multimedia (contenedor, pistas,
// resolución, códecs, bitrate, etc.), de forma similar a MediaInfo.
async function probeMedia(absolutePath) {
  try {
    const output = await run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      absolutePath,
    ]);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function probeDuration(absolutePath) {
  try {
    const output = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      absolutePath,
    ]);
    const value = Number(String(output).trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

// Genera y guarda una miniatura para fotos, videos y documentos. Los
// documentos sin un renderizador disponible reciben un marcador genérico
// con la extensión, generado también con ffmpeg (sin dependencias nuevas).
async function generateThumbnail({ absolutePath, destPath, category, extension }) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const scale = `scale='min(${THUMBNAIL_SIZE},iw)':'-2'`;
  if (category === 'image') {
    await run('ffmpeg', ['-y', '-i', absolutePath, '-vf', scale, '-frames:v', '1', destPath]);
    return true;
  }
  if (category === 'video') {
    const duration = await probeDuration(absolutePath);
    const seek = duration > 2 ? Math.min(duration * 0.1, 30) : 0;
    try {
      await run('ffmpeg', [
        '-y',
        '-ss',
        String(seek),
        '-i',
        absolutePath,
        '-vf',
        scale,
        '-frames:v',
        '1',
        destPath,
      ]);
      return true;
    } catch {
      // Algunos códecs/contenedores fallan al buscar; se reintenta desde el inicio.
      await run('ffmpeg', ['-y', '-i', absolutePath, '-vf', scale, '-frames:v', '1', destPath]);
      return true;
    }
  }
  if (category === 'document') {
    if (extension === 'pdf') {
      try {
        const prefix = destPath.replace(/\.jpg$/i, '');
        await run('pdftoppm', [
          '-jpeg',
          '-f',
          '1',
          '-l',
          '1',
          '-scale-to',
          String(THUMBNAIL_SIZE),
          absolutePath,
          prefix,
        ]);
        const generated = `${prefix}-1.jpg`;
        if (fs.existsSync(generated)) {
          await fsp.rename(generated, destPath);
          return true;
        }
      } catch {
        // poppler-utils (pdftoppm) no disponible; se usa el marcador genérico.
      }
    }
    const label = (extension || 'doc').slice(0, 4).toUpperCase();
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x2f8f5b:s=${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}`,
      '-vf',
      `drawtext=text='${label}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2`,
      '-frames:v',
      '1',
      destPath,
    ]);
    return true;
  }
  return false;
}

// --- Persistencia SQLite --------------------------------------------------
class HddInventoryManager {
  constructor(dbPath, thumbnailsDir) {
    this.thumbnailsDir = thumbnailsDir;
    fs.mkdirSync(thumbnailsDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS hdd_drives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        label TEXT NOT NULL DEFAULT '',
        volume_id TEXT,
        volume_label TEXT NOT NULL DEFAULT '',
        total_bytes INTEGER NOT NULL DEFAULT 0,
        last_mount_point TEXT NOT NULL DEFAULT '',
        last_scanned_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS hdd_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drive_id INTEGER NOT NULL REFERENCES hdd_drives(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        parent_path TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        is_directory INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'other',
        extension TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        modified_at TEXT,
        media_properties_json TEXT NOT NULL DEFAULT '{}',
        thumbnail_path TEXT,
        thumbnail_source_mtime TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(drive_id, relative_path)
      );
      CREATE INDEX IF NOT EXISTS idx_hdd_entries_drive ON hdd_entries(drive_id);
      CREATE INDEX IF NOT EXISTS idx_hdd_entries_parent ON hdd_entries(drive_id, parent_path);
    `);
  }

  close() {
    this.db.close();
  }

  mapDrive(row) {
    return row
      ? {
          id: Number(row.id),
          code: row.code,
          label: row.label,
          volumeId: row.volume_id,
          volumeLabel: row.volume_label,
          totalBytes: Number(row.total_bytes),
          lastMountPoint: row.last_mount_point,
          lastScannedAt: row.last_scanned_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }
  mapEntry(row) {
    return row
      ? {
          id: Number(row.id),
          driveId: Number(row.drive_id),
          relativePath: row.relative_path,
          parentPath: row.parent_path,
          name: row.name,
          isDirectory: !!row.is_directory,
          category: row.category,
          extension: row.extension,
          size: Number(row.size),
          modifiedAt: row.modified_at,
          mediaProperties: JSON.parse(row.media_properties_json || '{}'),
          hasThumbnail: !!row.thumbnail_path,
          thumbnailPath: row.thumbnail_path,
          thumbnailSourceMtime: row.thumbnail_source_mtime,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  listDrives() {
    return this.db
      .prepare('SELECT * FROM hdd_drives ORDER BY code COLLATE NOCASE')
      .all()
      .map((row) => this.mapDrive(row));
  }
  getDrive(id) {
    return this.mapDrive(this.db.prepare('SELECT * FROM hdd_drives WHERE id = ?').get(id));
  }
  registerDrive({
    code,
    label = '',
    volumeId = null,
    volumeLabel = '',
    totalBytes = 0,
    mountPoint = '',
  }) {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) throw new Error('El identificador del HDD es obligatorio.');
    if (!/^[\w.-]+$/.test(normalizedCode))
      throw new Error(
        'El identificador solo admite letras, números, puntos, guiones y guión bajo.',
      );
    try {
      const result = this.db
        .prepare(
          `INSERT INTO hdd_drives (code, label, volume_id, volume_label, total_bytes, last_mount_point)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          normalizedCode,
          String(label),
          volumeId,
          String(volumeLabel),
          Number(totalBytes) || 0,
          String(mountPoint),
        );
      return this.getDrive(Number(result.lastInsertRowid));
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE/i.test(error.message))
        throw new Error(`Ya existe un HDD registrado con el identificador "${normalizedCode}".`);
      throw error;
    }
  }
  updateDrive(id, patch) {
    const current = this.getDrive(id);
    if (!current) throw new Error('El HDD no existe.');
    const code = String(patch.code ?? current.code).trim();
    const label = String(patch.label ?? current.label);
    if (!code) throw new Error('El identificador del HDD es obligatorio.');
    if (!/^[\w.-]+$/.test(code))
      throw new Error(
        'El identificador solo admite letras, números, puntos, guiones y guión bajo.',
      );
    try {
      this.db
        .prepare(
          `UPDATE hdd_drives SET code = ?, label = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(code, label, id);
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE/i.test(error.message))
        throw new Error(`Ya existe un HDD registrado con el identificador "${code}".`);
      throw error;
    }
    return this.getDrive(id);
  }
  touchDriveConnection(id, { volumeId, volumeLabel, totalBytes, mountPoint }) {
    this.db
      .prepare(
        `UPDATE hdd_drives SET volume_id = COALESCE(?, volume_id), volume_label = ?, total_bytes = ?,
         last_mount_point = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        volumeId ?? null,
        String(volumeLabel || ''),
        Number(totalBytes) || 0,
        String(mountPoint || ''),
        id,
      );
  }
  markScanned(id) {
    this.db.prepare(`UPDATE hdd_drives SET last_scanned_at = datetime('now') WHERE id = ?`).run(id);
  }
  deleteDrive(id) {
    return Number(this.db.prepare('DELETE FROM hdd_drives WHERE id = ?').run(id).changes) > 0;
  }
  countEntries(driveId) {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM hdd_entries WHERE drive_id = ? AND is_directory = 0',
      )
      .get(driveId);
    return { files: Number(row.n), bytes: Number(row.bytes) };
  }
  listEntries(driveId, parentPath = '') {
    return this.db
      .prepare(
        `SELECT * FROM hdd_entries WHERE drive_id = ? AND parent_path = ?
         ORDER BY is_directory DESC, name COLLATE NOCASE`,
      )
      .all(driveId, parentPath)
      .map((row) => this.mapEntry(row));
  }
  getEntry(id) {
    return this.mapEntry(this.db.prepare('SELECT * FROM hdd_entries WHERE id = ?').get(id));
  }
  getEntryByPath(driveId, relativePath) {
    return this.mapEntry(
      this.db
        .prepare('SELECT * FROM hdd_entries WHERE drive_id = ? AND relative_path = ?')
        .get(driveId, relativePath),
    );
  }
  searchEntries(driveId, query) {
    const like = `%${escapeLike(String(query || '').trim())}%`;
    return this.db
      .prepare(
        `SELECT * FROM hdd_entries WHERE drive_id = ? AND name LIKE ? ESCAPE '\\'
         ORDER BY is_directory DESC, name COLLATE NOCASE LIMIT 200`,
      )
      .all(driveId, like)
      .map((row) => this.mapEntry(row));
  }

  // --- Escaneo -------------------------------------------------------------
  upsertEntry(driveId, entry) {
    const existing = this.getEntryByPath(driveId, entry.relativePath);
    if (existing) {
      this.db
        .prepare(
          `UPDATE hdd_entries SET name = ?, parent_path = ?, is_directory = ?, category = ?, extension = ?,
           size = ?, modified_at = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(
          entry.name,
          entry.parentPath,
          entry.isDirectory ? 1 : 0,
          entry.category,
          entry.extension,
          entry.size,
          entry.modifiedAt,
          existing.id,
        );
      return this.getEntry(existing.id);
    }
    const result = this.db
      .prepare(
        `INSERT INTO hdd_entries (drive_id, relative_path, parent_path, name, is_directory, category, extension, size, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        driveId,
        entry.relativePath,
        entry.parentPath,
        entry.name,
        entry.isDirectory ? 1 : 0,
        entry.category,
        entry.extension,
        entry.size,
        entry.modifiedAt,
      );
    return this.getEntry(Number(result.lastInsertRowid));
  }
  setThumbnail(entryId, thumbnailPath, sourceMtime) {
    this.db
      .prepare(
        `UPDATE hdd_entries SET thumbnail_path = ?, thumbnail_source_mtime = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(thumbnailPath, sourceMtime, entryId);
  }
  setMediaProperties(entryId, properties) {
    this.db
      .prepare(
        `UPDATE hdd_entries SET media_properties_json = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(JSON.stringify(properties || {}), entryId);
  }
  deleteEntriesNotIn(driveId, keepPaths) {
    const all = this.db
      .prepare('SELECT id, relative_path FROM hdd_entries WHERE drive_id = ?')
      .all(driveId);
    const stale = all.filter((row) => !keepPaths.has(row.relative_path));
    if (!stale.length) return 0;
    this.db.exec('BEGIN');
    try {
      const stmt = this.db.prepare('DELETE FROM hdd_entries WHERE id = ?');
      for (const row of stale) stmt.run(row.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return stale.length;
  }
  getThumbnailFile(entryId) {
    const entry = this.getEntry(entryId);
    return entry?.thumbnailPath || null;
  }

  // --- Renombrado ------------------------------------------------------------
  descendantsOf(driveId, relativePath) {
    const prefix = `${escapeLike(relativePath)}/`;
    return this.db
      .prepare(`SELECT * FROM hdd_entries WHERE drive_id = ? AND relative_path LIKE ? ESCAPE '\\'`)
      .all(driveId, `${prefix}%`)
      .map((row) => this.mapEntry(row));
  }
  renameEntryInDb(driveId, entryId, newName) {
    const entry = this.getEntry(entryId);
    if (!entry || entry.driveId !== driveId) throw new Error('El elemento no existe en este HDD.');
    const trimmed = String(newName || '').trim();
    if (!trimmed || /[\\/]/.test(trimmed))
      throw new Error('El nombre no puede estar vacío ni contener separadores de ruta.');
    const oldRelative = entry.relativePath;
    const newRelative = joinRelative(entry.parentPath, trimmed);
    if (newRelative === oldRelative) return { entry, affected: 0 };
    if (this.getEntryByPath(driveId, newRelative))
      throw new Error(`Ya existe "${trimmed}" en esa carpeta.`);
    const descendants = entry.isDirectory ? this.descendantsOf(driveId, oldRelative) : [];
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `UPDATE hdd_entries SET name = ?, relative_path = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(trimmed, newRelative, entryId);
      const updateStmt = this.db.prepare(
        `UPDATE hdd_entries SET relative_path = ?, parent_path = ? WHERE id = ?`,
      );
      for (const descendant of descendants) {
        const rest = descendant.relativePath.slice(oldRelative.length); // conserva la barra inicial
        const updatedRelative = `${newRelative}${rest}`;
        const updatedParent =
          descendant.parentPath === oldRelative
            ? newRelative
            : descendant.parentPath.startsWith(`${oldRelative}/`)
              ? `${newRelative}${descendant.parentPath.slice(oldRelative.length)}`
              : descendant.parentPath;
        updateStmt.run(updatedRelative, updatedParent, descendant.id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { entry: this.getEntry(entryId), affected: descendants.length };
  }
}

// --- Recorrido del disco ---------------------------------------------------
// Cataloga recursivamente el contenido de `mountPoint`, actualizando la base
// de datos y regenerando miniaturas/propiedades técnicas cuando el archivo
// cambió (por fecha de modificación) o nunca se procesó. Si se cancela a
// mitad de camino, no se eliminan las filas restantes: se asume que el
// recorrido está incompleto y no refleja el estado real del disco todavía.
async function scanDrive({ manager, driveId, mountPoint, onProgress, isCancelled }) {
  const thumbsRoot = path.join(manager.thumbnailsDir, String(driveId));
  const seen = new Set();
  let processed = 0;
  let thumbnails = 0;
  const stack = [{ absolute: mountPoint, relative: '' }];
  while (stack.length) {
    if (isCancelled()) break;
    const current = stack.pop();
    let dirents;
    try {
      dirents = await fsp.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (isCancelled()) break;
      if (SKIP_NAMES.has(dirent.name)) continue;
      const absolute = path.join(current.absolute, dirent.name);
      const relative = joinRelative(current.relative, dirent.name);
      let stats;
      try {
        stats = await fsp.lstat(absolute);
      } catch {
        continue;
      }
      const isDirectory = stats.isDirectory();
      const isFile = stats.isFile();
      if (!isDirectory && !isFile) continue; // symlinks/dispositivos se omiten
      const category = categorize(dirent.name, isDirectory);
      const modifiedAt = stats.mtime.toISOString();
      const saved = manager.upsertEntry(driveId, {
        relativePath: relative,
        parentPath: current.relative,
        name: dirent.name,
        isDirectory,
        category,
        extension: isDirectory ? '' : extensionOf(dirent.name),
        size: isFile ? stats.size : 0,
        modifiedAt,
      });
      seen.add(relative);
      processed += 1;
      if (onProgress) onProgress({ processed, thumbnails, current: relative });
      if (isDirectory) {
        stack.push({ absolute, relative });
        continue;
      }
      if (supportsThumbnail(category)) {
        const needsThumbnail = !saved.thumbnailPath || saved.thumbnailSourceMtime !== modifiedAt;
        if (needsThumbnail) {
          const destPath = path.join(thumbsRoot, `${saved.id}.jpg`);
          try {
            const ok = await generateThumbnail({
              absolutePath: absolute,
              destPath,
              category,
              extension: saved.extension,
            });
            if (ok) {
              manager.setThumbnail(saved.id, destPath, modifiedAt);
              thumbnails += 1;
              if (onProgress) onProgress({ processed, thumbnails, current: relative });
            }
          } catch {
            // Falla no crítica: el archivo se cataloga igual sin miniatura.
          }
        }
      }
      if (isMediaCategory(category)) {
        try {
          const probed = await probeMedia(absolute);
          if (probed) manager.setMediaProperties(saved.id, probed);
        } catch {
          // Sin ffprobe disponible u otro fallo; se conserva el catálogo igual.
        }
      }
    }
  }
  const cancelled = isCancelled();
  if (!cancelled) {
    manager.deleteEntriesNotIn(driveId, seen);
    manager.markScanned(driveId);
  }
  return { processed, thumbnails, cancelled };
}

module.exports = {
  HddInventoryManager,
  categorize,
  extensionOf,
  toPosixRelative,
  splitRelative,
  joinRelative,
  driveRootFromPath,
  listSystemVolumes,
  resolveConnection,
  scanDrive,
  probeMedia,
  probeDuration,
  generateThumbnail,
  isMediaCategory,
  supportsThumbnail,
};
