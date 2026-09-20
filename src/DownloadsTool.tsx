import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  DownloadCandidate,
  DownloadPriority,
  DownloadSettings,
  DownloadsState,
  DownloadTask,
} from './types';

type Tab = 'downloads' | 'collector' | 'settings';
const EMPTY: DownloadsState = {
  settings: {
    defaultDirectory: '',
    concurrency: 3,
    autoExtract: true,
    clipboard: true,
    googleDriveApiKey: '',
  },
  tasks: [],
};
const STATUS: Record<string, string> = {
  pending: 'En cola',
  downloading: 'Descargando',
  paused: 'Pausada',
  stopped: 'Detenida',
  completed: 'Completada',
  extracting: 'Extrayendo',
  'password-required': 'Requiere contraseña',
  error: 'Error',
};
const PRIORITIES: DownloadPriority[] = ['urgent', 'high', 'medium', 'low'];
const PRIORITY_LABEL: Record<DownloadPriority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};
const formatSize = (bytes: number) =>
  !bytes
    ? '—'
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1073741824
        ? `${(bytes / 1048576).toFixed(1)} MB`
        : `${(bytes / 1073741824).toFixed(2)} GB`;
const progressOf = (tasks: DownloadTask[]) =>
  tasks.length
    ? Math.round(
        tasks.reduce(
          (total, task) => total + (task.status === 'completed' ? 100 : task.progress),
          0,
        ) / tasks.length,
      )
    : 0;

