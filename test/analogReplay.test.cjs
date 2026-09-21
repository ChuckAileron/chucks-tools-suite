const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installHooks, restoreHooks } = require('./helpers/moduleHooks.cjs');
const { DatabaseSync: RealDatabaseSync } = require('node:sqlite');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-replay-test-'));
process.env.ANALOG_REPLAY_TV_USER_DATA = sandbox;

const analog = require('../electron/analogReplay.cjs');

test('resuelve el directorio real de AnalogReplayTV o el override', () => {
  assert.equal(analog.resolveAnalogDir(), sandbox);
  assert.equal(analog.analogDir(), sandbox);
  assert.ok(fs.existsSync(path.join(sandbox, 'analog-replay-tv.sqlite')));
});

test('canales: crear, listar, actualizar y eliminar', () => {
  const created = analog.createChannel({ name: 'Nick', number: 7, description: 'Infantil' });
  assert.equal(created.name, 'Nick');
  assert.equal(created.number, 7);
  assert.equal(created.isEnabled, true);
  assert.ok(created.uuid);
  assert.equal(analog.listChannels().length, 1);

  assert.throws(
    () => analog.createChannel({ name: 'Otro', number: 7 }),
    /ya está en uso por «Nick»/,
  );
  assert.throws(() => analog.createChannel({ name: '', number: 8 }), /nombre/);
  assert.throws(() => analog.createChannel({ name: 'X', number: 1000 }), /entre 1 y 999/);

  const updated = analog.updateChannel(created.id, { name: 'Nickelodeon', isEnabled: false });
  assert.equal(updated.name, 'Nickelodeon');
  assert.equal(updated.isEnabled, false);
  assert.equal(analog.updateChannel(created.uuid, { isEnabled: true }).isEnabled, true);

  assert.equal(analog.deleteChannel(99999), false);
  assert.equal(analog.deleteChannel(created.id), true);
  assert.equal(analog.listChannels().length, 0);
});

test('canales: importar reemplaza la lista desde un JSON', () => {
  const file = path.join(sandbox, 'channels.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ channels: [{ id: 1, name: 'Canal 1', number: 1, isEnabled: true }] }),
  );
  assert.equal(analog.importChannelsFile(file), 1);
  assert.equal(analog.listChannels()[0].name, 'Canal 1');
  assert.throws(() => analog.importChannelsFile(path.join(sandbox, 'no-existe.json')), Error);
});

test('programas: crear, actualizar, eliminar y normalizar', () => {
  const created = analog.createShow({
    name: 'Show',
    channel: ['Nickelodeon'],
    seasons: [
      {
        season: 1,
        year: 1999,
        episodes: [{ episode: 1, title: '01a Piloto', duration: '11:00' }],
        contentPath: '',
      },
    ],
  });
  assert.equal(created.episodeAiringMode, 'daily-repeat');
  assert.deepEqual(created.airYears, []);
  assert.equal(analog.listShows().length, 1);

  const updated = analog.updateShow(created.id, {
    episodeAiringMode: 'once-per-day',
    airYears: [1999],
  });
  assert.equal(updated.episodeAiringMode, 'once-per-day');
  assert.deepEqual(updated.airYears, [1999]);

  assert.throws(() => analog.createShow({ name: '', channel: [], seasons: [] }), /nombre/);
  assert.equal(analog.deleteShow(created.id), true);
  assert.equal(analog.listShows().length, 0);
});

test('programas: importar acepta show único o lista', () => {
  const single = path.join(sandbox, 'show.json');
  fs.writeFileSync(
    single,
    JSON.stringify({ name: 'Unitario', channel: [], seasons: [], airYears: [] }),
  );
  assert.equal(analog.importShowFile(single).length, 1);
  const many = path.join(sandbox, 'shows.json');
  fs.writeFileSync(
    many,
    JSON.stringify({ shows: [{ name: 'A', channel: [], seasons: [] }, { name: 'B' }] }),
  );
  assert.equal(analog.importShowFile(many).length, 1);
  assert.throws(() => analog.importShowFile(single.replace('show.json', 'bad.json')), Error);
});

