const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CuentasManager } = require('../electron/cuentasManager.cjs');

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuentas-'));
  const manager = new CuentasManager(path.join(dir, 'test.sqlite'));
  return { manager, dir };
};

test('crea, actualiza y elimina cuentas con campos personalizados', () => {
  const { manager, dir } = fresh();
  const account = manager.createAccount({
    name: 'Tarjeta',
    description: 'Visa',
    columns: [{ name: 'categoria', label: 'Categoría', type: 'string', required: false }],
  });
  assert.equal(account.name, 'Tarjeta');
  assert.equal(account.columns[0].name, 'categoria');

  const updated = manager.updateAccount(account.id, { name: 'Tarjeta Visa' });
  assert.equal(updated.name, 'Tarjeta Visa');

  assert.equal(manager.deleteAccount(account.id), true);
  assert.equal(manager.listAccounts().length, 0);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rechaza nombres duplicados y nombres vacíos', () => {
  const { manager, dir } = fresh();
  manager.createAccount({ name: 'Caja' });
  assert.throws(() => manager.createAccount({ name: 'caja', columns: [] }), /Ya existe/);
  assert.throws(() => manager.createAccount({ name: '  ', columns: [] }), /necesita un nombre/);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('totaliza por mes (suma de registros del mes) y filtra por año', () => {
  const { manager, dir } = fresh();
  const account = manager.createAccount({ name: 'Ahorros', columns: [] });
  manager.addRegister({ accountId: account.id, name: 'Gasto', date: '2025-03-01', amount: -1000 });
  manager.addRegister({ accountId: account.id, name: 'Otro gasto', date: '2025-03-21', amount: -500 });
  manager.addRegister({ accountId: account.id, name: 'Depósito', date: '2025-04-02', amount: 3000 });
  manager.addRegister({ accountId: account.id, name: 'Antiguo', date: '2024-12-31', amount: 100 });

  const totals = manager.monthlyTotals(account.id, 2025);
  assert.equal(totals.length, 12);
  assert.equal(totals[2].total, -1500); // marzo: totalizado con 2 registros
  assert.equal(totals[2].count, 2);
  assert.equal(totals[3].total, 3000); // abril
  assert.equal(totals[11].total, 0);   // diciembre de 2025 sin registros
  assert.deepEqual(manager.registeredYears(account.id), [2025, 2024]);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('borrar una cuenta arrastra sus movimientos', () => {
  const { manager, dir } = fresh();
  const account = manager.createAccount({ name: 'Efectivo', columns: [] });
  manager.addRegister({ accountId: account.id, name: 'Compra', date: '2025-05-05', amount: -200 });
  assert.equal(manager.listRegisters(account.id).length, 1);
  manager.deleteAccount(account.id);
  assert.equal(manager.listRegisters(account.id).length, 0);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('valida montos, fechas y campos requeridos en movimientos', () => {
  const { manager, dir } = fresh();
  const account = manager.createAccount({
    name: 'Caja',
    columns: [{ name: 'proveedor', label: 'Proveedor', type: 'string', required: true }],
  });
  assert.throws(
    () => manager.addRegister({ accountId: account.id, name: 'X', date: '2025-01-01', amount: 50 }),
    /Proveedor/,
  );
  assert.throws(
    () => manager.addRegister({ accountId: account.id, name: 'X', date: '2025-01-01', amount: 'abc' }),
    /monto/,
  );
  assert.throws(
    () => manager.addRegister({ accountId: account.id, name: 'X', date: '05/01/2025', amount: 10 }),
    /fecha/,
  );
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('actualiza un movimiento conservando la cuenta y validando sus campos', () => {
  const { manager, dir } = fresh();
  const account = manager.createAccount({ name: 'Caja', columns: [] });
  const register = manager.addRegister({
    accountId: account.id,
    name: 'Gasto',
    date: '2025-01-01',
    amount: -100,
  });
  const updated = manager.updateRegister(register.id, { name: 'Gasto mayor', amount: -250 });
  assert.equal(updated.name, 'Gasto mayor');
  assert.equal(updated.amount, -250);
  assert.equal(updated.accountId, account.id);
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});