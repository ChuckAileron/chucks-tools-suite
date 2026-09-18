import { useState } from 'react';
import type { FileType, MoveRecord, ScannedFile } from './types';
const OPTIONS: { id: FileType; label: string; extensions: string; icon: string }[] = [
  { id: 'video', label: 'Videos', extensions: 'MP4, MKV, AVI, MOV...', icon: '▶' },
  { id: 'audio', label: 'Audio', extensions: 'MP3, WAV, FLAC, AAC...', icon: '♫' },
  { id: 'image', label: 'Imágenes', extensions: 'JPG, PNG, WEBP, SVG...', icon: '◈' },
  { id: 'document', label: 'Documentos', extensions: 'PDF, DOCX, XLSX, TXT...', icon: '▤' },
  { id: 'archive', label: 'Comprimidos', extensions: 'ZIP, RAR, 7Z, TAR...', icon: '▣' },
];
const same = (a: string, b: string) =>
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
export default function MoverTool() {
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [types, setTypes] = useState<Set<FileType>>(new Set(['video', 'audio']));
  const [custom, setCustom] = useState('');
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState(false);
  const [returnToSource, setReturnToSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [createName, setCreateName] = useState('archivos-organizados');
  const [showCreate, setShowCreate] = useState(false);
  const [lastMove, setLastMove] = useState<{
    source: string;
    destination: string;
    moves: MoveRecord[];
  } | null>(null);
  const choose = async (kind: 'source' | 'destination') => {
    const path = await window.tools.selectDirectory();
    if (!path) return;
    if (kind === 'destination' && source && same(source, path)) {
      alert('La carpeta de destino debe ser diferente de la carpeta de origen.');
      return;
    }
    if (kind === 'source') setSource(path);
    else setDestination(path);
    setLastMove(null);
    setFiles([]);
    setSelected(new Set());
  };
  const toggleType = (type: FileType) =>
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  const scan = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await window.tools.scan({
        source,
        destination,
        types: [...types],
        customExtensions: custom.split(/[,;\s]+/).filter(Boolean),
      });
      setFiles(result);
      setSelected(new Set(result.map((x) => x.path)));
      setMessage(`${result.length} archivos encontrados.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    if (
      remove &&
      !confirm('Se eliminarán todas las carpetas hijas y su contenido restante. ¿Continuar?')
    )
      return;
    setBusy(true);
    try {
      const result = await window.tools.move({
        source,
        destination,
        files: files.filter((x) => selected.has(x.path)),
        deleteChildFolders: remove,
        returnToSource,
      });
      setMessage(
        `${result.moved} archivos movidos${result.returned ? ` · ${result.returned} devueltos al origen` : ''}${result.errors.length ? ` · ${result.errors.length} errores` : ''}.`,
      );
      setLastMove(result.moves.length ? { source, destination, moves: result.moves } : null);
      setFiles([]);
      setSelected(new Set());
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const createDestination = async () => {
    setBusy(true);
    try {
      const path = await window.tools.createDestination({ source, name: createName });
      setDestination(path);
      setShowCreate(false);
      setLastMove(null);
      setMessage(`Carpeta de destino creada: ${path}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!lastMove) return;
    setBusy(true);
    try {
      const result = await window.tools.undoMove(lastMove);
      setMessage(
        `${result.moved} archivos devueltos al origen${result.errors.length ? `, ${result.errors.length} errores` : ''}.`,
      );
      if (!result.errors.length) setLastMove(null);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToolFrame
      code="FM"
      title="Organizar archivos"
      subtitle="Encuentra y mueve archivos por tipo, incluso dentro de subcarpetas."
    >
      <Step
        number="01"
        title="Define las carpetas"
        text="La búsqueda incluirá todas las subcarpetas del origen."
      />
      <div className="paths">
        <Path label="Carpeta de origen" value={source} onClick={() => choose('source')} />
        <b>→</b>
        <Path
          label="Carpeta de destino"
          value={destination}
          onClick={() => choose('destination')}
        />
      </div>
      <div className="destination-create">
        <button disabled={!source || busy} onClick={() => setShowCreate((current) => !current)}>
          + Crear destino dentro de la carpeta de origen
        </button>
        {showCreate && (
          <div>
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Nombre de la nueva carpeta"
            />
            <button disabled={!createName.trim() || busy} onClick={createDestination}>
              Crear y usar
            </button>
          </div>
        )}
      </div>
      <Divider />
      <Step
        number="02"
        title="Elige los tipos de archivo"
        text="Puedes combinar categorías y extensiones personalizadas."
      />
      <div className="type-grid">
        {OPTIONS.map((x) => (
          <button
            key={x.id}
            className={types.has(x.id) ? 'active' : ''}
            onClick={() => toggleType(x.id)}
          >
            <i>{x.icon}</i>
            <strong>{x.label}</strong>
            <small>{x.extensions}</small>
            <b>{types.has(x.id) ? '✓' : '+'}</b>
          </button>
        ))}
      </div>
      <label className="custom">
        <span>Otras extensiones</span>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Ej: epub, psd, blend"
        />
      </label>
      <div className="scan-row">
        <span>{message || 'Configura el origen y los tipos para comenzar.'}</span>
        <button disabled={!source || (!types.size && !custom.trim()) || busy} onClick={scan}>
          Explorar archivos
        </button>
      </div>
      {files.length > 0 && (
        <FileResults files={files} selected={selected} setSelected={setSelected} />
      )}
      <div className="tool-action">
        <div className="mover-options">
          <label>
            <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
            <span>
              <strong>Eliminar carpetas hijas</strong>
              <small>Después de mover, excepto la carpeta de destino.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={returnToSource}
              onChange={(e) => setReturnToSource(e.target.checked)}
            />
            <span>
              <strong>Devolver al origen</strong>
              <small>Al final, devuelve el lote a la raíz de la carpeta fuente.</small>
            </span>
          </label>
        </div>
        <div className="mover-actions">
          {lastMove && (
            <button className="undo-button" disabled={busy} onClick={undo}>
              ↶ Deshacer último proceso
            </button>
          )}
          <button
            disabled={!destination || same(source, destination) || !selected.size || busy}
            onClick={move}
          >
            Mover {selected.size || ''} archivos →
          </button>
        </div>
      </div>
    </ToolFrame>
  );
}
function ToolFrame({
  code,
  title,
  subtitle,
  children,
}: {
  code: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tool">
      <header>
        <span>{code}</span>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <b>● Operaciones locales</b>
      </header>
      <div className="workspace">{children}</div>
    </section>
  );
}
function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="step">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Divider() {
  return <div className="divider" />;
}
function Path({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <div className="path">
      <i>⌑</i>
      <span>
        <strong>{label}</strong>
        <small title={value}>{value || 'Ninguna carpeta seleccionada'}</small>
      </span>
      <button onClick={onClick}>Elegir</button>
    </div>
  );
}
function FileResults({
  files,
  selected,
  setSelected,
}: {
  files: ScannedFile[];
  selected: Set<string>;
  setSelected: (x: Set<string>) => void;
}) {
  const all = files.length === selected.size;
  return (
    <div className="results">
      <div>
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={() => setSelected(all ? new Set() : new Set(files.map((x) => x.path)))}
          />{' '}
          {files.length} archivos
        </label>
        <span>{selected.size} seleccionados</span>
      </div>
      <section>
        {files.map((file) => (
          <label key={file.path}>
            <input
              type="checkbox"
              checked={selected.has(file.path)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(file.path)) next.delete(file.path);
                else next.add(file.path);
                setSelected(next);
              }}
            />
            <b>{file.extension.slice(1, 4).toUpperCase()}</b>
            <span>
              <strong>{file.name}</strong>
              <small>{file.relativePath}</small>
            </span>
            <i>{size(file.size)}</i>
          </label>
        ))}
      </section>
    </div>
  );
}
