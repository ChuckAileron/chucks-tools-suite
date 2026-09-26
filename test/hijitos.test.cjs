const test = require('node:test');
const assert = require('node:assert/strict');
const { HijitosManager } = require('../electron/hijitosManager.cjs');

function freshManager() {
  return new HijitosManager(':memory:');
}

test('los tracks Izumi y Pepita se crean al inicio', () => {
  const manager = freshManager();
  const tracks = manager.listTracks();
  assert.equal(tracks.length, 2);
  assert.deepEqual(
    tracks.map((track) => track.slug).sort(),
    ['izumi', 'pepita'],
  );
  for (const track of tracks) {
    assert.equal(track.stats.total, 0);
    assert.equal(track.stats.percent, 0);
    assert.equal(track.stats.pending, 0);
    assert.equal(track.stats.done, 0);
    assert.deepEqual(track.tasks, []);
  }
  manager.close();
});

test('una tarea nueva nace pendiente con prioridad media por defecto', () => {
  const manager = freshManager();
  const task = manager.createTask({
    trackSlug: 'izumi',
    description: '  Pasar la aspiradora  ',
  });
  assert.equal(task.trackSlug, 'izumi');
  assert.equal(task.description, 'Pasar la aspiradora');
  assert.equal(task.priority, 'medio');
  assert.equal(task.done, false);
  assert.equal(task.dueDate, '');
  assert.deepEqual(task.subtasks, []);
  const track = manager.listTracks().find((t) => t.slug === 'izumi');
  assert.equal(track.stats.total, 1);
  assert.equal(track.stats.pending, 1);
  assert.equal(track.stats.done, 0);
  assert.equal(track.stats.percent, 0);
  manager.close();
});

test('se valida que la descripción sea obligatoria', () => {
  const manager = freshManager();
  assert.throws(() => manager.createTask({ trackSlug: 'izumi', description: '   ' }), /descripción/i);
  manager.close();
});

test('fecha de compromiso se valida en formato YYYY-MM-DD', () => {
  const manager = freshManager();
  const task = manager.createTask({
    trackSlug: 'pepita',
    description: 'Estudiar',
    dueDate: '2026-10-31',
  });
  assert.equal(task.dueDate, '2026-10-31');
  assert.throws(() => manager.createTask({ trackSlug: 'pepita', description: 'X', dueDate: '31/10/2026' }), /formato/i);
  manager.close();
});

test('prioridad inválida se rechaza y prioridades válidas se conservan', () => {
  const manager = freshManager();
  const task = manager.createTask({
    trackSlug: 'izumi',
    description: 'Tarea alta',
    priority: 'alto',
  });
  assert.equal(task.priority, 'alto');
  assert.throws(() => manager.createTask({ trackSlug: 'izumi', description: 'X', priority: 'urgente' }), /prioridad/i);
  manager.close();
});

test('track inválido se rechaza', () => {
  const manager = freshManager();
  assert.throws(() => manager.createTask({ trackSlug: 'rex', description: 'X' }), /gatito/i);
  manager.close();
});

test('marcar y deshacer una tarea como realizada', () => {
  const manager = freshManager();
  const task = manager.createTask({ trackSlug: 'izumi', description: 'Bañarse' });
  const doneTask = manager.toggleTask(task.id, true);
  assert.equal(doneTask.done, true);
  const track = manager.listTracks().find((t) => t.slug === 'izumi');
  assert.equal(track.stats.done, 1);
  assert.equal(track.stats.pending, 0);
  assert.equal(track.stats.percent, 100);
  const undone = manager.toggleTask(task.id, false);
  assert.equal(undone.done, false);
  const updated = manager.listTracks().find((t) => t.slug === 'izumi');
  assert.equal(updated.stats.done, 0);
  assert.equal(updated.stats.pending, 1);
  assert.equal(updated.stats.percent, 0);
  manager.close();
});

test('toggleTask sin argumento alterna el estado', () => {
  const manager = freshManager();
  const task = manager.createTask({ trackSlug: 'pepita', description: 'Alternar' });
  assert.equal(manager.toggleTask(task.id).done, true);
  assert.equal(manager.toggleTask(task.id).done, false);
  manager.close();
});

test('edición de tarea: descripción, prioridad, fecha y traslado de track', () => {
  const manager = freshManager();
  const task = manager.createTask({
    trackSlug: 'izumi',
    description: 'Antigua',
    priority: 'bajo',
    dueDate: '2026-10-31',
  });
  const edited = manager.updateTask(task.id, {
    description: 'Nueva descripción',
    priority: 'alto',
    dueDate: '2026-11-01',
    trackSlug: 'pepita',
  });
  assert.equal(edited.description, 'Nueva descripción');
  assert.equal(edited.priority, 'alto');
  assert.equal(edited.dueDate, '2026-11-01');
  assert.equal(edited.trackSlug, 'pepita');
  const tracks = manager.listTracks();
  assert.equal(tracks.find((t) => t.slug === 'izumi').stats.total, 0);
  assert.equal(tracks.find((t) => t.slug === 'pepita').stats.total, 1);
  manager.close();
});