test('utilidades puras de programación', () => {
  assert.equal(analog.parseDurationToSeconds('11:30'), 690);
  assert.equal(analog.parseDurationToSeconds('01:02:03'), 3723);
  assert.equal(analog.parseDurationToSeconds('invalido'), 300);
  assert.equal(analog.parseDurationToSeconds(''), 300);
  assert.deepEqual(analog.parseEpisodeBlockInfo('01a: Piloto'), { group: 1, part: 'a' });
  assert.equal(analog.parseEpisodeBlockInfo('Sin codigo'), null);
  assert.equal(analog.stripEpisodeBlockCode('01a: Piloto'), 'Piloto');
  assert.equal(analog.normalizeFileName('  Bob   ESPONJA.MKV '), 'bob esponja.mkv');
  assert.equal(analog.extractEpisodeCode('Bob Esponja - 01a - Ayuda (1080p).mkv'), '01a');
  assert.equal(analog.extractEpisodeCode('sin-numeros.mkv'), null);
  assert.equal(analog.isShowEligibleForYear({ airYears: [1996] }, 1999), true);
  assert.equal(analog.isShowEligibleForYear({ airYears: [2005] }, 1999), false);
  assert.equal(analog.isShowEligibleForYear({ airUntilToDate: true }, 2030), true);
  assert.equal(analog.isShowEligibleForYear({}, 1999), true);
  assert.equal(
    analog.isShowAssignedToChannel({ channel: ['nick'] }, { id: 1, uuid: 'u', name: 'Nick' }),
    true,
  );
  assert.equal(
    analog.isShowAssignedToChannel({ channel: ['otro'] }, { id: 1, uuid: 'u', name: 'Nick' }),
    false,
  );
});

test('bloques multi-parte se agrupan y aplanan con duración sumada', () => {
  const show = {
    name: 'Serie',
    channel: [],
    seasons: [
      {
        season: 1,
        year: 1999,
        contentPath: sandbox,
        episodes: [
          { episode: 1, title: '01a Parte uno', duration: '11:00' },
          { episode: 2, title: '01b Parte dos', duration: '11:00' },
          { episode: 3, title: '02 Suelto', duration: '22:00' },
        ],
      },
    ],
  };
  const blocks = analog.groupEpisodesIntoBlocks(show.seasons[0].episodes);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].length, 2);
  const flat = analog.flattenShowEpisodes(show);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].durationSeconds, 1320);
  assert.equal(flat[0].episodeTitle, 'Parte uno / Parte dos');
});

test('programación: generar año, consultar mes y resetear', () => {
  analog.replaceChannels([{ id: 1, uuid: 'canal-1', name: 'Nick', number: 7, isEnabled: true }]);
  analog.createShow({
    name: 'Serie Diaria',
    channel: ['Nick'],
    seasons: [
      {
        season: 1,
        year: 1999,
        contentPath: sandbox,
        episodes: [{ episode: 1, title: 'Piloto', duration: '22:00' }],
      },
    ],
    airUntilToDate: true,
  });
  const generated = analog.generateYear(1999);
  assert.equal(generated.success, true);
  assert.equal(generated.generatedMonths, 12);

  const status = analog.scheduleStatus();
  assert.equal(status.status, 'ready');
  assert.equal(status.config.primaryYear, 1999);

  const january = analog.getMonthSchedule(1999, 1);
  assert.ok(january);
  assert.ok(january.entries.length > 0);
  assert.ok(january.entries.every((entry) => entry.type === 'show' || entry.type === 'filler'));

  const reset = analog.resetSchedule();
  assert.equal(reset.success, true);
  assert.equal(analog.scheduleStatus().status, 'needs_year_selection');
  assert.equal(analog.getMonthSchedule(1999, 1), null);
});

test('canales: editar el número libera el número anterior para reutilizarlo', () => {
  const first = analog.createChannel({ name: 'Libre A', number: 501 });
  analog.updateChannel(first.id, { number: 502 });
  assert.equal(analog.listChannels().find((channel) => channel.uuid === first.uuid).number, 502);
  const second = analog.createChannel({ name: 'Libre B', number: 501 });
  assert.equal(second.number, 501);
  assert.throws(
    () => analog.updateChannel(second.id, { number: 502 }),
    /ya está en uso por «Libre A»/,
  );
  assert.equal(analog.deleteChannel(first.id), true);
  assert.equal(analog.deleteChannel(second.id), true);
});

