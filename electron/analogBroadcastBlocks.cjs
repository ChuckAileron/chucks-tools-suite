/**
 * CONTRATO CANÓNICO de los bloques de emisión por horario.
 *
 * Este módulo es la fuente de verdad del lado de CHUCK's Tools Suite y debe
 * mantenerse idéntico a `electron/services/broadcastBlocks.ts` en el proyecto
 * AnalogReplayTV (la app que reproduce). Ambos proyectos guardan/leen la misma
 * base `analog-replay-tv.sqlite`, así que cualquier divergencia aquí produce
 * programación distinta a la que ve el usuario.
 *
 *   - `morning`   06:00 (inclusive) .. 14:00 (exclusive)
 *   - `afternoon` 14:00 (inclusive) .. 22:00 (exclusive)
 *   - `night`     22:00 (inclusive) .. 06:00 (exclusive)  -> cruza medianoche
 *   - `all`       elegible en cualquier momento (sin restricción de horario)
 *
 * Todos los límites se evalúan en hora local, igual que la programación
 * generada, de modo que el round-trip a ISO conserva el mismo bloque.
 *
 * Módulo puro: sin dependencias de Node ni de Electron.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const DEFAULT_BROADCAST_BLOCK = 'all';

const BROADCAST_BLOCKS = [
  { id: 'morning', label: 'Mañana (06:00 - 14:00)', startMinutes: 6 * MINUTES_PER_HOUR, endMinutes: 14 * MINUTES_PER_HOUR },
  { id: 'afternoon', label: 'Tarde (14:00 - 22:00)', startMinutes: 14 * MINUTES_PER_HOUR, endMinutes: 22 * MINUTES_PER_HOUR },
  { id: 'night', label: 'Noche (22:00 - 06:00)', startMinutes: 22 * MINUTES_PER_HOUR, endMinutes: 6 * MINUTES_PER_HOUR },
];

const BROADCAST_BLOCK_VALUES = ['morning', 'afternoon', 'night', 'all'];

const BROADCAST_BLOCK_LABELS = {
  morning: 'Mañana (06:00 - 14:00)',
  afternoon: 'Tarde (14:00 - 22:00)',
  night: 'Noche (22:00 - 06:00)',
  all: 'Todo el día (sin restricción)',
};

/**
 * Normaliza cualquier valorproveniente de la configuración (incluidos datos
 * viejos o mal escritos) a un bloque válido. Ante un valor desconocido devuelve
 * `all`, que es el comportamiento previo a esta funcionalidad.
 */
function normalizeBroadcastBlock(value) {
  if (typeof value !== 'string') return DEFAULT_BROADCAST_BLOCK;
  const candidate = value.trim().toLowerCase();
  return BROADCAST_BLOCK_VALUES.includes(candidate) ? candidate : DEFAULT_BROADCAST_BLOCK;
}

function isWithinBlock(block, minutes) {
  if (block.startMinutes < block.endMinutes) {
    return minutes >= block.startMinutes && minutes < block.endMinutes;
  }
  // Bloque que cruza la medianoche.
  return minutes >= block.startMinutes || minutes < block.endMinutes;
}

function getBroadcastBlockDefinition(id) {
  const found = BROADCAST_BLOCKS.find((block) => block.id === id);
  if (!found) throw new Error(`Bloque de emisión desconocido: ${id}`);
  return found;
}

/** Devuelve el bloque concreto (sin `all`) en el que cae la hora local dada. */
function getBroadcastBlockAt(date) {
  const minutes = date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
  for (const block of BROADCAST_BLOCKS) {
    if (isWithinBlock(block, minutes)) return block.id;
  }
  // Los bloques cubren el día completo; `morning` es un ancla de seguridad.
  return 'morning';
}

/**
 * Instante exacto en el que termina el bloque que contiene a `date`
 * (es decir, el inicio del bloque siguiente).
 */
function getBroadcastBlockEnd(date) {
  const definition = getBroadcastBlockDefinition(getBroadcastBlockAt(date));
  const minutes = date.getHours() * MINUTES_PER_HOUR + date.getMinutes();

  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  // Si el bloque cruza medianoche y ya pasamos su inicio, el final cae al día
  // siguiente (23:00 -> 06:00 de mañana); si todavía estamos en la parte
  // post-medianoche, el final es el mismo día (02:00 -> 06:00 de hoy).
  const crossesMidnight = definition.endMinutes <= definition.startMinutes;
  const dayOffset = crossesMidnight && minutes >= definition.startMinutes ? MINUTES_PER_DAY : 0;
  end.setMinutes(end.getMinutes() + definition.endMinutes + dayOffset);
  return end;
}

/** Segundos que quedan hasta el fin del bloque actual. */
function getRemainingBlockSeconds(date) {
  return Math.max(0, (getBroadcastBlockEnd(date).getTime() - date.getTime()) / 1000);
}

/**
 * Indica si un show puede emitirse a la hora dada según su bloque configurado.
 * `all` (o cualquier valor inválido, ya normalizado) siempre es elegible.
 */
function isBroadcastBlockAllowed(showBlock, at) {
  const normalized = normalizeBroadcastBlock(showBlock);
  return normalized === 'all' || normalized === getBroadcastBlockAt(at);
}

module.exports = {
  DEFAULT_BROADCAST_BLOCK,
  BROADCAST_BLOCKS,
  BROADCAST_BLOCK_VALUES,
  BROADCAST_BLOCK_LABELS,
  normalizeBroadcastBlock,
  getBroadcastBlockAt,
  getBroadcastBlockEnd,
  getRemainingBlockSeconds,
  isBroadcastBlockAllowed,
};
