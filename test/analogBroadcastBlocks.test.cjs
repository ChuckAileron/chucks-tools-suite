const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-broadcast-blocks-test-'));
process.env.ANALOG_REPLAY_TV_USER_DATA = sandbox;

const blocks = require('../electron/analogBroadcastBlocks.cjs');
const analog = require('../electron/analogReplay.cjs');

const at = (h, m = 0) => new Date(2026, 0, 15, h, m, 0, 0);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const mins = (d) => d.getHours() * 60 + d.getMinutes();

// ===== Unidades puras del contrato =====

test('getBroadcastBlockAt resuelve los límites exactos', () => {
  assert.equal(blocks.getBroadcastBlockAt(at(0, 0)), 'night');
  assert.equal(blocks.getBroadcastBlockAt(at(5, 59)), 'night');
  assert.equal(blocks.getBroadcastBlockAt(at(6, 0)), 'morning');
  assert.equal(blocks.getBroadcastBlockAt(at(13, 59)), 'morning');
  assert.equal(blocks.getBroadcastBlockAt(at(14, 0)), 'afternoon');
  assert.equal(blocks.getBroadcastBlockAt(at(21, 59)), 'afternoon');
  assert.equal(blocks.getBroadcastBlockAt(at(22, 0)), 'night');
  assert.equal(blocks.getBroadcastBlockAt(at(23, 59)), 'night');
  for (let h = 0; h < 24; h += 1) {
    assert.ok(['morning', 'afternoon', 'night'].includes(blocks.getBroadcastBlockAt(at(h))));
  }
});

test('getBroadcastBlockEnd cruza medianoche correctamente para night', () => {
  assert.equal(hhmm(blocks.getBroadcastBlockEnd(at(0, 0))), '06:00');
  assert.equal(blocks.getBroadcastBlockEnd(at(0, 0)).getDate(), 15);
  assert.equal(hhmm(blocks.getBroadcastBlockEnd(at(2, 0))), '06:00');
  assert.equal(blocks.getBroadcastBlockEnd(at(2, 0)).getDate(), 15);
  assert.equal(hhmm(blocks.getBroadcastBlockEnd(at(7, 0))), '14:00');
  assert.equal(hhmm(blocks.getBroadcastBlockEnd(at(15, 0))), '22:00');
  assert.equal(hhmm(blocks.getBroadcastBlockEnd(at(23, 0))), '06:00');
  assert.equal(blocks.getBroadcastBlockEnd(at(23, 0)).getDate(), 16, 'debe caer al dia siguiente');
});

test('getRemainingBlockSeconds nunca excede el bloque actual', () => {
  assert.equal(blocks.getRemainingBlockSeconds(at(13, 30)), 30 * 60);
  assert.equal(blocks.getRemainingBlockSeconds(at(6, 0)), 8 * 3600);
  for (let h = 0; h < 24; h += 1) {
    const remaining = blocks.getRemainingBlockSeconds(at(h));
    assert.ok(remaining > 0 && remaining <= 8 * 3600);
  }
});

test('normalizeBroadcastBlock retrocompatible: valores desconocidos/ausentes -> all', () => {
  assert.equal(blocks.normalizeBroadcastBlock(undefined), 'all');
  assert.equal(blocks.normalizeBroadcastBlock(null), 'all');
  assert.equal(blocks.normalizeBroadcastBlock(''), 'all');
  assert.equal(blocks.normalizeBroadcastBlock('bogus'), 'all');
  assert.equal(blocks.normalizeBroadcastBlock(42), 'all');
  assert.equal(blocks.normalizeBroadcastBlock('MORNING'), 'morning');
  assert.equal(blocks.normalizeBroadcastBlock('  Night  '), 'night');
  assert.deepEqual(blocks.BROADCAST_BLOCK_VALUES, ['morning', 'afternoon', 'night', 'all']);
});

test('isBroadcastBlockAllowed: all siempre elegible, los demas solo en su ventana', () => {
  for (let h = 0; h < 24; h += 1) assert.ok(blocks.isBroadcastBlockAllowed('all', at(h)));
  assert.equal(blocks.isBroadcastBlockAllowed('morning', at(7)), true);
  assert.equal(blocks.isBroadcastBlockAllowed('morning', at(15)), false);
  assert.equal(blocks.isBroadcastBlockAllowed('afternoon', at(21, 59)), true);
  assert.equal(blocks.isBroadcastBlockAllowed('afternoon', at(22, 0)), false);
  assert.equal(blocks.isBroadcastBlockAllowed('night', at(2)), true);
  assert.equal(blocks.isBroadcastBlockAllowed('night', at(23)), true);
  assert.equal(blocks.isBroadcastBlockAllowed('night', at(6)), false);
});

// ===== Integración: normalizeShow, generateYear =====