test('empareja episodios contra archivos reales de una carpeta', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-ep-'));
  fs.writeFileSync(path.join(folder, 'Serie - 01a - Piloto.mkv'), 'x');
  fs.writeFileSync(path.join(folder, 'notas.txt'), 'x');
  const matches = await analog.matchFolderEpisodes(folder, [
    { episode: 1, fileNames: ['01a - Piloto.mp4'] },
    { episode: 2, fileNames: ['02 - Otro.mp4'] },
  ]);
  assert.equal(matches[1], 'Serie - 01a - Piloto.mkv');
  assert.equal(matches[2], null);
  assert.deepEqual(await analog.matchFolderEpisodes(path.join(folder, 'no-existe'), []), {});
});

test('matchFolderEpisodes: coincidencia exacta, normalizada y lectura fallida', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-exact-'));
  fs.writeFileSync(path.join(folder, 'Capitulo 5.mkv'), 'x');
  fs.writeFileSync(path.join(folder, 'CAPITULO 6.MKV'), 'x');
  const exact = await analog.matchFolderEpisodes(folder, [
    { episode: 1, fileNames: ['Capitulo 5.mkv'] },
  ]);
  assert.equal(exact[1], 'Capitulo 5.mkv');
  const fuzzy = await analog.matchFolderEpisodes(folder, [
    { episode: 2, fileNames: ['Capitulo 6.mkv'] },
  ]);
  assert.equal(fuzzy[2], 'CAPITULO 6.MKV');
  const failed = await analog.matchFolderEpisodes(path.join(folder, 'no-existe'), [
    { episode: 3, fileNames: ['Capitulo 7.mkv'] },
  ]);
  assert.deepEqual(failed, {});
});

test('parseDurationToSeconds: formato de una sola parte cae en el fallback', () => {
  assert.equal(analog.parseDurationToSeconds('75'), 300);
});

test('resolveAnalogDir sin override: empaquetada, dev y fallback con APPDATA', () => {
  const savedOverride = process.env.ANALOG_REPLAY_TV_USER_DATA;
  const savedAppData = process.env.APPDATA;
  try {
    delete process.env.ANALOG_REPLAY_TV_USER_DATA;
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-base-'));
    process.env.APPDATA = base;

    assert.equal(analog.resolveAnalogDir(), path.join(base, 'Electron'));

    fs.mkdirSync(path.join(base, 'analog-replay-tv'), { recursive: true });
    assert.equal(analog.resolveAnalogDir(), path.join(base, 'analog-replay-tv'));

    fs.writeFileSync(path.join(base, 'analog-replay-tv', 'analog-replay-tv.sqlite'), 'x');
    assert.equal(analog.resolveAnalogDir(), path.join(base, 'analog-replay-tv'));

    fs.rmSync(path.join(base, 'analog-replay-tv'), { recursive: true, force: true });
    fs.mkdirSync(path.join(base, 'Electron'), { recursive: true });
    fs.writeFileSync(path.join(base, 'Electron', 'analog-replay-tv.sqlite'), 'x');
    assert.equal(analog.resolveAnalogDir(), path.join(base, 'Electron'));

    delete process.env.APPDATA;
    assert.equal(typeof analog.resolveAnalogDir(), 'string');
  } finally {
    if (savedOverride === undefined) delete process.env.ANALOG_REPLAY_TV_USER_DATA;
    else process.env.ANALOG_REPLAY_TV_USER_DATA = savedOverride;
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
  }
});

