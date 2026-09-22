import { useMemo, useRef, useState } from 'react';

type Ops = {
  search: string;
  replace: string;
  backwardFind: string;
  backwardReplace: string;
  forwardFind: string;
  forwardReplace: string;
  prefix: string;
  suffix: string;
};
const INITIAL: Ops = {
  search: '',
  replace: '',
  backwardFind: '',
  backwardReplace: '',
  forwardFind: '',
  forwardReplace: '',
  prefix: '',
  suffix: '',
};
type Entry = { folder: string; name: string };
const key = (entry: Entry) => `${entry.folder}\u0000${entry.name}`;
function splitExtension(file: string, keepExtension: boolean) {
  if (!keepExtension) return { base: file, ext: '' };
  const i = file.lastIndexOf('.');
  return i > 0 ? { base: file.slice(0, i), ext: file.slice(i) } : { base: file, ext: '' };
}
function transform(file: string, o: Ops, keepExtension: boolean) {
  const { base, ext } = splitExtension(file, keepExtension);
  let name = o.search ? base.replaceAll(o.search, o.replace) : base;
  if (o.backwardFind) {
    const index = name.indexOf(o.backwardFind);
    if (index >= 0) name = o.backwardReplace + name.slice(index + o.backwardFind.length);
  }
  if (o.forwardFind) {
    const index = name.lastIndexOf(o.forwardFind);
    if (index >= 0) name = name.slice(0, index) + o.forwardReplace;
  }
  return o.prefix + name + o.suffix + ext;
}
// Divide el texto pegado en una columna de nombres en un valor por línea; se
// respetan líneas vacías para no desalinear la correspondencia con las filas.
function columnValues(raw: string): string[] {
  return raw.split(/\r?\n/);
}

type RenameKind = 'files' | 'folders';
type Tab = RenameKind | 'builder';

export default function RenameTool() {
  const [tab, setTab] = useState<Tab>('files');
  return (
    <section className="tool rename-tool">
      <header>
        <span>RF</span>
        <div>
          <h1>Renombrar archivos</h1>
          <p>Transforma nombres en lote con una vista previa segura.</p>
        </div>
        <b>● Operaciones locales</b>
      </header>
      <div className="download-tabs">
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
          Archivos
        </button>
        <button className={tab === 'folders' ? 'active' : ''} onClick={() => setTab('folders')}>
          Carpetas
        </button>
        <button className={tab === 'builder' ? 'active' : ''} onClick={() => setTab('builder')}>
          Crear nombres
        </button>
      </div>
      <div className="workspace">
        <div style={{ display: tab === 'files' ? 'block' : 'none' }}>
          <BatchRenameTab mode="files" />
        </div>
        <div style={{ display: tab === 'folders' ? 'block' : 'none' }}>
          <BatchRenameTab mode="folders" />
        </div>
        <div style={{ display: tab === 'builder' ? 'block' : 'none' }}>
          <NameBuilderTab />
        </div>
      </div>
    </section>
  );
}

