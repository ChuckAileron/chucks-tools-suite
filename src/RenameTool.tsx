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
  const [directory, setDirectory] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ops, setOps] = useState<Ops>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const renames = useMemo(
    () => files.map((oldName) => ({ oldName, newName: transform(oldName, ops) })),
    [files, ops],
  );
  const changed = renames.filter((x) => selected.has(x.oldName) && x.oldName !== x.newName).length;
  const choose = async () => {
    const path = await window.tools.selectDirectory();
    if (path) {
      setDirectory(path);
      setFiles([]);
    }
  };
  const load = async () => {
    setBusy(true);
    const list = await window.tools.list(directory);
    setFiles(list);
    setSelected(new Set(list));
    setBusy(false);
  };
  const execute = async () => {
    setBusy(true);
    let count = 0;
    for (const item of renames)
      if (selected.has(item.oldName) && item.oldName !== item.newName) {
        try {
          await window.tools.rename({ directory, ...item });
          count++;
        } catch (error) {
          console.error(error);
        }
      }
    setMessage(`${count} archivos renombrados.`);
    const list = await window.tools.list(directory);
    setFiles(list);
    setSelected(new Set(list));
    setBusy(false);
  };
  const update = (key: keyof Ops) => (value: string) =>
    setOps((current) => ({ ...current, [key]: value }));
  return (
    <section className="tool">
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
            <h2>Selecciona una carpeta</h2>
            <p>Se mostrarán los archivos del nivel actual.</p>
          </div>
        </div>
        <div className="path single">
          <i>⌑</i>
          <span>
            <strong>Carpeta de trabajo</strong>
            <small>{directory || 'Ninguna carpeta seleccionada'}</small>
          </span>
          <button onClick={choose}>Elegir</button>
          <button disabled={!directory || busy} onClick={load}>
            Listar archivos
          </button>
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
                  setSelected(selected.size === files.length ? new Set() : new Set(files))
                }
              />{' '}
              {files.length} archivos
            </label>
            <span>{changed} cambiarán</span>
          </div>
          <section>
            {renames.map((x) => (
              <label key={x.oldName}>
                <input
                  type="checkbox"
                  checked={selected.has(x.oldName)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(x.oldName)) next.delete(x.oldName);
                    else next.add(x.oldName);
                    setSelected(next);
                  }}
                />
                <span>
                  <strong>{x.oldName}</strong>
                  <small>{x.oldName === x.newName ? 'Sin cambios' : `→ ${x.newName}`}</small>
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