export default function DownloadsTool({
  candidates,
  setCandidates,
}: {
  candidates: DownloadCandidate[];
  setCandidates: Dispatch<SetStateAction<DownloadCandidate[]>>;
}) {
  const [tab, setTab] = useState<Tab>(candidates.length ? 'collector' : 'downloads');
  const [state, setState] = useState<DownloadsState>(EMPTY);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggleCollapsed = (key: string) =>
    setCollapsed((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  const isCollapsed = (key: string) => collapsed.includes(key);
  const [text, setText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');

  const mergeCandidates = (found: DownloadCandidate[]) =>
    setCandidates((current) => {
      const key = (item: DownloadCandidate) => `${item.originalUrl}|${item.mode || ''}`;
      const existing = new Set(current.map(key));
      return [
        ...current,
        ...found
          .filter((item) => !existing.has(key(item)))
          .map((item) => ({
            ...item,
            destination: state.settings.defaultDirectory,
            priority: 'medium' as DownloadPriority,
            extract: true,
          })),
      ];
    });
  const previousCandidateCount = useRef(candidates.length);
  useEffect(() => {
    if (candidates.length > previousCandidateCount.current) setTab('collector');
    previousCandidateCount.current = candidates.length;
  }, [candidates.length]);
  useEffect(() => {
    window.tools.getDownloads().then(setState);
    const stopState = window.tools.onDownloadsState(setState);
    return () => stopState();
  }, []);

  const analyze = async () => {
    if (!text.trim()) return;
    setAnalyzing(true);
    setMessage('');
    try {
      const found = await window.tools.analyzeDownloads(text);
      mergeCandidates(found);
      setMessage(`${found.length} enlaces identificados.`);
      setText('');
    } catch (error) {
      setMessage(String(error));
    } finally {
      setAnalyzing(false);
    }
  };
  const updateCandidate = (id: string, changes: Partial<DownloadCandidate>) =>
    setCandidates((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  const chooseFolder = async (id?: string) => {
    const directory = await window.tools.selectDownloadDirectory();
    if (!directory) return;
    setCandidates((current) =>
      current.map((item) =>
        id
          ? item.id === id
            ? { ...item, destination: directory }
            : item
          : item.selected
            ? { ...item, destination: directory }
            : item,
      ),
    );
  };
  const queue = async () => {
    const selected = candidates.filter((item) => item.selected && item.online);
    if (!selected.length) return setMessage('Selecciona al menos un enlace disponible.');
    if (selected.some((item) => !item.destination))
      return setMessage('Selecciona una carpeta de destino para todos los enlaces.');
    await window.tools.addDownloads(selected);
    setCandidates((current) =>
      current.filter((item) => !selected.some((queued) => queued.id === item.id)),
    );
    setTab('downloads');
  };
  return (
    <section className="tool downloads-tool">
      <header>
        <span>↓</span>
        <div>
          <h1>Gestor de descargas</h1>
          <p>Captura, organiza y descarga enlaces con una cola persistente.</p>
        </div>
        <b>● Cola local</b>
      </header>
      <div className="download-tabs">
        <button className={tab === 'downloads' ? 'active' : ''} onClick={() => setTab('downloads')}>
          Descargas <b>{state.tasks.length}</b>
        </button>
        <button className={tab === 'collector' ? 'active' : ''} onClick={() => setTab('collector')}>
          Identificador <b>{candidates.length}</b>
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Configuración
        </button>
      </div>
      <div className="workspace download-workspace">
        {tab === 'downloads' ? (
          <DownloadsTab
            tasks={state.tasks}
            isCollapsed={isCollapsed}
            toggleCollapsed={toggleCollapsed}
          />
        ) : tab === 'collector' ? (
          <CollectorTab
            candidates={candidates}
            text={text}
            message={message}
            analyzing={analyzing}
            setText={setText}
            analyze={analyze}
            update={updateCandidate}
            chooseFolder={chooseFolder}
            queue={queue}
            clear={() => setCandidates([])}
          />
        ) : (
          <SettingsTab
            settings={state.settings}
            save={(changes) => window.tools.setDownloadSettings({ ...state.settings, ...changes })}
          />
        )}
      </div>
    </section>
  );
}

function DownloadsTab({
  tasks,
  isCollapsed,
  toggleCollapsed,
}: {
  tasks: DownloadTask[];
  isCollapsed: (key: string) => boolean;
  toggleCollapsed: (key: string) => void;
}) {
  const groups = Map.groupBy(tasks, (task) => task.destination);
  return (
    <>
      <div className="downloads-toolbar">
        <span>
          {tasks.length} descargas · {tasks.filter((task) => task.status === 'downloading').length}{' '}
          activas
        </span>
        <button
          disabled={!tasks.some((task) => task.status === 'completed')}
          onClick={() => window.tools.clearCompletedDownloads()}
        >
          Limpiar completadas
        </button>
      </div>
      {tasks.length ? (
        [...groups].map(([directory, items]) => {
          const groupKey = `dir:${directory}`;
          const groupProgress = progressOf(items);
          const groupComplete =
            items.length > 0 && items.every((task) => task.status === 'completed');
          return (
            <section
              className={`download-group ${isCollapsed(groupKey) ? 'collapsed' : ''}${groupComplete ? ' complete' : ''}`}
              key={directory}
            >
              <header>
                <button
                  className="download-group-toggle"
                  type="button"
                  onClick={() => toggleCollapsed(groupKey)}
                  title={`${isCollapsed(groupKey) ? 'Expandir grupo' : 'Colapsar grupo'} · ${groupProgress}%`}
                  aria-label={`${isCollapsed(groupKey) ? 'Expandir' : 'Colapsar'} ${directory}`}
                >
                  {isCollapsed(groupKey) ? '▸' : '▾'}
                </button>
                <div className="download-group-info">
                  <span className="download-group-title">
                    <strong>{directory}</strong>
                    {groupComplete && <em title="Grupo completado">✓</em>}
                  </span>
                  <small>
                    {items.length} archivos · {groupProgress}%
                  </small>
                </div>
                <div className="download-group-meter">
                  <span>
                    <i style={{ width: `${groupProgress}%` }} />
                  </span>
                </div>
              </header>
              {!isCollapsed(groupKey) &&
                [...Map.groupBy(items, (task) => task.collection || 'Sin colección')].map(
                  ([collection, collectionTasks]) => {
                    const collectionKey = `col:${directory}::${collection}`;
                    const collectionProgress = progressOf(collectionTasks);
                    return (
                      <div
                        className={`download-collection ${isCollapsed(collectionKey) ? 'collapsed' : ''}`}
                        key={collection}
                      >
                        <button
                          className="collection-title"
                          type="button"
                          onClick={() => toggleCollapsed(collectionKey)}
                          title={`${isCollapsed(collectionKey) ? 'Expandir colección' : 'Colapsar colección'} · ${collectionProgress}%`}
                          aria-label={`${isCollapsed(collectionKey) ? 'Expandir' : 'Colapsar'} ${collection}`}
                        >
                          <strong>{collection}</strong>
                          <small>
                            {isCollapsed(collectionKey) ? '▸' : '▾'} {collectionTasks.length}{' '}
                            enlaces · {collectionProgress}%
                          </small>
                        </button>
                        {!isCollapsed(collectionKey) &&
                          collectionTasks.map((task) => <DownloadRow task={task} key={task.id} />)}
                      </div>
                    );
                  },
                )}
            </section>
          );
        })
      ) : (
        <div className="downloads-empty">
          <b>↓</b>
          <strong>No hay descargas</strong>
          <span>Copia enlaces o agrégalos desde Identificador.</span>
        </div>
      )}
    </>
  );
}

function DownloadRow({ task }: { task: DownloadTask }) {
  const askPassword = async () => {
    const value = prompt('Contraseña del archivo comprimido:');
    if (value !== null) await window.tools.retryExtraction(task.id, value);
  };
  const idle = !['downloading', 'extracting', 'completed'].includes(task.status);
  const removable = ['paused', 'stopped', 'error', 'password-required', 'extracting'].includes(
    task.status,
  );
  return (
    <article className={`download-row status-${task.status}`}>
      <div className="download-file">
        <input
          defaultValue={task.name}
          disabled={!idle}
          onBlur={(event) => window.tools.updateDownload(task.id, { name: event.target.value })}
        />
        <span>
          {task.host} · {PRIORITY_LABEL[task.priority]} · {formatSize(task.total)}
        </span>
      </div>
      <div className="download-meter">
        <span>
          <i style={{ width: `${task.progress}%` }} />
        </span>
        <small>
          {task.progress}% ·{' '}
          {task.status === 'downloading'
            ? `${formatSize(task.speed)}/s`
            : STATUS[task.status] || task.status}
        </small>
      </div>
      <div className="download-actions">
        {task.status === 'downloading' && (
          <button title="Pausar" onClick={() => window.tools.controlDownload(task.id, 'pause')}>
            Ⅱ
          </button>
        )}
        {['paused', 'stopped', 'error'].includes(task.status) && (
          <button title="Continuar" onClick={() => window.tools.controlDownload(task.id, 'resume')}>
            ▶
          </button>
        )}
        {['downloading', 'paused'].includes(task.status) && (
          <button title="Detener" onClick={() => window.tools.controlDownload(task.id, 'stop')}>
            ■
          </button>
        )}
        {task.status === 'password-required' && (
          <button title="Ingresar contraseña" onClick={askPassword}>
            ⌕
          </button>
        )}
        {task.filePath && (
          <button
            title="Mostrar archivo"
            onClick={() => window.tools.showDownloadedFile(task.filePath!)}
          >
            ⌑
          </button>
        )}
        <button title="Abrir enlace" onClick={() => window.tools.openUrl(task.originalUrl)}>
          ↗
        </button>
        {removable && (
          <button title="Quitar" onClick={() => window.tools.controlDownload(task.id, 'remove')}>
            ×
          </button>
        )}
      </div>
      {task.error && <p>{task.error}</p>}
    </article>
  );
}

type CollectorProps = {
  candidates: DownloadCandidate[];
  text: string;
  message: string;
  analyzing: boolean;
  setText: (value: string) => void;
  analyze: () => void;
  update: (id: string, changes: Partial<DownloadCandidate>) => void;
  chooseFolder: (id?: string) => void;
  queue: () => void;
  clear: () => void;
};
function CollectorTab({
  candidates,
  text,
  message,
  analyzing,
  setText,
  analyze,
  update,
  chooseFolder,
  queue,
  clear,
}: CollectorProps) {
  const setSharedPassword = () => {
    const password = prompt('Contraseña para los enlaces seleccionados:');
    if (password !== null)
      candidates.forEach((item) => item.selected && update(item.id, { password }));
  };
  const setSharedCollection = () => {
    const collection = prompt('Nombre de la colección para los enlaces seleccionados:');
    if (collection?.trim())
      candidates.forEach(
        (item) => item.selected && update(item.id, { collection: collection.trim() }),
      );
  };
  const online = candidates.filter((item) => item.online);
  const allSelected = online.length > 0 && online.every((item) => item.selected);
  const noneSelected = online.every((item) => !item.selected);
  return (
    <>
      <div className="collector-input">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Pega uno o varios enlaces, uno por línea..."
        />
        <button disabled={!text.trim() || analyzing} onClick={analyze}>
          {analyzing ? 'Analizando...' : 'Analizar enlaces'}
        </button>
      </div>
      <div className="collector-toolbar">
        <span>{message || 'Los enlaces copiados aparecerán automáticamente aquí.'}</span>
        {online.length > 0 && (
          <span className="collector-select-all">
            <button
              type="button"
              disabled={allSelected}
              onClick={() => online.forEach((item) => update(item.id, { selected: true }))}
            >
              Todo
            </button>
            <button
              type="button"
              disabled={noneSelected}
              onClick={() => online.forEach((item) => update(item.id, { selected: false }))}
            >
              Ninguno
            </button>
          </span>
        )}
        <div>
          <button disabled={!candidates.length} onClick={() => chooseFolder()}>
            Destino para seleccionados
          </button>
          <button disabled={!candidates.some((item) => item.selected)} onClick={setSharedPassword}>
            Contraseña común
          </button>
          <button
            disabled={!candidates.some((item) => item.selected)}
            onClick={setSharedCollection}
          >
            Colección
          </button>
          <button disabled={!candidates.length} onClick={clear}>
            Limpiar
          </button>
        </div>
      </div>
      {candidates.map((item) => (
        <article className={`candidate ${item.online ? '' : 'offline'}`} key={item.id}>
          <input
            type="checkbox"
            checked={item.selected}
            disabled={!item.online}
            onChange={(event) => update(item.id, { selected: event.target.checked })}
          />
          <div className="candidate-main">
            <input
              value={item.name}
              disabled={!item.online}
              onChange={(event) => update(item.id, { name: event.target.value })}
            />
            <span title={item.error || item.originalUrl}>
              {item.host} ·{' '}
              <b className={`candidate-status ${item.online ? 'online' : 'offline'}`}>
                {item.online ? 'En línea' : 'No encontrado'}
              </b>
              {item.mode && ` · ${item.mode}`}
            </span>
            <input
              className="candidate-collection"
              value={item.collection || ''}
              onChange={(event) => update(item.id, { collection: event.target.value })}
              placeholder="Colección"
            />
          </div>
          <select
            value={item.priority || 'medium'}
            onChange={(event) =>
              update(item.id, { priority: event.target.value as DownloadPriority })
            }
          >
            {PRIORITIES.map((priority) => (
              <option value={priority} key={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
          <input
            className="candidate-password"
            type="password"
            value={item.password || ''}
            onChange={(event) => update(item.id, { password: event.target.value })}
            placeholder="Contraseña"
          />
          <button
            className="candidate-folder"
            title={item.destination}
            onClick={() => chooseFolder(item.id)}
          >
            {item.destination ? 'Destino ✓' : 'Destino'}
          </button>
          <button onClick={() => window.tools.openUrl(item.originalUrl)}>↗</button>
        </article>
      ))}
      <div className="collector-footer">
        <label>
          <input
            type="checkbox"
            checked={
              candidates.length > 0 && candidates.every((item) => !item.online || item.selected)
            }
            onChange={(event) =>
              candidates.forEach(
                (item) => item.online && update(item.id, { selected: event.target.checked }),
              )
            }
          />{' '}
          Seleccionar disponibles
        </label>
        <button disabled={!candidates.some((item) => item.selected && item.online)} onClick={queue}>
          Añadir a descargas →
        </button>
      </div>
    </>
  );
}

function SettingsTab({
  settings,
  save,
}: {
  settings: DownloadSettings;
  save: (changes: Partial<DownloadSettings>) => void;
}) {
  const choose = async () => {
    const directory = await window.tools.selectDownloadDirectory();
    if (directory) save({ defaultDirectory: directory });
  };
  return (
    <div className="download-settings">
      <section>
        <h3>Carpeta predeterminada</h3>
        <div>
          <span title={settings.defaultDirectory}>
            {settings.defaultDirectory || 'Sin configurar'}
          </span>
          <button onClick={choose}>Elegir carpeta</button>
        </div>
      </section>
      <section>
        <h3>Rendimiento</h3>
        <label>
          Descargas simultáneas{' '}
          <input
            type="number"
            min="1"
            max="8"
            value={settings.concurrency}
            onChange={(event) => save({ concurrency: Number(event.target.value) })}
          />
        </label>
        <small>La velocidad máxima depende de los límites del servidor.</small>
      </section>
      <section>
        <h3>Automatización</h3>
        <label>
          <input
            type="checkbox"
            checked={settings.clipboard}
            onChange={(event) => save({ clipboard: event.target.checked })}
          />{' '}
          Detectar enlaces copiados
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.autoExtract}
            onChange={(event) => save({ autoExtract: event.target.checked })}
          />{' '}
          Extraer comprimidos automáticamente
        </label>
      </section>
      <section>
        <h3>Google Drive</h3>
        <label className="drive-key">
          API key
          <input
            type="password"
            value={settings.googleDriveApiKey}
            onChange={(event) => save({ googleDriveApiKey: event.target.value.trim() })}
            placeholder="AIza..."
          />
        </label>
        <small>
          Necesaria para enumerar carpetas públicas. Restringe la clave a Google Drive API.
        </small>
      </section>
      <aside>Las contraseñas se almacenan localmente y no se envían a servicios externos.</aside>
    </div>
  );
}
