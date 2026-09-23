import { useEffect, useRef, useState } from 'react';
import type { NormalizeFile, NormalizeState } from './types';
type MediaType = 'audio' | 'video';
const formatSize = (bytes: number) =>
  bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
// Valores por defecto mientras se carga la configuración real desde el
// proceso principal (misma tolerancia y duración de extracto que usa el
// análisis de LUFS en el backend).
const DEFAULT_CONFIG = { lufsTolerance: 1, excerptDuration: 30, excerptMinDuration: 45 };
const isAtTarget = (lufs: number | null | undefined, target: number, tolerance: number) =>
  typeof lufs === 'number' && Math.abs(lufs - target) <= tolerance;
const extensionLabel = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 && index < name.length - 1 ? name.slice(index + 1, index + 4).toUpperCase() : '';
};
// Concurrencia para medir el LUFS de varios archivos en paralelo:
// - Uno a uno es el más "seguro" pero desperdicia el resto de núcleos y es
//   muy lento con muchos archivos.
// - Todos a la vez puede disparar decenas/cientos de procesos de FFmpeg de
//   golpe, saturando CPU y disco y volviendo la interfaz (y el propio
//   análisis) más lenta en vez de más rápida.
// - Un lote acotado de N en paralelo aprovecha varios núcleos sin saturar el
//   equipo; como cada medición ahora analiza solo un extracto corto, N puede
//   ser moderado sin arriesgar la respuesta del sistema.
const LUFS_CONCURRENCY = Math.max(
  2,
  Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)),
);
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
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [measuringCancelled, setMeasuringCancelled] = useState(false);
  useEffect(() => {
    window.tools.getNormalizeConfig().then(setConfig);
  }, []);
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
  // Mide el LUFS de cada archivo listado en segundo plano, en lotes acotados
  // de LUFS_CONCURRENCY a la vez, para mostrarlo en la lista; se pausa
  // mientras hay un proceso de normalización en curso (para no competir por
  // CPU con FFmpeg) o si el usuario canceló el análisis.
  const measuringRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (normalize.running || measuringCancelled) return;
    const available = LUFS_CONCURRENCY - measuringRef.current.size;
    if (available <= 0) return;
    const pending = files.filter(
      (file) => file.lufs === undefined && !measuringRef.current.has(file.path),
    );
    for (const file of pending.slice(0, available)) {
      measuringRef.current.add(file.path);
      window.tools
        .measureNormalizeLufs(file.path)
        .catch(() => null)
        .finally(() => measuringRef.current.delete(file.path));
    }
  }, [files, normalize.running, measuringCancelled]);
  const pendingMeasureCount = files.filter((file) => file.lufs === undefined).length;
  const failedMeasureCount = files.filter((file) => file.lufs === null).length;
  const measuredCount = files.length - pendingMeasureCount;
  const cancelMeasuring = async () => {
    setMeasuringCancelled(true);
    await window.tools.cancelLufsScan();
  };
  const pushUi = (patch: Partial<NormalizeState>) => {
    void window.tools.setNormalizeUi(patch);
  };
  // Vuelve a poner en cola los archivos cuyo LUFS no se pudo calcular (p. ej.
  // por un fallo transitorio de FFmpeg); el efecto de medición los retoma
  // automáticamente al quedar de nuevo en estado "sin medir".
  const retryFailedMeasurements = () => {
    const next = files.map((file) => (file.lufs === null ? { ...file, lufs: undefined } : file));
    setFiles(next);
    pushUi({ files: next });
    setMeasuringCancelled(false);
    void window.tools.resumeLufsScan();
  };
  const addFolders = async () => {
    const paths = await window.tools.selectNormalizeFolders();
    const nextFolders = [...new Set([...folders, ...paths])];
    setFolders(nextFolders);
    setFiles([]);
    setSelected(new Set());
    setProcessed(new Set());
    setLogs([]);
    setMeasuringCancelled(false);
    setNormalize(EMPTY_NORMALIZE);
    pushUi({
      folders: nextFolders,
      files: [],
      selected: [],
      processed: [],
      logs: [],
      running: false,
      globalProgress: 0,
      fileProgress: 0,
    });
  };
  const scan = async () => {
    setMessage('Explorando archivos...');
    setLogs([]);
    setMeasuringCancelled(false);
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
        globalProgress: 0,
        fileProgress: 0,
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
    setMeasuringCancelled(false);
    setNormalize(EMPTY_NORMALIZE);
    pushUi({
      folders: [],
      files: [],
      selected: [],
      processed: [],
      logs: [],
      running: false,
      globalProgress: 0,
      fileProgress: 0,
    });
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
    setNormalize((current) => ({
      ...current,
      globalProgress: 0,
      fileProgress: 0,
      running: false,
      activeFile: 'Sin procesos activos',
      activeFolder: '',
    }));
    pushUi({
      folders: nextFolders,
      files: nextFiles,
      selected: nextSelected,
      processed: nextProcessed,
      globalProgress: 0,
      fileProgress: 0,
      running: false,
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
          <span>1</span>
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
              setMeasuringCancelled(false);
              setNormalize(EMPTY_NORMALIZE);
              pushUi({
                type: next,
                files: [],
                selected: [],
                processed: [],
                logs: [],
                running: false,
                globalProgress: 0,
                fileProgress: 0,
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
        <div
          className={`step${!folders.length ? ' locked' : ''}`}
          title={!folders.length ? 'Completa el paso 1 para desbloquear.' : undefined}
        >
          <span>2</span>
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
            disabled={normalize.running || !folders.length}
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
              disabled={normalize.running || !folders.length}
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
            {pendingMeasureCount > 0 && !normalize.running && !measuringCancelled && (
              <div className="lufs-scan-banner">
                <i className="lufs-spinner" aria-hidden="true" />
                <span>
                  <strong>Calculando LUFS…</strong>
                  <small>
                    {measuredCount} de {files.length} archivos medidos
                    {failedMeasureCount > 0 && ` (${failedMeasureCount} sin medir)`} · se analiza
                    una muestra de {config.excerptDuration}s en archivos de más de{' '}
                    {config.excerptMinDuration}s
                  </small>
                </span>
                <button type="button" onClick={cancelMeasuring}>
                  Cancelar análisis
                </button>
              </div>
            )}
            {measuringCancelled && pendingMeasureCount > 0 && !normalize.running && (
              <div className="lufs-scan-banner lufs-scan-cancelled">
                <i className="lufs-warning-icon" aria-hidden="true">
                  ✕
                </i>
                <span>
                  <strong>Análisis cancelado</strong>
                  <small>
                    {pendingMeasureCount} archivo{pendingMeasureCount === 1 ? '' : 's'} quedaron sin
                    medir. Puedes reanudar el cálculo o continuar con la normalización.
                  </small>
                </span>
                <button type="button" onClick={retryFailedMeasurements}>
                  Reanudar análisis
                </button>
              </div>
            )}
            {pendingMeasureCount === 0 && failedMeasureCount > 0 && !normalize.running && (
              <div className="lufs-scan-banner lufs-scan-warning">
                <i className="lufs-warning-icon" aria-hidden="true">
                  !
                </i>
                <span>
                  <strong>
                    {failedMeasureCount} archivo{failedMeasureCount === 1 ? '' : 's'} sin medir
                  </strong>
                  <small>
                    No se pudo calcular su LUFS (puede que no tengan pista de audio o el archivo
                    esté dañado). Se normalizarán igual; solo no se pudo confirmar de antemano si ya
                    estaban en el objetivo.
                  </small>
                </span>
                <button type="button" onClick={retryFailedMeasurements}>
                  Reintentar
                </button>
              </div>
            )}
            <section>
              {files.map((file) => (
                <label key={file.path}>
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={() => toggleSelected(file.path)}
                  />
                  <b>{extensionLabel(file.name)}</b>
                  <span>
                    <strong>{file.name}</strong>
                    <small>{file.folder}</small>
                  </span>
                  <i>{formatSize(file.size)}</i>
                  <span
                    className={`file-lufs ${isAtTarget(file.lufs, target, config.lufsTolerance) ? 'at-target' : ''}`}
                    title={
                      isAtTarget(file.lufs, target, config.lufsTolerance)
                        ? `Ya está a ${config.lufsTolerance} LU o menos del objetivo (${target} LUFS); se omitirá al normalizar`
                        : `Sonoridad integrada medida con FFmpeg (muestra de ${config.excerptDuration}s en archivos largos)`
                    }
                  >
                    {file.lufs === undefined
                      ? measuringCancelled
                        ? 'Medición cancelada'
                        : 'Midiendo…'
                      : file.lufs === null
                        ? 'Sin medir'
                        : `${file.lufs.toFixed(1)} LUFS`}
                    {isAtTarget(file.lufs, target, config.lufsTolerance) && (
                      <b> · en el objetivo</b>
                    )}
                  </span>
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
            <button
              disabled={!selected.size || (pendingMeasureCount > 0 && !measuringCancelled)}
              title={
                pendingMeasureCount > 0 && !measuringCancelled
                  ? 'Espera a que termine de calcularse el LUFS de todos los archivos, o cancela el análisis'
                  : undefined
              }
              onClick={start}
            >
              Normalizar {selected.size || ''} archivos →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