test('subtaskas: crear, marcar, editar y borrar', () => {
  const manager = freshManager();
  const task = manager.createTask({ trackSlug: 'izumi', description: 'Proyecto' });
  const subtask = manager.createSubtask(task.id, 'Paso 1');
  assert.equal(subtask.description, 'Paso 1');
  assert.equal(subtask.done, false);
  assert.equal(manager.getTask(task.id).subtasks.length, 1);
  const doneSubtask = manager.updateSubtask(subtask.id, { done: true });
  assert.equal(doneSubtask.done, true);
  const renamed = manager.updateSubtask(subtask.id, { description: 'Paso 1 corregido' });
  assert.equal(renamed.description, 'Paso 1 corregido');
  assert.equal(manager.deleteSubtask(subtask.id), true);
  assert.equal(manager.getTask(task.id).subtasks.length, 0);
  manager.close();
});

test('borrar una tarea elimina sus subtareas en cascada', () => {
  const manager = freshManager();
  const task = manager.createTask({ trackSlug: 'pepita', description: 'Tarea con pasos' });
  manager.createSubtask(task.id, 'A');
  manager.createSubtask(task.id, 'B');
  assert.equal(manager.deleteTask(task.id), true);
  const track = manager.listTracks().find((t) => t.slug === 'pepita');
  assert.equal(track.stats.total, 0);
  manager.close();
});

test('subtaskas no requieren tarea existente', () => {
  const manager = freshManager();
  assert.throws(() => manager.createSubtask(9999, 'X'), /tarea no existe/i);
  assert.throws(() => manager.createSubtask(9999, '   '), /tarea no existe/i);
  manager.close();
});

test('subtarea vacía se rechaza', () => {
  const manager = freshManager();
  const task = manager.createTask({ trackSlug: 'izumi', description: 'Con pasos' });
  assert.throws(() => manager.createSubtask(task.id, '   '), /subtarea/i);
  manager.close();
});

test('el porcentaje combina pendientes y realizadas', () => {
  const manager = freshManager();
  manager.createTask({ trackSlug: 'izumi', description: 'A' });
  const b = manager.createTask({ trackSlug: 'izumi', description: 'B' });
  manager.createTask({ trackSlug: 'izumi', description: 'C' });
  manager.toggleTask(b.id, true);
  const track = manager.listTracks().find((t) => t.slug === 'izumi');
  assert.equal(track.stats.total, 3);
  assert.equal(track.stats.done, 1);
  assert.equal(track.stats.pending, 2);
  assert.equal(track.stats.percent, 33);
  manager.close();
});

test('el banner del track se puede configurar y limpiar', () => {
  const manager = freshManager();
  const updated = manager.updateTrack('izumi', { name: 'Izumi ❤️', banner: 'C:/fotos/gato.png' });
  assert.equal(updated.name, 'Izumi ❤️');
  assert.equal(updated.banner, 'C:/fotos/gato.png');
  const cleared = manager.updateTrack('izumi', { banner: '' });
  assert.equal(cleared.banner, '');
  assert.throws(() => manager.updateTrack('nope', { banner: 'x' }), /gatito/i);
  manager.close();
});

test('la posición del banner acepta coordenadas exactas y las aplanza al rango 0-100', () => {
  const manager = freshManager();
  const track = manager.listTracks().find((item) => item.slug === 'izumi');
  assert.equal(track.bannerX, 50);
  assert.equal(track.bannerY, 50);

  const positioned = manager.updateTrack('izumi', { bannerX: 30, bannerY: 75 });
  assert.equal(positioned.bannerX, 30);
  assert.equal(positioned.bannerY, 75);

  const outOfRange = manager.updateTrack('izumi', { bannerX: 180, bannerY: -20 });
  assert.equal(outOfRange.bannerX, 100);
  assert.equal(outOfRange.bannerY, 0);

  const half = manager.updateTrack('izumi', { bannerX: 50.4, bannerY: 30 });
  assert.equal(half.bannerX, 50);
  assert.equal(half.bannerY, 30);

  const unchanged = manager.updateTrack('izumi', { banner: 'C:/foto.jpg' });
  assert.equal(unchanged.bannerX, 50);
  assert.equal(unchanged.bannerY, 30);
  manager.close();
});

test('el banner principal de la sección arranca vacío y se configura por URL o ruta local', () => {
  const manager = freshManager();
  assert.equal(manager.getBanner(), '');
  assert.equal(manager.setBanner('https://ejemplo.com/portada.png'), 'https://ejemplo.com/portada.png');
  assert.equal(manager.getBanner(), 'https://ejemplo.com/portada.png');
  assert.equal(manager.setBanner('C:/fotos/portada.jpg'), 'C:/fotos/portada.jpg');
  assert.equal(manager.getBanner(), 'C:/fotos/portada.jpg');
  assert.equal(manager.setBanner(''), '');
  assert.equal(manager.getBanner(), '');
  manager.close();
});