test('createShow/updateShow normalizan y persisten broadcastBlock', () => {
  const created = analog.createShow({
    name: 'Sin bloque',
    channel: ['1'],
    seasons: [{ season: 1, year: 1990, contentPath: sandbox, episodes: [{ episode: 1, title: 'E1', duration: '05:00' }] }],
  });
  assert.equal(created.broadcastBlock, 'all', 'sin campo -> all (retrocompatible)');

  const withBlock = analog.createShow({
    name: 'Con bloque',
    channel: ['1'],
    broadcastBlock: 'MORNING',
    seasons: [{ season: 1, year: 1990, contentPath: sandbox, episodes: [{ episode: 1, title: 'E1', duration: '05:00' }] }],
  });
  assert.equal(withBlock.broadcastBlock, 'morning', 'se normaliza a minusculas');

  const updated = analog.updateShow(withBlock.id, { broadcastBlock: 'bogus' });
  assert.equal(updated.broadcastBlock, 'all', 'valor invalido en update cae a all');

  analog.deleteShow(created.id);
  analog.deleteShow(withBlock.id);
});

test('generateYear: los programas restringidos no cruzan su bloque y "all" no cambia', () => {
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-broadcast-content-'));
  analog.replaceChannels([{ id: 1, uuid: 'canal-bloques', name: 'Canal Bloques', number: 900, isEnabled: true }]);

  const makeShow = (name, broadcastBlock, duration, episodeAiringMode) =>
    analog.createShow({
      name,
      channel: ['Canal Bloques'],
      ...(broadcastBlock !== undefined ? { broadcastBlock } : {}),
      episodeAiringMode,
      seasons: [
        {
          season: 1,
          year: 1990,
          contentPath: contentDir,
          episodes: [{ episode: 1, title: 'E1', duration }],
        },
      ],
    });

  makeShow('Manana', 'morning', '30:00', 'daily-repeat');
  makeShow('Tarde', 'afternoon', '30:00', 'daily-repeat');
  makeShow('Noche', 'night', '30:00', 'daily-repeat');
  makeShow('Larga', 'morning', '180:00', 'daily-repeat'); // 3h: no cabe al final del bloque
  makeShow('TodoDia', 'all', '30:00', 'once-per-day');
  makeShow('Legacy', undefined, '05:00', 'daily-repeat'); // sin campo -> 'all'

  const result = analog.generateYear(2026);
  assert.equal(result.success, true, result.error);

  const month = analog.getMonthSchedule(2026, 1);
  assert.ok(month && month.entries.length > 0);

  const entries = month.entries
    .filter((entry) => new Date(entry.startTime).getDate() === 15 && new Date(entry.startTime).getMonth() === 0)
    .map((entry) => ({ ...entry, s: new Date(entry.startTime), e: new Date(entry.endTime) }))
    .sort((a, b) => a.s - b.s);

  // Día cubierto sin huecos ni solapes, de 00:00 a 24:00.
  assert.equal(mins(entries[0].s), 0);
  assert.equal(entries[entries.length - 1].e.getDate(), 16);
  assert.equal(mins(entries[entries.length - 1].e), 0);
  for (let i = 1; i < entries.length; i += 1) {
    assert.equal(entries[i].s.getTime(), entries[i - 1].e.getTime(), `hueco/solape antes de ${entries[i].showName}`);
  }

  const showEntries = entries.filter((entry) => entry.type === 'show');
  const ranges = { Manana: [360, 840], Larga: [360, 840], Tarde: [840, 1320] };
  for (const entry of showEntries) {
    if (ranges[entry.showName]) {
      const [from, to] = ranges[entry.showName];
      assert.ok(mins(entry.s) >= from && mins(entry.s) < to, `${entry.showName} empieza fuera de su bloque`);
      assert.ok(mins(entry.e) <= to, `${entry.showName} cruza el limite de su bloque`);
    }
    if (entry.showName === 'Noche') {
      const s = mins(entry.s);
      const e = mins(entry.e);
      assert.ok(s >= 1320 || s < 360, 'Noche empieza fuera de su bloque');
      assert.ok(e <= 360 || (s >= 1320 && e <= 1440), 'Noche cruza el limite 06:00');
    }
    if (entry.showName === 'Larga') {
      assert.equal((entry.e - entry.s) / 60000, 180, 'Larga nunca debe truncarse');
    }
  }

  // 'TodoDia' (once-per-day + all) aparece exactamente una vez en el día.
  assert.equal(showEntries.filter((entry) => entry.showName === 'TodoDia').length, 1);
  // 'Legacy' (sin campo -> all) se repite igual que antes de existir broadcastBlock.
  assert.ok(showEntries.filter((entry) => entry.showName === 'Legacy').length > 1);
  // Todos los shows configurados deben aparecer en algún momento del día.
  const names = new Set(showEntries.map((entry) => entry.showName));
  for (const expected of ['Manana', 'Tarde', 'Noche', 'Larga', 'TodoDia', 'Legacy']) {
    assert.ok(names.has(expected), `falta ${expected} en la programación generada`);
  }

  fs.rmSync(contentDir, { recursive: true, force: true });
});
