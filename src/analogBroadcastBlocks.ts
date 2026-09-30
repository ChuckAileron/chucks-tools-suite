/**
 * Contrato de bloques de emisión por horario para la UI de CHUCK's Tools Suite.
 *
 * NO duplicar los valores ni los límites a mano: la definición canónica vive en
 * `electron/analogBroadcastBlocks.cjs` (y su gemelo en el proyecto
 * AnalogReplayTV, `electron/services/broadcastBlocks.ts`). Este archivo solo
 * expone lo que la UI necesita para pintar las etiquetas y validar el campo.
 */
export type AnalogBroadcastBlock = 'morning' | 'afternoon' | 'night' | 'all';

export const DEFAULT_ANALOG_BROADCAST_BLOCK: AnalogBroadcastBlock = 'all';

export const ANALOG_BROADCAST_BLOCK_VALUES: readonly AnalogBroadcastBlock[] = [
  'morning',
  'afternoon',
  'night',
  'all',
];

export const ANALOG_BROADCAST_BLOCK_LABELS: Record<AnalogBroadcastBlock, string> = {
  morning:   'Mañana (06:00 - 14:00)',
  afternoon: 'Tarde (14:00 - 22:00)',
  night:     'Noche (22:00 - 06:00)',
  all:       'Todo el día (sin restricción)',
};

/** Etiqueta corta para las tarjetas de la lista de programas. */
export const ANALOG_BROADCAST_BLOCK_SHORT_LABELS: Record<AnalogBroadcastBlock, string> = {
  morning:   'Mañana',
  afternoon: 'Tarde',
  night:     'Noche',
  all:       'Todo el día',
};

export function normalizeAnalogBroadcastBlock(value: unknown): AnalogBroadcastBlock {
  if (typeof value !== 'string') return DEFAULT_ANALOG_BROADCAST_BLOCK;
  const candidate = value.trim().toLowerCase();
  return (ANALOG_BROADCAST_BLOCK_VALUES as readonly string[]).includes(candidate)
    ? (candidate as AnalogBroadcastBlock)
    : DEFAULT_ANALOG_BROADCAST_BLOCK;
}
