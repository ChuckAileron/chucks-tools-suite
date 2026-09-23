import { useEffect, useState } from 'react';
import type { TrimFile, TrimJob, TrimMode, TrimSettings, TrimState } from './types';

type MediaType = 'audio' | 'video';

const EDGE_TOLERANCE = 0.05;

const formatSize = (bytes: number) =>
  bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

const extensionLabel = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 && index < name.length - 1 ? name.slice(index + 1, index + 4).toUpperCase() : '';
};

// Formatea segundos como "mm:ss" (o "h:mm:ss" si supera la hora), truncando
// a un decimal para no saturar el campo con precisión que ffmpeg no
// necesita mostrar al usuario.
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds * 10) / 10;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const secsStr = secs.toFixed(secs % 1 ? 1 : 0).padStart(secs < 10 ? 3 : 2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secsStr}`
    : `${minutes}:${secsStr}`;
}

// Interpreta "mm:ss", "h:mm:ss" o segundos sueltos ("125" / "125.5").
function parseTime(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return NaN;
  if (!trimmed.includes(':')) return Number(trimmed);
  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const EMPTY_TRIM: TrimState = {
  running: false,
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Sin procesos activos',
  message: '',
  folders: [],
  type: 'audio',
  files: [],
  selected: [],
  processed: [],
  settings: {},
  logs: [],
  activeFolder: '',
};

const defaultSettings = (file: TrimFile): TrimSettings => ({
  mode: 'keep',
  start: 0,
  end: file.duration,
  split: false,
});

// Un tramo a eliminar es "interior" cuando no toca ni el inicio ni el final
// del archivo; en ese caso el recorte produce dos segmentos independientes
// que el usuario puede conservar separados o volver a unir.
const isInteriorCut = (settings: TrimSettings, duration: number) =>
  settings.mode === 'remove' &&
  settings.start > EDGE_TOLERANCE &&
  settings.end < duration - EDGE_TOLERANCE;

function describeSettings(settings: TrimSettings, duration: number): string {
  const startLabel = formatTime(settings.start);
  const endLabel = formatTime(settings.end);
  if (settings.mode === 'keep') return `Se conservará de ${startLabel} a ${endLabel}.`;
  if (isInteriorCut(settings, duration))
    return settings.split
      ? `Se eliminará de ${startLabel} a ${endLabel}; el resultado serán dos archivos.`
      : `Se eliminará de ${startLabel} a ${endLabel}; los dos tramos restantes se unirán en uno solo.`;
  return `Se eliminará de ${startLabel} a ${endLabel}.`;
}

function isValidSettings(settings: TrimSettings, duration: number): boolean {
  if (!Number.isFinite(settings.start) || !Number.isFinite(settings.end)) return false;
  if (settings.start < 0 || settings.end > duration) return false;
  if (settings.end - settings.start <= EDGE_TOLERANCE) return false;
  if (settings.mode === 'remove' && settings.start <= EDGE_TOLERANCE && settings.end >= duration - EDGE_TOLERANCE)
    return false;
  return true;
}

export default function TrimTool() {
  const [folders, setFolders] = useState<string[]>([]);
  const [type, setType] = useState<MediaType>('audio');
  const [files, setFiles] = useState<TrimFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettingsState] = useState<Record<string, TrimSettings>>({});
  const [trim, setTrim] = useState<TrimState>(EMPTY_TRIM);
  const [message, setMessage] = useState('');
  const [processed, setProcessed] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<{ text: string; tone?: string }[]>([]);

  useEffect(() => {
    const hydrate = (state: TrimState) => {
      setTrim(state);
      setFolders(state.folders);
      setType(state.type);
      setFiles(state.files);
      setSelected(new Set(state.selected));
      setProcessed(new Set(state.processed));
      setSettingsState(state.settings || {});
      setLogs(state.logs);
    };
    window.tools.getTrimState().then(hydrate);
    return window.tools.onTrimState(hydrate);
  }, []);

  const pushUi = (patch: Partial<TrimState>) => {
    void window.tools.setTrimUi(patch);
  };

  const addFolders = async () => {
    const paths = await window.tools.selectTrimFolders();
    const nextFolders = [...new Set([...folders, ...paths])];
    setFolders(nextFolders);
    setFiles([]);
    setSelected(new Set());
    setProcessed(new Set());
    setSettingsState({});
    setLogs([]);
    setTrim(EMPTY_TRIM);
    pushUi({
      folders: nextFolders,
      files: [],
      selected: [],
      processed: [],
      settings: {},
      logs: [],
      running: false,
      globalProgress: 0,
      fileProgress: 0,
    });
  };
  const clear = () => {
    setFolders([]);
    setFiles([]);
    setSelected(new Set());
    setProcessed(new Set());
    setSettingsState({});
    setLogs([]);
    setTrim(EMPTY_TRIM);
    pushUi({
      folders: [],
      files: [],
      selected: [],
      processed: [],
      settings: {},
      logs: [],
      running: false,
      globalProgress: 0,
      fileProgress: 0,
    });
  };
  const scan = async () => {
    setMessage('Explorando archivos...');
    setLogs([]);
    setTrim(EMPTY_TRIM);
    try {
      const result = await window.tools.scanTrimFiles({ folders, type });
      const nextSettings: Record<string, TrimSettings> = {};
      for (const file of result) nextSettings[file.path] = defaultSettings(file);
      setFiles(result);
      setSelected(new Set(result.map((file) => file.path)));
      setProcessed(new Set());
      setSettingsState(nextSettings);
      pushUi({
        files: result,
        selected: result.map((file) => file.path),
        processed: [],
        settings: nextSettings,
        logs: [],
        running: false,
        globalProgress: 0,
        fileProgress: 0,
      });
      setMessage(
        result.length
          ? 'Define el tramo a conservar o eliminar de cada archivo.'
          : 'No se encontraron archivos compatibles.',
      );
    } catch (error) {
      setMessage(String(error));
    }
  };
  const removeFolder = async (folder: string) => {
    if (trim.running) {
      const ok = await window.tools.skipTrimFolder(folder);
      if (!ok) setMessage('No se puede quitar una carpeta mientras se procesa uno de sus archivos.');
      return;
    }
    const nextFolders = folders.filter((item) => item !== folder);
    const kept = new Set(files.filter((file) => file.folder !== folder).map((file) => file.path));
    const nextFiles = files.filter((file) => kept.has(file.path));
    const nextSettings: Record<string, TrimSettings> = {};
    for (const [key, value] of Object.entries(settings)) if (kept.has(key)) nextSettings[key] = value;
    setFolders(nextFolders);
    setFiles(nextFiles);
    const nextSelected = [...selected].filter((path) => kept.has(path));
    const nextProcessed = [...processed].filter((path) => kept.has(path));
    setSelected(new Set(nextSelected));
    setProcessed(new Set(nextProcessed));
    setSettingsState(nextSettings);
    setTrim((current) => ({
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
      settings: nextSettings,
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
  const updateSettings = (path: string, patch: Partial<TrimSettings>) => {
    const next = { ...settings, [path]: { ...settings[path], ...patch } };
    setSettingsState(next);
    pushUi({ settings: next });
  };
  const start = async () => {
    const targets = files.filter((file) => selected.has(file.path));
    const invalid = targets.find(
      (file) => !isValidSettings(settings[file.path] || defaultSettings(file), file.duration),
    );
    if (invalid) return setMessage(`El rango de "${invalid.name}" no es válido.`);
    setMessage('');
    setLogs([]);
    pushUi({ logs: [] });
    const jobs: TrimJob[] = targets.map((file) => {
      const fileSettings = settings[file.path] || defaultSettings(file);
      return {
        path: file.path,
        name: file.name,
        folder: file.folder,
        mode: fileSettings.mode,
        start: fileSettings.start,
        end: fileSettings.end,
        split: fileSettings.split,
      };
    });
    await window.tools.startTrim({ jobs, type });
  };

  const all = files.length > 0 && selected.size === files.length;
  const trimmedCount = files.filter((file) => processed.has(file.path)).length;
  const selectedInvalidCount = files.filter(
    (file) =>
      selected.has(file.path) &&
      !isValidSettings(settings[file.path] || defaultSettings(file), file.duration),
  ).length;

  return (
    <section className="tool trim-tool">
      <header>
        <span>✂</span>
        <div>
          <h1>Cortar audio/video</h1>
          <p>Recorta el inicio, el final o un tramo interior de tus archivos con FFmpeg.</p>
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
          <button disabled={trim.running} onClick={addFolders}>
            + Añadir carpetas
          </button>
          <button disabled={trim.running || !folders.length} onClick={clear}>
            Limpiar
          </button>
          <select
            disabled={trim.running}
            value={type}
            onChange={(event) => {
              const next = event.target.value as MediaType;
              setType(next);
              setFiles([]);
              setSelected(new Set());
              setProcessed(new Set());
              setSettingsState({});
              setLogs([]);
              setTrim(EMPTY_TRIM);
              pushUi({
                type: next,
                files: [],
                selected: [],
                processed: [],
                settings: {},
                logs: [],
                running: false,
                globalProgress: 0,
                fileProgress: 0,
              });
            }}
          >
            <option value="audio">Archivos de audio</option>
            <option value="video">Videos</option>
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
                    disabled={trim.running && trim.activeFolder === folder}
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
            <h2>Define el corte de cada archivo</h2>
            <p>
              "Conservar" descarta todo lo que quede fuera del rango; "Eliminar" quita el rango y
              conserva el resto.
            </p>
          </div>
        </div>
        <div className="scan-row">
          <span>{message || trim.message || 'Selecciona carpetas para comenzar.'}</span>
          <button disabled={!folders.length || trim.running} onClick={scan}>
            Explorar archivos
          </button>
        </div>
        {files.length > 0 && (
          <div className="results trim-results">
            <div>
              <label>
                <input type="checkbox" checked={all} onChange={toggleAll} /> {files.length} archivos
              </label>
              <span>{selected.size} seleccionados</span>
            </div>
            <section className="trim-file-list">
              {files.map((file) => {
                const fileSettings = settings[file.path] || defaultSettings(file);
                const interior = isInteriorCut(fileSettings, file.duration);
                const valid = isValidSettings(fileSettings, file.duration);
                return (
                  <div className="trim-file-row" key={file.path}>
                    <label className="trim-file-header">
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
                      <i title="Duración total">{formatTime(file.duration)}</i>
                      {processed.has(file.path) && (
                        <em className="file-check" title="Archivo procesado" aria-hidden="true">
                          ✓
                        </em>
                      )}
                    </label>
                    <div className="trim-file-controls">
                      <label className="trim-mode">
                        Acción
                        <select
                          disabled={trim.running}
                          value={fileSettings.mode}
                          onChange={(event) =>
                            updateSettings(file.path, { mode: event.target.value as TrimMode })
                          }
                        >
                          <option value="keep">Conservar sección</option>
                          <option value="remove">Eliminar sección</option>
                        </select>
                      </label>
                      <label className="trim-time">
                        Inicio
                        <input
                          disabled={trim.running}
                          type="text"
                          defaultValue={formatTime(fileSettings.start)}
                          onBlur={(event) => {
                            const parsed = parseTime(event.target.value);
                            updateSettings(file.path, {
                              start: Number.isFinite(parsed) ? parsed : fileSettings.start,
                            });
                          }}
                        />
                      </label>
                      <label className="trim-time">
                        Fin
                        <input
                          disabled={trim.running}
                          type="text"
                          defaultValue={formatTime(fileSettings.end)}
                          onBlur={(event) => {
                            const parsed = parseTime(event.target.value);
                            updateSettings(file.path, {
                              end: Number.isFinite(parsed) ? parsed : fileSettings.end,
                            });
                          }}
                        />
                      </label>
                      {interior && (
                        <label className="trim-split">
                          <input
                            disabled={trim.running}
                            type="checkbox"
                            checked={fileSettings.split}
                            onChange={(event) =>
                              updateSettings(file.path, { split: event.target.checked })
                            }
                          />
                          Separar en dos archivos
                        </label>
                      )}
                    </div>
                    <p className={`trim-file-hint ${valid ? '' : 'invalid'}`}>
                      {valid
                        ? describeSettings(fileSettings, file.duration)
                        : 'El rango indicado no es válido para este archivo.'}
                    </p>
                  </div>
                );
              })}
            </section>
          </div>
        )}
        <div className="normalize-progress">
          <span>
            <strong>Progreso global</strong>
            <b>{trim.globalProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${trim.globalProgress}%` }} />
          </i>
          {files.length > 0 && (
            <em>
              {trimmedCount} de {files.length} archivos procesados
            </em>
          )}
          <br />
          <span>
            <strong>{trim.message || 'Sin procesos activos'}</strong>
            <b>{trim.fileProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${trim.fileProgress}%` }} />
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
            <span>El registro de recorte aparecerá aquí.</span>
          )}
        </div>
        <div className="tool-action simple">
          <span>
            Los originales se conservan. El resultado se guarda en{' '}
            <strong>trimmed_output-audio</strong> o <strong>trimmed_output-video</strong> dentro de
            cada carpeta.
          </span>
          {trim.running ? (
            <button className="cancel-button" onClick={() => window.tools.cancelTrim()}>
              Cancelar proceso
            </button>
          ) : (
            <button
              disabled={!selected.size || selectedInvalidCount > 0}
              title={selectedInvalidCount > 0 ? 'Corrige los rangos inválidos antes de continuar' : undefined}
              onClick={start}
            >
              Cortar {selected.size || ''} archivos →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
