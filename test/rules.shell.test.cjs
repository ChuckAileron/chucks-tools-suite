const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const rules = require('../electron/rules.cjs');
const { applyRule, normalizeRule, splitFileParts, joinFileParts, parseNumber, findDate, RuleManager } = rules;

test('applyRule cambia la extensión por otra', () => {
  assert.equal(applyRule([{ type: 'ext-change', extension: 'mkv' }], 'Serie.Cap01.rar'), 'Serie.Cap01.mkv');
});

test('applyRule agrega una extensión extra', () => {
  assert.equal(applyRule([{ type: 'ext-add', extension: 'part1' }], 'Serie.mkv'), 'Serie.mkv.part1');
});

test('applyRule apila operaciones de texto en orden', () => {
  const operations = [
    { type: 'text-remove', search: ' lq' },
    { type: 'text-trim' },
    { type: 'text-upper' },
    { type: 'text-prefix', text: 'PRE ' },
    { type: 'text-suffix', text: '!' },
    { type: 'ext-change', extension: 'mkv' },
  ];
  assert.equal(applyRule(operations, 'Mi   Serie lq.rar'), 'PRE MI SERIE!.mkv');
});

test('applyRule title-case solo sube la primera letra de cada palabra', () => {
  assert.equal(applyRule([{ type: 'text-title' }], 'serie 4k REMUX.mkv'), 'Serie 4k REMUX.mkv');
});

test('applyRule reemplaza texto', () => {
  assert.equal(applyRule([{ type: 'text-replace', search: 'Cap', replace: 'Ep' }], 'Cap01 Cap02.rar'), 'Ep01 Ep02.rar');
});

test('applyRule deja intacto un nombre sin extensión', () => {
  assert.equal(applyRule([{ type: 'text-upper' }], 'mi serie'), 'MI SERIE');
});

test('applyRule ignora tipos desconocidos', () => {
  assert.equal(applyRule([{ type: 'algo-raro' }], 'Serie.rar'), 'Serie.rar');
});

test('matemáticas: suma y resta sobre el primer número', () => {
  assert.equal(applyRule([{ type: 'math-number', op: 'add', value: 2 }], 'Cap 3 de 10.rar'), 'Cap 5 de 10.rar');
  assert.equal(applyRule([{ type: 'math-number', op: 'subtract', value: 1, position: 'last' }], 'Cap 3 de 10.rar'), 'Cap 3 de 9.rar');
});

test('matemáticas: multiplicación y división', () => {
  assert.equal(applyRule([{ type: 'math-number', op: 'multiply', value: 2 }], 'Velocidad 50.mp4'), 'Velocidad 100.mp4');
  assert.equal(applyRule([{ type: 'math-number', op: 'divide', value: 4 }], 'Velocidad 100.mp4'), 'Velocidad 25.mp4');
});

test('matemáticas: no opera sin número en el nombre y conserva decimales', () => {
  assert.equal(applyRule([{ type: 'math-number', op: 'add', value: 1 }], 'Serie.mkv'), 'Serie.mkv');
  assert.equal(applyRule([{ type: 'math-number', op: 'add', value: 0.25 }], 'Medida 1,50.mkv'), 'Medida 1,75.mkv');
});

test('matemáticas: redondea un número', () => {
  assert.equal(applyRule([{ type: 'math-round', decimals: 1 }], 'Precio 3.1416.usd'), 'Precio 3.1.usd');
});

test('fechas: suma días a una fecha YYYY-MM-DD', () => {
  assert.equal(applyRule([{ type: 'date-shift', amount: 5, unit: 'days' }], 'Emision 2024-01-31 1080p.mkv'), 'Emision 2024-02-05 1080p.mkv');
});

test('fechas: resta años a una fecha DD/MM/YYYY', () => {
  assert.equal(applyRule([{ type: 'date-shift', amount: -3, unit: 'years', position: 'first' }], 'Final 10/05/2001.mp4'), 'Final 10/05/1998.mp4');
});

test('fechas: reformatea la fecha encontrada', () => {
  assert.equal(applyRule([{ type: 'date-format', target: 'YYYYMMDD' }], 'Estreno 31-12-2024.mp4'), 'Estreno 20241231.mp4');
});

test('fechas: no toca el nombre sin fecha', () => {
  assert.equal(applyRule([{ type: 'date-shift', amount: 1, unit: 'days' }], 'Serie.mkv'), 'Serie.mkv');
});

test('splitFileParts y joinFileParts separan solo la extensión final', () => {
  assert.deepEqual(splitFileParts('Serie.2024.1080p.mkv'), { base: 'Serie.2024.1080p', ext: 'mkv' });
  assert.deepEqual(splitFileParts('SinEx'), { base: 'SinEx', ext: '' });
  assert.equal(joinFileParts({ base: 'a', ext: 'rar' }), 'a.rar');
  assert.equal(joinFileParts({ base: 'a', ext: '' }), 'a');
});

test('parseNumber entiende coma, punto decimal y miles', () => {
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('1.5'), 1.5);
  assert.equal(parseNumber('1.500'), 1500);
  assert.equal(parseNumber('-12'), -12);
});

test('findDate ubica la primera y última fecha', () => {
  const name = 'xxxx 2024-01-15 yyy 20/08/2023';
  const first = findDate(name, { position: 'first' });
  assert.equal(first.y, 2024);
  assert.equal(first.m, 1);
  assert.equal(first.d, 15);
  const last = findDate(name, { position: 'last' });
  assert.equal(last.y, 2023);
  assert.equal(last.m, 8);
  assert.equal(last.d, 20);
});

test('normalizeRule descarta operaciones desconocidas y aplica defaults', () => {
  const rule = normalizeRule({
    id:   'abc',
    name: '  Mi regla  ',
    operations: [
      { type: 'no-existe' },
      { type: 'math-number', op: 'nada', value: 'x', position: 'last' },
    ],
  });
  assert.equal(rule.id, 'abc');
  assert.equal(rule.name, 'Mi regla');
  assert.equal(rule.operations.length, 1);
  assert.equal(rule.operations[0].op, 'add');
  assert.equal(rule.operations[0].value, 0);
  assert.equal(rule.operations[0].position, 'last');
});

test('RuleManager persiste y recarga las reglas como JSON', () => {
  const file = path.join(os.tmpdir(), `rules-test-${randomUUID()}.json`);
  try {
    const manager = new RuleManager(file);
    const saved   = manager.save({ name: 'Juegos', operations: [{ type: 'ext-change', extension: 'iso' }] });
    assert.ok(saved.id);
    assert.equal(manager.get(saved.id).name, 'Juegos');

    const reloaded = new RuleManager(file);
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.get(saved.id).operations[0].extension, 'iso');
    assert.equal(reloaded.remove(saved.id), true);
    assert.equal(reloaded.remove(saved.id), false);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('RuleManager tolera un archivo inexistente o corrupto', () => {
  const file = path.join(os.tmpdir(), `rules-test-${randomUUID()}.json`);
  try {
    fs.writeFileSync(file, '{no es json');
    assert.deepEqual(new RuleManager(file).list(), []);
  } finally {
    fs.rmSync(file, { force: true });
  }
});