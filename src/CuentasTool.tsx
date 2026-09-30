import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  Cuenta,
  CuentaColumn,
  CuentaColumnType,
  CuentaRegister,
  MonthlyTotal,
} from './types';

type View = 'grafico' | 'movimientos' | 'configurar';
type CuentaDraft = { name: string; description: string; columns: CuentaColumn[] };
type RegisterDraft = {
  id?: number;
  name: string;
  date: string;
  amount: string;
  values: Record<string, unknown>;
};

const MONTH_NAMES                                   = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const TYPE_LABELS: Record<CuentaColumnType, string> = {
  string:  'Texto',
  number:  'Número',
  boolean: 'Sí / No',
  date:    'Fecha',
  url:     'URL',
  tags:    'Etiquetas',
};
const EMPTY_ACCOUNT: CuentaDraft                    = { name: '', description: '', columns: [] };

const todayLocal = () => {
  const date  = new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day   = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const formatAmount = (value: number) =>
  `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const strValue = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const formatValue = (column: CuentaColumn, value: unknown) => {
  if (value === undefined || value === null || value === '') return '—';
  if (column.type === 'boolean') return value ? 'Sí' : 'No';
  if (column.type === 'tags' && Array.isArray(value)) return value.join(', ');
  if (column.type === 'date' && typeof value === 'string') return value.slice(0, 10);
  return String(value);
};

export default function CuentasTool() {
  const [accounts, setAccounts]     = useState<Cuenta[]>([]);
  const [activeId, setActiveId]     = useState<number | null>(null);
  const [registers, setRegisters]   = useState<CuentaRegister[]>([]);
  const [view, setView]             = useState<View>('grafico');
  const [year, setYear]             = useState<number>(new Date().getFullYear());
  const [years, setYears]           = useState<number[]>([]);
  const [monthly, setMonthly]       = useState<MonthlyTotal[]>([]);
  const [search, setSearch]         = useState('');
  const [message, setMessage]       = useState('');
  const [busy, setBusy]             = useState(false);
  const [editingNew, setEditingNew] = useState(false);
  const [draft, setDraft]           = useState<CuentaDraft>(EMPTY_ACCOUNT);
  const [regDraft, setRegDraft]     = useState<RegisterDraft | null>(null);
  const [adding, setAdding]         = useState(false);

  const active = accounts.find((account) => account.id === activeId) || null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const load = async (preferredId?: number) => {
    try {
      const result   = await window.tools.cuentasList();
      const selected =
        result.find((account) => account.id === (preferredId ?? activeId)) || result[0] || null;
      setAccounts(result);
      setActiveId(selected?.id ?? null);
      if (selected) {
        setDraft({ name: selected.name, description: selected.description, columns: selected.columns });
      } else {
        setRegisters([]);
        setMonthly([]);
        setYears([]);
      }
    } catch (error) {
      setMessage(String(error));
    }
  };

  const reloadData = async () => {
    if (!activeId) return;
    try {
      const [list, ys, empty] = await Promise.all([
        window.tools.cuentasRegisters(activeId, search),
        window.tools.cuentasYears(activeId),
        window.tools.cuentasMonthly(activeId, year),
      ]);
      const current           = new Date().getFullYear();
      const available         = Array.from(new Set([current, ...ys]));
      const activeYear        = available.includes(year) ? year : current;
      const totals            = available.includes(year) ? empty : await window.tools.cuentasMonthly(activeId, activeYear);
      setRegisters(list);
      setYears(available);
      setMonthly(totals);
      setYear(activeYear);
    } catch (error) {
      setMessage(String(error));
    }
  };

  useEffect(() => {
    window.tools
      .cuentasList()
      .then((result) => {
        const selected = result[0] || null;
        setAccounts(result);
        setActiveId(selected?.id ?? null);
        if (selected) {
          setDraft({
            name:        selected.name,
            description: selected.description,
            columns:     selected.columns,
          });
        } else {
          setRegisters([]);
          setMonthly([]);
          setYears([]);
        }
      })
      .catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    window.tools
      .cuentasRegisters(activeId, search)
      .then((list) => {
        if (!cancelled) setRegisters(list);
      })
      .catch((error) => {
        if (!cancelled) setMessage(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, search]);

  useEffect(() => {
    if (!activeId) return;
    window.tools
      .cuentasYears(activeId)
      .then((ys) => {
        const current   = new Date().getFullYear();
        const available = Array.from(new Set([current, ...ys]));
        setYears(available);
        setYear((previous) => (available.includes(previous) ? previous : current));
      })
      .catch((error) => setMessage(String(error)));
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    window.tools
      .cuentasMonthly(activeId, year)
      .then(setMonthly)
      .catch((error) => setMessage(String(error)));
  }, [activeId, year]);

  const saveAccount = () =>
    run(async () => {
      const saved = editingNew
        ? await window.tools.cuentasCreate(draft)
        : await window.tools.cuentasUpdate(activeId as number, draft);
      await load(saved.id);
      setEditingNew(false);
      setView('grafico');
      setMessage(editingNew ? 'Cuenta creada.' : 'Cuenta actualizada.');
    });

  const removeAccount = () => {
    if (!active) return;
    if (!window.confirm(`¿Eliminar la cuenta "${active.name}" y todos sus movimientos?`)) return;
    run(async () => {
      await window.tools.cuentasDelete(active.id);
      setRegisters([]);
      setMonthly([]);
      setYears([]);
      await load();
      setEditingNew(false);
      setView('grafico');
      setMessage('Cuenta eliminada.');
    });
  };

  const moveAccount = (id: number, delta: -1 | 1) =>
    run(async () => {
      const ordered = [...accounts];
      const index   = ordered.findIndex((account) => account.id === id);
      const next    = index + delta;
      if (index < 0 || next < 0 || next >= ordered.length) return;
      [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
      await window.tools.cuentasReorder(ordered.map((account) => account.id));
      await load(id);
      setMessage('Orden de pestañas actualizado.');
    });

  const saveRegister = () =>
    run(async () => {
      if (!active || !regDraft) return;
      const payload = {
        name:   regDraft.name,
        date:   regDraft.date,
        amount: Number(regDraft.amount),
        values: regDraft.values,
      };
      if (regDraft.id) {
        await window.tools.cuentasRegisterUpdate(regDraft.id, payload);
        setMessage('Movimiento actualizado.');
      } else {
        await window.tools.cuentasRegisterCreate({ accountId: active.id, ...payload });
        setMessage('Movimiento agregado.');
      }
      setRegDraft(null);
      setAdding(false);
      await reloadData();
    });

  const removeRegister = (register: CuentaRegister) => {
    if (!window.confirm(`¿Eliminar el movimiento "${register.name}"?`)) return;
    run(async () => {
      await window.tools.cuentasRegisterDelete(register.id);
      await reloadData();
      setMessage('Movimiento eliminado.');
    });
  };

  const editRegister = (register: CuentaRegister) => {
    setRegDraft({ ...register, amount: String(register.amount) });
    setAdding(true);
  };

  const cancelRegister = () => {
    setRegDraft(null);
    setAdding(false);
  };

  const newRegister = () => {
    setRegDraft({ name: '', date: todayLocal(), amount: '', values: {} });
    setAdding(true);
  };

  return (
    <section className="tool cuentas-tool">
      <header>
        <span>CT</span>
        <div>
          <h1>Cuentas</h1>
          <p>Control de gastos, pagos y ahorros por cuenta.</p>
        </div>
        <b>● SQLite local</b>
      </header>
      <div className="cuentas-tabs">
        <button className={view === 'grafico' ? 'active' : ''} onClick={() => setView('grafico')}>
          Gráfico
        </button>
        <button
          className={view === 'movimientos' ? 'active' : ''}
          onClick={() => setView('movimientos')}
        >
          Movimientos <b>{registers.length}</b>
        </button>
        <button
          className={view === 'configurar' ? 'active' : ''}
          onClick={() => setView('configurar')}
        >
          Configurar cuenta
        </button>
      </div>
      <div className="workspace cuentas-workspace">
        <div className="cuentas-selector">
          <div>
            {accounts.map((account) => (
              <button
                key={account.id}
                className={account.id === activeId && !editingNew ? 'active' : ''}
                onClick={() => {
                  setActiveId(account.id);
                  setEditingNew(false);
                  setRegDraft(null);
                  setAdding(false);
                  setDraft({
                    name:        account.name,
                    description: account.description,
                    columns:     account.columns,
                  });
                }}
              >
                {account.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setEditingNew(true);
              setDraft(EMPTY_ACCOUNT);
              setActiveId(null);
              setView('configurar');
            }}
          >
            + Nueva cuenta
          </button>
        </div>
        {message && <p className="cuentas-message">{message}</p>}
        {view === 'grafico' ? (
          <ChartPanel
            account={active}
            totals={monthly}
            year={year}
            years={years}
            onYearChange={setYear}
            isEmpty={monthly.length === 0 || monthly.every((total) => total.count === 0) || !active}
          />
        ) : view === 'movimientos' ? (
          <MovementsPanel
            account={active}
            registers={registers}
            search={search}
            setSearch={setSearch}
            adding={adding}
            regDraft={regDraft}
            setRegDraft={setRegDraft}
            saveRegister={saveRegister}
            editRegister={editRegister}
            removeRegister={removeRegister}
            cancelRegister={cancelRegister}
            newRegister={newRegister}
          />
        ) : (
          <CuentasEditor
            draft={draft}
            setDraft={setDraft}
            isNew={editingNew}
            canDelete={!!active && !editingNew}
            busy={busy}
            save={saveAccount}
            remove={removeAccount}
            accounts={accounts}
            activeId={activeId}
            onMove={moveAccount}
          />
        )}
      </div>
    </section>
  );
}

function ChartPanel({ account, totals, year, years, onYearChange, isEmpty }: {
  account: Cuenta | null;
  totals: MonthlyTotal[];
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
  isEmpty: boolean;
}) {
  if (!account) {
    return (
      <div className="cuentas-empty">
        <b>Sin cuentas</b>
        <strong>Crea una cuenta en "Configurar cuenta" para empezar a cargar movimientos.</strong>
      </div>
    );
  }
  const maxAbs = Math.max(1, ...totals.map((total) => Math.abs(total.total)));
  return (
    <>
      <div className="cuentas-chart-head">
        <h2>Variación mensual · {account.name}</h2>
        <label className="cuentas-year">
          Año
          <select value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isEmpty ? (
        <div className="cuentas-empty">
          <b>Sin movimientos en {year}</b>
          <strong>Agregá movimientos en la pestaña "Movimientos" para ver el gráfico.</strong>
        </div>
      ) : (
        <div className="cuentas-chart">
          <div className="cuentas-chart-zero" />
          {totals.map((total) => {
            const height               = `${(Math.abs(total.total) / maxAbs) * 88}%`;
            const style: CSSProperties =
              total.total >= 0 ? { height, bottom: '50%' } : { height, top: '50%' };
            return (
              <div
                key={total.month}
                className="cuentas-chart-col"
                title={`${MONTH_NAMES[total.month - 1]} ${year}: ${formatAmount(total.total)} (${total.count} registro${total.count === 1 ? '' : 's'})`}
              >
                <div className={`cuentas-chart-bar ${total.total >= 0 ? 'pos' : 'neg'}`} style={style} />
                <span>{MONTH_NAMES[total.month - 1]}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function MovementsPanel({ account, registers, search, setSearch, adding, regDraft, setRegDraft,
  saveRegister, editRegister, removeRegister, cancelRegister, newRegister }: {
  account: Cuenta | null;
  registers: CuentaRegister[];
  search: string;
  setSearch: (value: string) => void;
  adding: boolean;
  regDraft: RegisterDraft | null;
  setRegDraft: (draft: RegisterDraft) => void;
  saveRegister: () => void;
  editRegister: (register: CuentaRegister) => void;
  removeRegister: (register: CuentaRegister) => void;
  cancelRegister: () => void;
  newRegister: () => void;
}) {
  if (!account) {
    return (
      <div className="cuentas-empty">
        <b>Sin cuentas</b>
        <strong>Crea una cuenta en "Configurar cuenta" para registrar movimientos.</strong>
      </div>
    );
  }
  return (
    <div className="cuentas-movimientos">
      <div className="cuentas-toolbar">
        <input
          value={search}
          placeholder="Buscar movimiento..."
          onChange={(event) => setSearch(event.target.value)}
        />
        <button className="cuentas-add-register" onClick={newRegister}>
          + Nuevo movimiento
        </button>
      </div>
      {adding && regDraft && (
        <RegisterForm
          account={account}
          draft={regDraft}
          setDraft={setRegDraft}
          save={saveRegister}
          cancel={cancelRegister}
        />
      )}
      {!adding && registers.length === 0 && (
        <div className="cuentas-empty">
          <b>Sin movimientos</b>
          <strong>Presioná "+ Nuevo movimiento" para registrar un gasto, pago o ahorro.</strong>
        </div>
      )}
      {registers.length > 0 && (
        <table className="cuentas-register-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              {account.columns.map((column) => (
                <th key={column.name}>{column.label}</th>
              ))}
              <th className="right">Monto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {registers.map((register) => (
              <tr key={register.id}>
                <td>{register.date}</td>
                <td>
                  <b>{register.name}</b>
                </td>
                {account.columns.map((column) => (
                  <td key={column.name}>{formatValue(column, register.values[column.name])}</td>
                ))}
                <td className={`cuentas-amount ${register.amount >= 0 ? 'pos' : 'neg'}`}>
                  {formatAmount(register.amount)}
                </td>
                <td className="cuentas-row-actions">
                  <button onClick={() => editRegister(register)}>Editar</button>
                  <button onClick={() => removeRegister(register)}>Quitar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RegisterForm({ account, draft, setDraft, save, cancel }: {
  account: Cuenta;
  draft: RegisterDraft;
  setDraft: (draft: RegisterDraft) => void;
  save: () => void;
  cancel: () => void;
}) {
  const set      = (patch: Partial<RegisterDraft>) => setDraft({ ...draft, ...patch });
  const setValue = (name: string, value: unknown) =>
    setDraft({ ...draft, values: { ...draft.values, [name]: value } });
  return (
    <div className="cuentas-register-form">
      <div className="cuentas-form-grid">
        <label className="wide">
          Concepto
          <input
            value={draft.name}
            placeholder="p. ej. Supermercado, Sueldo, Cuota..."
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label>
          Fecha
          <input type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />
        </label>
        <label>
          Monto
          <input
            type="number"
            step="any"
            value={draft.amount}
            placeholder="0"
            onChange={(event) => set({ amount: event.target.value })}
          />
          <small>Negativo = gasto · Positivo = ingreso o ahorro.</small>
        </label>
        {account.columns.map((column) => (
          <CuentaColumnInput
            key={column.name}
            column={column}
            value={draft.values[column.name]}
            onChange={(value) => setValue(column.name, value)}
          />
        ))}
      </div>
      <div className="cuentas-actions">
        <button className="cuentas-save" onClick={save}>
          Guardar movimiento
        </button>
        <button onClick={cancel}>Cancelar</button>
      </div>
    </div>
  );
}

function CuentaColumnInput({ column, value, onChange }: {
  column: CuentaColumn;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (column.type === 'boolean') {
    return (
      <label className="cuentas-check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {column.label}
      </label>
    );
  }
  if (column.type === 'tags') {
    const tags = Array.isArray(value) ? value.join(', ') : strValue(value);
    return (
      <label>
        {column.label}
        <input
          value={tags}
          placeholder="separadas por comas"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }
  const raw = column.type === 'date' && typeof value === 'string' ? value.slice(0, 10) : strValue(value);
  return (
    <label>
      {column.label}
      <input
        type={
          column.type === 'number' ? 'number'
            : column.type === 'date' ? 'date'
              : column.type === 'url' ? 'url'
                : 'text'
        }
        value={raw}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function CuentasEditor({ draft, setDraft, isNew, canDelete, busy, save, remove, accounts, activeId,
  onMove }: {
  draft: CuentaDraft;
  setDraft: (draft: CuentaDraft) => void;
  isNew: boolean;
  canDelete: boolean;
  busy: boolean;
  save: () => void;
  remove: () => void;
  accounts: Cuenta[];
  activeId: number | null;
  onMove: (id: number, delta: -1 | 1) => void;
}) {
  const addColumn    = () =>
    setDraft({
      ...draft,
      columns: [
        ...draft.columns,
        { name: `campo_${draft.columns.length + 1}`, label: 'Nuevo campo', type: 'string', required: false },
      ],
    });
  const updateColumn = (index: number, patch: Partial<CuentaColumn>) =>
    setDraft({
      ...draft,
      columns: draft.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    });
  const removeColumn = (index: number) =>
    setDraft({ ...draft, columns: draft.columns.filter((_, i) => i !== index) });
  return (
    <div className="cuentas-editor">
      <section>
        <header>
          <h2>{isNew ? 'Nueva cuenta' : 'Editar cuenta'}</h2>
          <p>Los campos personalizados se aplican a cada movimiento de esta cuenta.</p>
        </header>
        <div className="cuentas-form-grid">
          <label>
            Nombre
            <input
              value={draft.name}
              placeholder="p. ej. Tarjeta Visa, Efectivo, Ahorros..."
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Descripción
            <input
              value={draft.description}
              placeholder="Detalle opcional"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
        </div>
        <div className="cuentas-columns">
          <h3>Campos personalizados</h3>
          {draft.columns.length === 0 ? (
            <p className="cuentas-columns-empty">No hay campos personalizados.</p>
          ) : (
            draft.columns.map((column, index) => (
              <div key={column.name}>
                <label>
                  Etiqueta
                  <input
                    value={column.label}
                    onChange={(event) => updateColumn(index, { label: event.target.value })}
                  />
                </label>
                <label>
                  Clave
                  <input
                    value={column.name}
                    placeholder="clave_interna"
                    onChange={(event) => updateColumn(index, { name: event.target.value })}
                  />
                </label>
                <label>
                  Tipo
                  <select
                    value={column.type}
                    onChange={(event) =>
                      updateColumn(index, { type: event.target.value as CuentaColumnType })
                    }
                  >
                    {Object.entries(TYPE_LABELS).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cuentas-check">
                  <input
                    type="checkbox"
                    checked={column.required}
                    onChange={(event) => updateColumn(index, { required: event.target.checked })}
                  />
                  Obligatorio
                </label>
                <button onClick={() => removeColumn(index)}>Quitar</button>
              </div>
            ))
          )}
          <button className="cuentas-add-column" onClick={addColumn}>
            + Agregar campo
          </button>
        </div>
        {!isNew && (
          <div className="cuentas-reorder">
            <h3>Orden de pestañas</h3>
            <div>
              {accounts.map((account, index) => (
                <div key={account.id} className={account.id === activeId ? 'active' : ''}>
                  <span>{account.name}</span>
                  <button disabled={index === 0} onClick={() => onMove(account.id, -1)}>
                    ▲
                  </button>
                  <button disabled={index === accounts.length - 1} onClick={() => onMove(account.id, 1)}>
                    ▼
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="cuentas-actions">
          {canDelete && (
            <button className="cuentas-danger" onClick={remove} disabled={busy}>
              Eliminar cuenta
            </button>
          )}
          <button className="cuentas-save" onClick={save} disabled={busy}>
            {isNew ? 'Crear cuenta' : 'Guardar cambios'}
          </button>
        </div>
      </section>
    </div>
  );
}