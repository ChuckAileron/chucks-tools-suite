const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { BotsManager } = require('../electron/botsManager.cjs');

const BOTS_TABLES = ['bots_steam', 'bots_amazon', 'bots_downloads'];

function freshManager() {
  const dir = mkdtempSync(join(tmpdir(), 'bots-test-'));
  const manager = new BotsManager(join(dir, 'bots.sqlite'));
  return { manager, dir };
}

function closeManager({ manager, dir }) {
  manager.close();
  rmSync(dir, { recursive: true, force: true });
}

function ageRows(manager, table, days) {
  manager.db
    .prepare(`UPDATE ${table} SET fetched_at = datetime('now', ?)`)
    .run(`-${days} days`);
}

test('botsManager guarda y lee ofertas de Steam', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    const deals = [
      { title: 'Juego A', price: 'CLP 2.999', original: 'CLP 9.999', discount: '-70%', url: 'https://store.steampowered.com/app/1' },
      { title: 'Juego B', price: 'CLP 1.299', original: '', discount: '-50%', url: '' },
    ];
    const saved = manager.saveSteam(deals);
    assert.equal(saved.length, 2);
    assert.equal(saved[0].title, 'Juego B');
    assert.equal(manager.steam().length, 2);
  } finally {
    closeManager(fixture);
  }
});

test('botsManager reemplaza los datos de Steam al resguardar', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    manager.saveSteam([{ title: 'Viejo' }]);
    manager.saveSteam([{ title: 'Nuevo' }]);
    const rows = manager.steam();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Nuevo');
  } finally {
    closeManager(fixture);
  }
});

test('botsManager expira datos de Steam después de 24 h', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    manager.saveSteam([{ title: 'Viejo' }, { title: 'Reciente' }]);
    ageRows(manager, 'bots_steam', 2);
    assert.equal(manager.steam().length, 0);
    assert.equal(manager.fresh('bots_steam'), false);
    manager.saveSteam([{ title: 'Reciente' }]);
    assert.equal(manager.fresh('bots_steam'), true);
  } finally {
    closeManager(fixture);
  }
});

test('botsAmazon hace upsert por URL y respeta la vigencia por fila', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    const one = { url: 'https://amazon.com/dp/A', price: 100, currency: 'USD' };
    const second = { url: 'https://amazon.com/dp/B', price: 250, currency: 'USD' };
    manager.saveAmazon([one, second]);

    ageRows(manager, 'bots_amazon', 2);
    assert.equal(manager.amazon().length, 0);
    assert.equal(manager.freshUrl('bots_amazon', 'https://amazon.com/dp/A'), false);

    manager.saveAmazon([one]);
    assert.equal(manager.freshUrl('bots_amazon', 'https://amazon.com/dp/A'), true);
    assert.equal(manager.freshUrl('bots_amazon', 'https://amazon.com/dp/B'), false);

    manager.saveAmazon([{ url: 'https://amazon.com/dp/A', price: 120, currency: 'USD' }]);
    const rows = manager.amazon();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, 120);
  } finally {
    closeManager(fixture);
  }
});

test('botsManager guarda enlaces de descarga con upsert', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    manager.saveDownloads([
      { url: 'https://cdn.example.com/archivo.zip', sourceTitle: 'Demo' },
    ]);
    manager.saveDownloads([
      { url: 'https://cdn.example.com/archivo.zip', sourceTitle: 'Demo 2' },
    ]);
    const rows = manager.downloads();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceTitle, 'Demo 2');
  } finally {
    closeManager(fixture);
  }
});

test('botsManager valida y persiste sesiones por portal', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    const session = manager.saveSession({
      portal: 'MiPortal',
      url: 'https://portal.example.com/login',
      username: 'user1',
      password: 'pass1',
      userField: '#user',
      passField: '#pass',
      submitSelector: 'button[type="submit"]',
      successSelector: '.header-user',
    });
    assert.ok(session.id > 0);
    assert.equal(manager.sessions().length, 1);

    const updated = manager.saveSession({
      portal: 'MiPortal',
      url: 'https://portal.example.com/login',
      username: 'user2',
      password: 'pass2',
      userField: '#user',
      passField: '#pass',
      submitSelector: 'button',
    });
    assert.equal(updated.id, session.id);
    assert.equal(updated.username, 'user2');

    assert.equal(manager.deleteSession(session.id), true);
    assert.equal(manager.sessions().length, 0);
  } finally {
    closeManager(fixture);
  }
});

test('botsManager valida la entrada de sesiones', () => {
  const fixture = freshManager();
  const { manager } = fixture;
  try {
    assert.throws(() => manager.saveSession({}), /nombre de portal/);
    assert.throws(
      () =>
        manager.saveSession({
          portal: 'X',
          url: 'javascript:alert(1)',
          username: 'u',
          password: 'p',
          userField: '#u',
          passField: '#p',
        }),
      /URL válida/,
    );
    assert.throws(
      () =>
        manager.saveSession({
          portal: 'X',
          url: 'https://a.example.com',
          username: 'u',
          password: 'p',
          userField: '',
          passField: '#p',
        }),
      /selectores/,
    );
    for (const table of BOTS_TABLES) manager.clear(table);
  } finally {
    closeManager(fixture);
  }
});