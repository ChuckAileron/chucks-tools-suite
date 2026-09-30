const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CalendarioManager, EVENT_COLORS } = require('../electron/calendarioManager.cjs');

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendario-'));
  const manager = new CalendarioManager(path.join(dir, 'test.sqlite'));
  return { manager, dir };
};

const base = {
  title: 'Viaje',
  label: 'Vacaciones',
  color: 'teal',
  startDate: '2025-03-10',
  endDate: '2025-03-15',
  allDay: true,
  startTime: null,
  endTime: null,
  description: 'Notas',
  images: ['C:/foto.png'],
};

test('crea, actualiza y elimina eventos', () => {
  const { manager, dir } = fresh();
  const event = manager.createEvent(base);
  assert.equal(event.title, 'Viaje');
  assert.equal(event.label, 'Vacaciones');
  assert.equal(event.color, 'teal');
  assert.deepEqual(event.images, ['C:/foto.png']);

  const updated = manager.updateEvent(event.id, {
    title: 'Viaje largo',
    allDay: false,
    startTime: '09:30',
    endTime: '18:00',
  });
  assert.equal(updated.title, 'Viaje largo');
  assert.equal(updated.allDay, false);
  assert.equal(updated.startTime, '09:30');

  assert.equal(manager.deleteEvent(event.id), true);
  assert.equal(manager.eventsForRange('2025-01-01', '2025-12-31').length, 0);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('eventsForRange incluye eventos que cruzan los bordes del rango', () => {
  const { manager, dir } = fresh();
  manager.createEvent({ ...base, title: 'Termina antes', startDate: '2024-12-20', endDate: '2025-01-05' });
  manager.createEvent({ ...base, title: 'Cruza el borde del fin', startDate: '2025-03-28', endDate: '2025-04-05' });
  manager.createEvent({ ...base, title: 'Cruza el borde del inicio', startDate: '2025-01-25', endDate: '2025-02-15' });
  manager.createEvent({ ...base, title: 'Junio', startDate: '2025-06-01', endDate: '2025-06-02' });

  const window = manager.eventsForRange('2025-02-01', '2025-03-31');
  assert.equal(window.length, 2);
  const titles = window.map((event) => event.title);
  assert.ok(titles.includes('Cruza el borde del fin'));
  assert.ok(titles.includes('Cruza el borde del inicio'));
  assert.ok(!titles.includes('Termina antes'));
  assert.ok(!titles.includes('Junio'));
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('valida fechas, horas, color y título', () => {
  const { manager, dir } = fresh();
  assert.throws(
    () => manager.createEvent({ ...base, title: '  ' }),
    /título/,
  );
  assert.throws(
    () => manager.createEvent({ ...base, startDate: '2025-05-10', endDate: '2025-05-01' }),
    /fin no puede ser anterior/,
  );
  assert.throws(
    () => manager.createEvent({ ...base, startDate: '05/10/2025', endDate: '2025-05-10' }),
    /formato/,
  );
  assert.throws(
    () => manager.createEvent({ ...base, allDay: false }),
    /hora de inicio/,
  );
  assert.throws(
    () => manager.createEvent({ ...base, allDay: false, startTime: '25:60' }),
    /HH:MM/,
  );
  assert.throws(
    () => manager.createEvent({ ...base, color: 'rosa' }),
    /no soportado/,
  );
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un evento todo el día anula las horas al actualizarse', () => {
  const { manager, dir } = fresh();
  const event = manager.createEvent({
    ...base,
    allDay: false,
    startTime: '08:00',
    endTime: '10:00',
  });
  const updated = manager.updateEvent(event.id, { allDay: true });
  assert.equal(updated.allDay, true);
  assert.equal(updated.startTime, null);
  assert.equal(updated.endTime, null);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la paleta de colores exportada es la lista esperada', () => {
  assert.equal(Array.isArray(EVENT_COLORS), true);
  assert.equal(EVENT_COLORS.length, 7);
  assert.ok(EVENT_COLORS.includes('teal'));
  assert.ok(EVENT_COLORS.includes('amarillo'));
});

test('replaceHolidays reemplaza los feriados del año sin duplicar', () => {
  const { manager, dir } = fresh();
  const added = manager.replaceHolidays(2025, [
    { title: 'Año Nuevo', date: '2025-01-01', label: 'Feriado', color: 'rojo', description: 'Tipo: civil' },
    { title: 'Día del Trabajo', date: '2025-05-01', label: 'Feriado', color: 'rojo' },
  ]);
  assert.equal(added, 2);
  assert.equal(manager.eventsForRange('2025-01-01', '2025-12-31').length, 2);

  const again = manager.replaceHolidays(2025, [
    { title: 'Año Nuevo', date: '2025-01-01', label: 'Feriado', color: 'rojo' },
  ]);
  assert.equal(again, 1);
  const events = manager.eventsForRange('2025-01-01', '2025-12-31');
  assert.equal(events.length, 1);
  assert.equal(events[0].isHoliday, true);
  assert.equal(events[0].title, 'Año Nuevo');
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].color, 'rojo');

  manager.replaceHolidays(2026, [{ title: 'Navidad', date: '2026-12-25', label: 'Feriado', color: 'rojo' }]);
  assert.equal(manager.eventsForRange('2025-01-01', '2025-12-31').length, 1);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un feriado se actualiza sin perder su marca isHoliday', () => {
  const { manager, dir } = fresh();
  manager.replaceHolidays(2027, [{ title: 'Año Nuevo', date: '2027-01-01', label: 'Feriado', color: 'rojo' }]);
  const event = manager.eventsForRange('2027-01-01', '2027-12-31')[0];
  const updated = manager.updateEvent(event.id, { title: 'Año Nuevo (receso)' });
  assert.equal(updated.title, 'Año Nuevo (receso)');
  assert.equal(updated.isHoliday, true);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});