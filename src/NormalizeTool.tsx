import { useEffect, useState } from 'react';
import type { NormalizeFile, NormalizeState } from './types';
type MediaType = 'audio' | 'video';
const formatSize = (bytes: number) =>
  bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const LUFS_PRESETS = [
  { value: -14, label: '-14 Streaming' },
  { value: -16, label: '-16 General' },
  { value: -18, label: '-18 Conservador' },
  { value: -23, label: '-23 Broadcast' },
];
const EMPTY_NORMALIZE: NormalizeState = {
  running: false,
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Sin procesos activos',
  message: '',
  targetDb: -16,
  folders: [],
  type: 'audio',
  files: [],
  selected: [],
  processed: [],
  logs: [],
  activeFolder: '',
};
export default function NormalizeTool() {
  const [folders, setFolders] = useState<string[]>([]);
  const [type, setType] = useState<MediaType>('audio');
  const [target, setTarget] = useState(-16);
  const [files, setFiles] = useState<NormalizeFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [normalize, setNormalize] = useState<NormalizeState>(EMPTY_NORMALIZE);
  const [message, setMessage] = useState('');
  const [processed, setProcessed] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<{ text: string; tone?: string }[]>([]);
  useEffect(() => {
    const hydrate = (state: NormalizeState) => {
      setNormalize(state);
      setFolders(state.folders);
      setType(state.type);
      if (typeof state.targetDb === 'number') setTarget(state.targetDb);
      setFiles(state.files);
      setSelected(new Set(state.selected));
      setProcessed(new Set(state.processed));
      setLogs(state.logs);
    };
    window.tools.getNormalizeState().then(hydrate);
    return window.tools.onNormalizeState(hydrate);
  }, []);
  const pushUi = (patch: Partial<NormalizeState>) => {
    void window.tools.setNormalizeUi(patch);
  };
  const addFolders = async () => {
    const paths = await window.tools.selectNormalizeFolders();
    const nextFolders = [...new Set([...folders, ...paths])];
    setFolders(nextFolders);
    setFiles([]);
    setSelected(new Set());
    setProcessed(new Set());
    setLogs([]);
    setNormalize(EMPTY_NORMALIZE);
    pushUi({
      folders: nextFolders,
      files: [],
      selected: [],
      processed: [],
      logs: [],
      running: false,
    });
  };
  const scan = async () => {
    setMessage('Explorando archivos...');
    setLogs([]);
    setNormalize(EMPTY_NORMALIZE);
    try {
      const result = await window.tools.scanNormalizeFiles({ folders, type });
      setFiles(result);
      setSelected(new Set(result.map((file) => file.path)));
      setProcessed(new Set(result.filter((file) => file.processed).map((file) => file.path)));
      pushUi({
        files: result,
        selected: result.map((file) => file.path),
        processed: result.filter((file) => file.processed).map((file) => file.path),
        logs: [],
        running: false,
      });
      setMessage(
        result.length
          ? 'Revisa la selección antes de continuar.'
          : 'No se encontraron archivos compatibles.',
      );
    } catch (error) {
      setMessage(String(error));
    }
  };
  const start = async () => {
    if (target < -50 || target > -5)
      return setMessage('El objetivo debe estar entre -50 y -5 LUFS.');
    setMessage('');
    setLogs([]);
    pushUi({ logs: [] });
    await window.tools.startNormalization({
      files: files.filter((file) => selected.has(file.path)),
      type,
      targetDb: target,
    });
  };
  const clear = () => {
    setFolders([]);
    setFiles([]);
    setSelected(new Set());
    setProcessed(new Set());
    setLogs([]);
    setNormalize(EMPTY_NORMALIZE);
    pushUi({ folders: [], files: [], selected: [], processed: [], logs: [], running: false });
  };
  const removeFolder = async (folder: string) => {
    if (normalize.running) {
      const ok = await window.tools.skipNormalizeFolder(folder);
      if (!ok)
        setMessage('No se puede quitar una carpeta mientras se procesa uno de sus archivos.');
      return;
    }
    const nextFolders = folders.filter((item) => item !== folder);
    const kept = new Set(files.filter((file) => file.folder !== folder).map((file) => file.path));
    const nextFiles = files.filter((file) => kept.has(file.path));
    setFolders(nextFolders);
    setFiles(nextFiles);
    const nextSelected = [...selected].filter((path) => kept.has(path));
    const nextProcessed = [...processed].filter((path) => kept.has(path));
    setSelected(new Set(nextSelected));
    setProcessed(new Set(nextProcessed));
    pushUi({
      folders: nextFolders,
      files: nextFiles,
      selected: nextSelected,
      processed: nextProcessed,
    });
  };
  const toggleSelected = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
    pushUi({ selected: [...next] });
  };
  const toggleAll = () => {
    const next = all ? new Set<string>() : new Set(files.map((file) => file.path));
    setSelected(next);
    pushUi({ selected: [...next] });
  };
  const all = files.length > 0 && selected.size === files.length;
  const normalizedCount = files.filter((file) => processed.has(file.path)).length;
  return (
    <section className="tool normalize-tool">
      <header>
        <span>LU</span>
        <div>
          <h1>Normalizar volumen</h1>
          <p>Equilibra el nivel percibido de audios y videos con FFmpeg.</p>
        </div>
        <b>● FFmpeg local</b>
      </header>
      <div className="workspace">
        <div className="step">
          <span>01</span>
          <div>
            <h2>Selecciona el contenido</h2>
            <p>Puedes procesar varias carpetas en una ejecución.</p>
          </div>
        </div>
        <div className="normalize-controls">
          <button disabled={normalize.running} onClick={addFolders}>
            + Añadir carpetas
          </button>
          <button disabled={normalize.running || !folders.length} onClick={clear}>
            Limpiar
          </button>
          <select
            disabled={normalize.running}
            value={type}
            onChange={(event) => {
              const next = event.target.value as MediaType;
              setType(next);
              setFiles([]);
              setSelected(new Set());
              setProcessed(new Set());
              setLogs([]);
              setNormalize(EMPTY_NORMALIZE);
              pushUi({
                type: next,
                files: [],
                selected: [],
                processed: [],
                logs: [],
                running: false,
              });
            }}
          >
            <option value="audio">Archivos de audio</option>
            <option value="video">Videos con audio</option>
          </select>
        </div>
        <div className="normalize-folders">
          {folders.length ? (
            folders.map((folder) => {
              const folderFiles = files.filter((file) => file.folder === folder);
              const folderDone = folderFiles.filter((file) => processed.has(file.path)).length;
              return (
                <div key={folder}>
                  <span title={folder}>{folder}</span>
                  {folderFiles.length > 0 && (
                    <em>
                      {folderDone} de {folderFiles.length}
                    </em>
                  )}
                  <button
                    disabled={normalize.running && normalize.activeFolder === folder}
                    onClick={() => void removeFolder(folder)}
                  >
                    Quitar
                  </button>
                </div>
              );
            })
          ) : (
            <p>No hay carpetas seleccionadas.</p>
          )}
        </div>
        <div className="divider" />
        <div className="step">
          <span>02</span>
          <div>
            <h2>Configura la normalización</h2>
            <p>El valor recomendado para contenido general es -16 LUFS.</p>
          </div>
        </div>
        <label className="lufs-target">
          <strong>Objetivo de sonoridad</strong>
          <input
            type="number"
            min="-50"
            max="-5"
            value={target}
            disabled={normalize.running}
            onChange={(event) => {
              const next = Number(event.target.value);
              setTarget(next);
              window.tools.setNormalizeTarget(next);
            }}
          />
          <span>LUFS</span>
        </label>
        <div className="lufs-presets">
          {LUFS_PRESETS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              disabled={normalize.running}
              className={target === value ? 'active' : ''}
              onClick={() => {
                setTarget(value);
                window.tools.setNormalizeTarget(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="scan-row">
          <span>{message || normalize.message || 'Selecciona carpetas para comenzar.'}</span>
          <button disabled={!folders.length || normalize.running} onClick={scan}>
            Explorar archivos
          </button>
        </div>
        {files.length > 0 && (
          <div className="results normalize-results">
            <div>
              <label>
                <input type="checkbox" checked={all} onChange={toggleAll} /> {files.length} archivos
              </label>
              <span>{selected.size} seleccionados</span>
            </div>
            <section>
              {files.map((file) => (
                <label key={file.path}>
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={() => toggleSelected(file.path)}
                  />
                  <span>
                    <strong>{file.name}</strong>
                    <small>{file.folder}</small>
                  </span>
                  <i>{formatSize(file.size)}</i>
                  {processed.has(file.path) && (
                    <em className="file-check" title="Archivo procesado" aria-hidden="true">
                      ✓
                    </em>
                  )}
                </label>
              ))}
            </section>
          </div>
        )}
        <div className="normalize-progress">
          <span>
            <strong>Progreso global</strong>
            <b>{normalize.globalProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${normalize.globalProgress}%` }} />
          </i>
          {files.length > 0 && (
            <em>
              {normalizedCount} de {files.length} archivos procesados
            </em>
          )}
          <br />
          <span>
            <strong>{normalize.message || 'Sin procesos activos'}</strong>
            <b>{normalize.fileProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${normalize.fileProgress}%` }} />
          </i>
        </div>
        <div className="normalize-log">
          {logs.length ? (
            logs.map((item, index) => (
              <div className={item.tone} key={`${index}-${item.text}`}>
                {item.text}
              </div>
            ))
          ) : (
            <span>El registro de normalización aparecerá aquí.</span>
          )}
        </div>
        <div className="tool-action simple">
          <span>
            Los originales se conservan. El resultado se guarda en{' '}
            <strong>normalized_output-audio</strong> o <strong>normalized_output-video</strong>{' '}
            dentro de cada carpeta.
          </span>
          {normalize.running ? (
            <button className="cancel-button" onClick={() => window.tools.cancelNormalization()}>
              Cancelar proceso
            </button>
          ) : (
            <button disabled={!selected.size} onClick={start}>
              Normalizar {selected.size || ''} archivos →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