test('importar canales con JSON inválido lanza un error descriptivo', () => {
  const file = path.join(os.tmpdir(), `analog-bad-channels-${Date.now()}.json`);
  fs.writeFileSync(file, 'esto no es un json');
  try {
    assert.throws(() => analog.importChannelsFile(file), /JSON válido/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('importar programas con JSON inválido lanza un error descriptivo', () => {
  const file = path.join(os.tmpdir(), `analog-bad-shows-${Date.now()}.json`);
  fs.writeFileSync(file, 'esto no es un json');
  try {
    assert.throws(() => analog.importShowFile(file), /JSON válido/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('la base se cierra y reabre al cambiar de directorio', () => {
  const saved = process.env.ANALOG_REPLAY_TV_USER_DATA;
  try {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-reopen-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-reopen-b-'));
    process.env.ANALOG_REPLAY_TV_USER_DATA = dirA;
    assert.deepEqual(analog.listChannels(), []);
    process.env.ANALOG_REPLAY_TV_USER_DATA = dirB;
    assert.deepEqual(analog.listChannels(), []);
  } finally {
    process.env.ANALOG_REPLAY_TV_USER_DATA = saved;
  }
});

test('database(): un cierre fallido al cambiar de directorio se ignora', () => {
  const saved = process.env.ANALOG_REPLAY_TV_USER_DATA;
  class FailingDatabaseSync extends RealDatabaseSync {
    close() {
      throw new Error('boom');
    }
  }
  const resolved = require.resolve('../electron/analogReplay.cjs');
  try {
    installHooks({ 'node:sqlite': { DatabaseSync: FailingDatabaseSync } });
    delete require.cache[resolved];
    const hooked = require('../electron/analogReplay.cjs');
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-close-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-close-b-'));
    process.env.ANALOG_REPLAY_TV_USER_DATA = dirA;
    assert.deepEqual(hooked.listChannels(), []);
    process.env.ANALOG_REPLAY_TV_USER_DATA = dirB;
    assert.deepEqual(hooked.listChannels(), []);
    restoreHooks();
  } finally {
    restoreHooks();
    process.env.ANALOG_REPLAY_TV_USER_DATA = saved;
  }
});

test('scheduleStatus crea una configuración fresca sin estado previo', () => {
  const saved = process.env.ANALOG_REPLAY_TV_USER_DATA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-fresh-config-'));
  try {
    process.env.ANALOG_REPLAY_TV_USER_DATA = dir;
    const status = analog.scheduleStatus();
    assert.equal(status.status, 'needs_year_selection');
    assert.equal(status.config.primaryYear, 0);
  } finally {
    process.env.ANALOG_REPLAY_TV_USER_DATA = saved;
  }
});

test('programación once-per-day: las horas libres se rellenan con identificación', () => {
  const saved = process.env.ANALOG_REPLAY_TV_USER_DATA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-filler-'));
  try {
    process.env.ANALOG_REPLAY_TV_USER_DATA = dir;
    analog.replaceChannels([
      { id: 1, uuid: 'canal-retro', name: 'RETRO', number: 3, isEnabled: true },
    ]);
    analog.createShow({
      name: 'Clasico de Medianoche',
      channel: ['RETRO'],
      episodeAiringMode: 'once-per-day',
      airUntilToDate: true,
      seasons: [
        {
          season: 1,
          year: 2024,
          contentPath: dir,
          episodes: [{ episode: 1, title: 'Película', duration: '45:00' }],
        },
      ],
    });
    const generated = analog.generateYear(2024);
    assert.equal(generated.success, true);
    const january = analog.getMonthSchedule(2024, 1);
    assert.ok(january);
    assert.ok(january.entries.some((entry) => entry.type === 'show'));
    assert.ok(january.entries.some((entry) => entry.type === 'filler'));
    assert.ok(
      january.entries
        .filter((entry) => entry.type === 'filler')
        .every((entry) => entry.showName === 'AnalogReplayTV' && entry.channelName === 'RETRO'),
    );
  } finally {
    process.env.ANALOG_REPLAY_TV_USER_DATA = saved;
  }
});

test('getMonthSchedule lee y persiste un archivo de programación legado', () => {
  const saved = process.env.ANALOG_REPLAY_TV_USER_DATA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-legacy-'));
  try {
    process.env.ANALOG_REPLAY_TV_USER_DATA = dir;
    const analogDirActual = analog.analogDir();
    const schedulesDir = path.join(analogDirActual, 'schedules', '2023');
    fs.mkdirSync(schedulesDir, { recursive: true });
    const legacy = {
      year: 2023,
      month: 3,
      monthName: 'march',
      generated: '2023-04-01T00:00:00.000Z',
      entries: [{ id: 'legacy-1', type: 'show', showName: 'Viejo Archivo' }],
    };
    fs.writeFileSync(path.join(schedulesDir, 'march-2023.json'), JSON.stringify(legacy));
    const month = analog.getMonthSchedule(2023, 3);
    assert.equal(month.entries[0].showName, 'Viejo Archivo');
    assert.equal(analog.getMonthSchedule(2023, 3).entries[0].showName, 'Viejo Archivo');

    fs.writeFileSync(
      path.join(schedulesDir, 'february-2023.json'),
      JSON.stringify({
        year: 2023,
        month: 2,
        monthName: 'february',
        entries: [{ id: 'legacy-2', type: 'show', showName: 'Sin Fecha' }],
      }),
    );
    assert.equal(analog.getMonthSchedule(2023, 2).entries[0].showName, 'Sin Fecha');
  } finally {
    process.env.ANALOG_REPLAY_TV_USER_DATA = saved;
  }
});

test('getFolderVideos sonda duraciones y deduce títulos de los archivos', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-videos-'));
  fs.writeFileSync(path.join(folder, '10 Episodio - Piloto.mkv'), 'x');
  fs.writeFileSync(path.join(folder, '2 Segundo - fail.mkv'), 'x');
  fs.writeFileSync(path.join(folder, '3 Raro - raro.mkv'), 'x');
  fs.writeFileSync(path.join(folder, 'notas.txt'), 'x');
  const fakeExecFile = (command, args, options, cb) => {
    const file = String(args[args.length - 1]);
    if (/fail\.mkv$/i.test(file)) return cb(new Error('ffprobe falló'));
    if (/raro\.mkv$/i.test(file)) return cb(null, 'no-es-un-numero\n');
    cb(null, '600.5\n');
  };
  const resolved = require.resolve('../electron/analogReplay.cjs');
  installHooks({ 'node:child_process': { execFile: fakeExecFile } });
  delete require.cache[resolved];
  const hooked = require('../electron/analogReplay.cjs');
  try {
    const videos = await hooked.getFolderVideos(folder);
    assert.equal(videos.length, 3);
    assert.equal(videos[0].fileName, '2 Segundo - fail.mkv');
    assert.equal(videos[0].title, 'Segundo   fail');
    assert.equal(videos[0].duration, '00:00');
    assert.equal(videos[1].fileName, '3 Raro - raro.mkv');
    assert.equal(videos[1].title, 'Raro   raro');
    assert.equal(videos[1].duration, '00:00');
    assert.equal(videos[2].fileName, '10 Episodio - Piloto.mkv');
    assert.equal(videos[2].title, 'Episodio   Piloto');
    assert.equal(videos[2].duration, '10:00');
  } finally {
    restoreHooks();
  }
});

test('flattenShowEpisodes ignora temporadas cuyo directorio falla al inspeccionarse', () => {
  const realFs = require('node:fs');
  const MARKER = 'analog://marcador';
  const resolved = require.resolve('../electron/analogReplay.cjs');
  installHooks({
    'node:fs': {
      ...realFs,
      existsSync: (p) => (p === MARKER ? true : realFs.existsSync(p)),
      statSync: (p, o) => {
        if (p === MARKER) throw new Error('boom');
        return realFs.statSync(p, o);
      },
    },
  });
  delete require.cache[resolved];
  const hooked = require('../electron/analogReplay.cjs');
  try {
    const flat = hooked.flattenShowEpisodes({
      name: 'Serie',
      channel: [],
      seasons: [
        {
          season: 1,
          year: 2000,
          contentPath: MARKER,
          episodes: [{ episode: 1, title: 'A', duration: '11:00' }],
        },
      ],
    });
    assert.deepEqual(flat, []);
  } finally {
    restoreHooks();
  }
});

test('tablas degradadas reportan errores reales de la base (canales y programación)', () => {
  const saved = process.env.ANALOG_REPLAY_TV_USER_DATA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analog-degraded-'));
  try {
    process.env.ANALOG_REPLAY_TV_USER_DATA = dir;
    analog.listChannels();
    const db = new RealDatabaseSync(path.join(dir, 'analog-replay-tv.sqlite'));
    try {
      db.exec(
        'PRAGMA foreign_keys = OFF; DROP TABLE channels; CREATE TABLE channels (storage_key TEXT PRIMARY KEY, legacy_id TEXT); DROP TABLE schedule_months; DROP TABLE schedule_config;',
      );
    } finally {
      db.close();
    }
    assert.throws(
      () => analog.createChannel({ name: 'Degradado', number: 1 }),
      /no column named uuid/,
    );
    assert.equal(analog.generateYear(2020).success, false);
    assert.equal(analog.resetSchedule().success, false);
  } finally {
    process.env.ANALOG_REPLAY_TV_USER_DATA = saved;
  }
});