function BatchRenameTab({ mode }: { mode: RenameKind }) {
  const isFiles = mode === 'files';
  const noun = isFiles ? 'archivos' : 'carpetas';
  const [directories, setDirectories] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ops, setOps] = useState<Ops>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const list = () =>
    isFiles ? window.tools.list(directories) : window.tools.listFolders(directories);
  const renames = useMemo(
    () => entries.map((entry) => ({ ...entry, newName: transform(entry.name, ops, isFiles) })),
    [entries, ops, isFiles],
  );
  const changed = renames.filter((x) => selected.has(key(x)) && x.name !== x.newName).length;
  const multi = directories.length > 1;
  const addFolders = async () => {
    const paths = await window.tools.selectRenameFolders();
    if (paths.length) {
      setDirectories((current) => [...new Set([...current, ...paths])]);
      setEntries([]);
      setSelected(new Set());
    }
  };
  const clear = () => {
    setDirectories([]);
    setEntries([]);
    setSelected(new Set());
  };
  const removeFolder = (folder: string) => {
    setDirectories((current) => current.filter((item) => item !== folder));
    setEntries([]);
    setSelected(new Set());
  };
  const load = async () => {
    setBusy(true);
    const found = await list();
    setEntries(found);
    setSelected(new Set(found.map(key)));
    setBusy(false);
  };
  const execute = async () => {
    setBusy(true);
    let count = 0;
    for (const item of renames)
      if (selected.has(key(item)) && item.name !== item.newName) {
        try {
          await window.tools.rename({
            folder: item.folder,
            oldName: item.name,
            newName: item.newName,
          });
          count++;
        } catch (error) {
          console.error(error);
        }
      }
    setMessage(`${count} ${noun} renombrados.`);
    const found = await list();
    setEntries(found);
    setSelected(new Set(found.map(key)));
    setBusy(false);
  };
  const update = (field: keyof Ops) => (value: string) =>
    setOps((current) => ({ ...current, [field]: value }));
  return (
    <>
      <div className="step">
        <span>01</span>
        <div>
          <h2>Selecciona las carpetas</h2>
          <p>
            Puedes renombrar {noun} de varias carpetas en una ejecución.
            {!isFiles && ' Se listan las subcarpetas directas de cada carpeta elegida.'}
          </p>
        </div>
      </div>
      <div className="rename-toolbar">
        <button disabled={busy} onClick={addFolders}>
          + Añadir carpetas
        </button>
        <button disabled={!directories.length || busy} onClick={clear}>
          Limpiar
        </button>
        <button className="primary" disabled={!directories.length || busy} onClick={load}>
          Listar {noun}
        </button>
      </div>
      <div className="rename-folders">
        {directories.length ? (
          directories.map((folder) => (
            <div key={folder}>
              <span title={folder}>{folder}</span>
              <button disabled={busy} onClick={() => removeFolder(folder)}>
                Quitar
              </button>
            </div>
          ))
        ) : (
          <p>No hay carpetas seleccionadas.</p>
        )}
      </div>
      <div className="divider" />
      <div className="step">
        <span>02</span>
        <div>
          <h2>Configura las transformaciones</h2>
          <p>
            {isFiles
              ? 'Las extensiones se conservan sin modificaciones.'
              : 'Los nombres se transforman completos.'}
          </p>
        </div>
      </div>
      <div className="rename-options">
        <Row
          label="Buscar y reemplazar"
          first={ops.search}
          second={ops.replace}
          setFirst={update('search')}
          setSecond={update('replace')}
        />
        <Row
          label="Desde texto hacia atrás"
          first={ops.backwardFind}
          second={ops.backwardReplace}
          setFirst={update('backwardFind')}
          setSecond={update('backwardReplace')}
        />
        <Row
          label="Desde texto hacia adelante"
          first={ops.forwardFind}
          second={ops.forwardReplace}
          setFirst={update('forwardFind')}
          setSecond={update('forwardReplace')}
        />
        <Row
          label="Añadir al nombre"
          first={ops.prefix}
          second={ops.suffix}
          setFirst={update('prefix')}
          setSecond={update('suffix')}
          prefix
        />
      </div>
      <div className="results rename-results">
        <div>
          <label>
            <input
              type="checkbox"
              checked={entries.length > 0 && selected.size === entries.length}
              onChange={() =>
                setSelected(
                  selected.size === entries.length ? new Set() : new Set(entries.map(key)),
                )
              }
            />{' '}
            {entries.length} {noun}
          </label>
          <span>{changed} cambiarán</span>
        </div>
        <section>
          {renames.map((x) => (
            <label key={key(x)}>
              <input
                type="checkbox"
                checked={selected.has(key(x))}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(key(x))) next.delete(key(x));
                  else next.add(key(x));
                  setSelected(next);
                }}
              />
              <span>
                <strong>{x.name}</strong>
                <small>{x.name === x.newName ? 'Sin cambios' : `→ ${x.newName}`}</small>
                {multi && <small className="g">{x.folder}</small>}
              </span>
            </label>
          ))}
        </section>
      </div>
      <div className="tool-action simple">
        <span>{message || 'Revisa la vista previa antes de aplicar.'}</span>
        <button disabled={!changed || busy} onClick={execute}>
          Renombrar {changed || ''} {noun} →
        </button>
      </div>
    </>
  );
}
function Row({
  label,
  first,
  second,
  setFirst,
  setSecond,
  prefix,
}: {
  label: string;
  first: string;
  second: string;
  setFirst: (x: string) => void;
  setSecond: (x: string) => void;
  prefix?: boolean;
}) {
  return (
    <div>
      <strong>{label}</strong>
      <span className="rename-input-clear">
        <input
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          placeholder={prefix ? 'Prefijo' : 'Texto a buscar'}
        />
        {first && (
          <button
            type="button"
            title="Limpiar"
            aria-label={`Limpiar ${label}`}
            onClick={() => setFirst('')}
          >
            ×
          </button>
        )}
      </span>
      <i>→</i>
      <span className="rename-input-clear">
        <input
          value={second}
          onChange={(e) => setSecond(e.target.value)}
          placeholder={prefix ? 'Sufijo' : 'Reemplazar por'}
        />
        {second && (
          <button
            type="button"
            title="Limpiar"
            aria-label={`Limpiar ${label}`}
            onClick={() => setSecond('')}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

type NameColumn = { id: string; label: string; raw: string };

// Pestaña "Crear nombres": genera una tabla temporal (solo vive en memoria
// mientras se navega dentro de Renombrar archivos) para listar archivos o
// carpetas de varias rutas y combinar columnas de nombres pegadas por el
// usuario en un nuevo nombre por fila.
function NameBuilderTab() {
  const [mode, setMode] = useState<RenameKind>('files');
  const [directories, setDirectories] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [columns, setColumns] = useState<NameColumn[]>([]);
  const [combineEnabled, setCombineEnabled] = useState(false);
  const [sameJoin, setSameJoin] = useState(true);
  const [sharedJoin, setSharedJoin] = useState('');
  const [joinByColumn, setJoinByColumn] = useState<Record<string, string>>({});
  const columnCounter = useRef(0);
  const noun = mode === 'files' ? 'archivos' : 'carpetas';
  const multi = directories.length > 1;

  const list = () =>
    mode === 'files' ? window.tools.list(directories) : window.tools.listFolders(directories);
  const resetList = () => {
    setEntries([]);
    setSelected(new Set());
  };
  const changeMode = (next: RenameKind) => {
    if (next === mode) return;
    setMode(next);
    resetList();
  };
  const addFolders = async () => {
    const paths = await window.tools.selectRenameFolders();
    if (paths.length) {
      setDirectories((current) => [...new Set([...current, ...paths])]);
      resetList();
    }
  };
  const clearFolders = () => {
    setDirectories([]);
    resetList();
  };
  const removeFolder = (folder: string) => {
    setDirectories((current) => current.filter((item) => item !== folder));
    resetList();
  };
  const load = async () => {
    setBusy(true);
    const found = await list();
    setEntries(found);
    setSelected(new Set(found.map(key)));
    setBusy(false);
  };
  const addColumn = () => {
    columnCounter.current += 1;
    const id = `col-${columnCounter.current}`;
    setColumns((current) => [
      ...current,
      { id, label: `Columna nombre ${current.length + 1}`, raw: '' },
    ]);
  };
  const updateColumnRaw = (id: string, raw: string) =>
    setColumns((current) =>
      current.map((column) => (column.id === id ? { ...column, raw } : column)),
    );
  const updateColumnLabel = (id: string, label: string) =>
    setColumns((current) =>
      current.map((column) => (column.id === id ? { ...column, label } : column)),
    );
  const removeColumn = (id: string) => {
    setColumns((current) => current.filter((column) => column.id !== id));
    setJoinByColumn((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const computeNewName = (entry: Entry, index: number) => {
    const { base, ext } = splitExtension(entry.name, mode === 'files');
    let newBase = base;
    if (combineEnabled)
      for (const column of columns) {
        const value = columnValues(column.raw)[index] ?? '';
        const prefix = columns.length > 1 && sameJoin ? sharedJoin : joinByColumn[column.id] || '';
        newBase += prefix + value;
      }
    return newBase + ext;
  };
  const rows = useMemo(
    () => entries.map((entry, index) => ({ ...entry, newName: computeNewName(entry, index) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, columns, combineEnabled, sameJoin, sharedJoin, joinByColumn, mode],
  );
  const changed = rows.filter((x) => selected.has(key(x)) && x.name !== x.newName).length;
  const execute = async () => {
    setBusy(true);
    let count = 0;
    for (const item of rows)
      if (selected.has(key(item)) && item.name !== item.newName) {
        try {
          await window.tools.rename({
            folder: item.folder,
            oldName: item.name,
            newName: item.newName,
          });
          count++;
        } catch (error) {
          console.error(error);
        }
      }
    setMessage(`${count} ${noun} renombrados.`);
    const found = await list();
    setEntries(found);
    setSelected(new Set(found.map(key)));
    setBusy(false);
  };
  const columnCount = columns.length;
  return (
    <>
      <div className="step">
        <span>01</span>
        <div>
          <h2>Elige qué listar</h2>
          <p>Genera una tabla temporal para combinar nombres antes de renombrar.</p>
        </div>
      </div>
      <div className="builder-type-toggle">
        <button
          className={mode === 'files' ? 'active' : ''}
          disabled={busy}
          onClick={() => changeMode('files')}
        >
          Archivos
        </button>
        <button
          className={mode === 'folders' ? 'active' : ''}
          disabled={busy}
          onClick={() => changeMode('folders')}
        >
          Carpetas
        </button>
      </div>
      <div className="rename-toolbar">
        <button disabled={busy} onClick={addFolders}>
          + Añadir carpetas
        </button>
        <button disabled={!directories.length || busy} onClick={clearFolders}>
          Limpiar
        </button>
        <button className="primary" disabled={!directories.length || busy} onClick={load}>
          Listar {noun}
        </button>
      </div>
      <div className="rename-folders">
        {directories.length ? (
          directories.map((folder) => (
            <div key={folder}>
              <span title={folder}>{folder}</span>
              <button disabled={busy} onClick={() => removeFolder(folder)}>
                Quitar
              </button>
            </div>
          ))
        ) : (
          <p>No hay carpetas seleccionadas.</p>
        )}
      </div>
      <div className="divider" />
      <div className="step">
        <span>02</span>
        <div>
          <h2>Agrega columnas de nombres</h2>
          <p>
            Pega un nombre por línea en cada columna; cada línea corresponde a una fila de la tabla.
          </p>
        </div>
      </div>
      <div className="builder-toolbar">
        <button type="button" onClick={addColumn}>
          + Agregar columna nombre
        </button>
        {columnCount > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={combineEnabled}
              onChange={(event) => setCombineEnabled(event.target.checked)}
            />{' '}
            Combinar nombres
          </label>
        )}
        {combineEnabled && columnCount > 1 && (
          <label className="check">
            <input
              type="checkbox"
              checked={sameJoin}
              onChange={(event) => setSameJoin(event.target.checked)}
            />{' '}
            Usar el mismo prefijo para todas las columnas
          </label>
        )}
      </div>
      {combineEnabled && columnCount > 0 && (
        <div className="builder-join">
          {columnCount > 1 && sameJoin ? (
            <label>
              Prefijo de unión
              <input
                value={sharedJoin}
                onChange={(event) => setSharedJoin(event.target.value)}
                placeholder='Ej: " " o "-X-"'
              />
            </label>
          ) : (
            columns.map((column) => (
              <label key={column.id}>
                Prefijo para «{column.label}»
                <input
                  value={joinByColumn[column.id] || ''}
                  onChange={(event) =>
                    setJoinByColumn((current) => ({ ...current, [column.id]: event.target.value }))
                  }
                  placeholder='Ej: " " o "-X-"'
                />
              </label>
            ))
          )}
        </div>
      )}
      <div className="builder-grid-wrap">
        <table className="builder-grid">
          <thead>
            <tr>
              <th className="builder-check">
                <input
                  type="checkbox"
                  checked={entries.length > 0 && selected.size === entries.length}
                  onChange={() =>
                    setSelected(
                      selected.size === entries.length ? new Set() : new Set(entries.map(key)),
                    )
                  }
                />
              </th>
              {multi && <th>Carpeta</th>}
              <th>Nombre original</th>
              {columns.map((column) => (
                <th key={column.id}>
                  <div className="builder-column-head">
                    <input
                      className="builder-column-label"
                      value={column.label}
                      onChange={(event) => updateColumnLabel(column.id, event.target.value)}
                    />
                    <button
                      type="button"
                      title="Quitar columna"
                      aria-label={`Quitar ${column.label}`}
                      onClick={() => removeColumn(column.id)}
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    className="builder-column-input"
                    value={column.raw}
                    onChange={(event) => updateColumnRaw(column.id, event.target.value)}
                    placeholder={'Pega un nombre por línea...'}
                  />
                </th>
              ))}
              <th>Nuevo nombre</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={key(row)}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(key(row))}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(key(row))) next.delete(key(row));
                        else next.add(key(row));
                        setSelected(next);
                      }}
                    />
                  </td>
                  {multi && <td title={row.folder}>{row.folder}</td>}
                  <td>{row.name}</td>
                  {columns.map((column) => (
                    <td key={column.id}>{columnValues(column.raw)[index] ?? ''}</td>
                  ))}
                  <td className={row.name === row.newName ? '' : 'builder-changed'}>
                    {row.newName}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="builder-empty" colSpan={3 + columns.length + (multi ? 1 : 0)}>
                  Lista {noun} para comenzar la tabla temporal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tool-action simple">
        <span>{message || 'Revisa la vista previa antes de aplicar.'}</span>
        <button disabled={!changed || busy} onClick={execute}>
          Renombrar {changed || ''} {noun} →
        </button>
      </div>
    </>
  );
}
