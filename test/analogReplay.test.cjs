const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
