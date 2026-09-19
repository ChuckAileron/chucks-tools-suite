import { useMemo, useState } from 'react';
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
function transform(file: string, o: Ops) {
  const i = file.lastIndexOf('.'),
    base = i > 0 ? file.slice(0, i) : file,
    ext = i > 0 ? file.slice(i) : '';
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
export default function RenameTool() {
  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ops, setOps] = useState<Ops>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const renames = useMemo(
    () => files.map((entry) => ({ ...entry, newName: transform(entry.name, ops) })),
    [files, ops],
  );
  const changed = renames.filter((x) => selected.has(key(x)) && x.name !== x.newName).length;
  const multi = directories.length > 1;
  const addFolders = async () => {
    const paths = await window.tools.selectRenameFolders();
    if (paths.length) {
      setDirectories((current) => [...new Set([...current, ...paths])]);
      setFiles([]);
      setSelected(new Set());
    }
  };
  const clear = () => {
    setDirectories([]);
    setFiles([]);
    setSelected(new Set());
  };
  const removeFolder = (folder: string) => {
    setDirectories((current) => current.filter((item) => item !== folder));
    setFiles([]);
    setSelected(new Set());
  };
  const load = async () => {
    setBusy(true);
    const list = await window.tools.list(directories);
    setFiles(list);
    setSelected(new Set(list.map(key)));
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
    setMessage(`${count} archivos renombrados.`);
    const list = await window.tools.list(directories);
    setFiles(list);
    setSelected(new Set(list.map(key)));
    setBusy(false);
  };
  const update = (key: keyof Ops) => (value: string) =>
    setOps((current) => ({ ...current, [key]: value }));
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
      <div className="workspace">
        <div className="step">
          <span>01</span>
          <div>
            <h2>Selecciona las carpetas</h2>
            <p>Puedes renombrar archivos de varias carpetas en una ejecución.</p>
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
            Listar archivos
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
            <p>Las extensiones se conservan sin modificaciones.</p>
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
                checked={files.length > 0 && selected.size === files.length}
                onChange={() =>
                  setSelected(selected.size === files.length ? new Set() : new Set(files.map(key)))
                }
              />{' '}
              {files.length} archivos
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
            Renombrar {changed || ''} archivos →
          </button>
        </div>
      </div>
    </section>
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
      <input
        value={first}
        onChange={(e) => setFirst(e.target.value)}
        placeholder={prefix ? 'Prefijo' : 'Texto a buscar'}
      />
      <i>→</i>
      <input
        value={second}
        onChange={(e) => setSecond(e.target.value)}
        placeholder={prefix ? 'Sufijo' : 'Reemplazar por'}
      />
    </div>
  );
}
