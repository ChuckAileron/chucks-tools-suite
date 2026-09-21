import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  DownloadCandidate,
  DownloadDiskInfo,
  DownloadPriority,
  DownloadSettings,
  DownloadsState,
  DownloadTask,
  VideoQualityOption,
} from './types';
import { loadCollapsed, saveCollapsed } from './collapseState';

type Tab = 'downloads' | 'collector' | 'settings';
const EMPTY: DownloadsState = {
  settings: {
    defaultDirectory: '',
    defaultDeleteArchive: true,
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
  completed: 'Finalizada',
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
  const [disk, setDisk] = useState<DownloadDiskInfo | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(() => loadCollapsed('downloads'));
  useEffect(() => {
    saveCollapsed('downloads', collapsed);
  }, [collapsed]);
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
      // Enlaces ya en cola/descargando no se vuelven a identificar, a menos
      // que la tarea se haya borrado o ya haya finalizado.
      const active = new Set(
        state.tasks.filter((task) => task.status !== 'completed').map((task) => task.originalUrl),
      );
      return [
        ...current,
        ...found
          .filter((item) => !existing.has(key(item)) && !active.has(item.originalUrl))
          .map((item) => ({
            ...item,
            destination: state.settings.defaultDirectory,
            priority: 'medium' as DownloadPriority,
            extract: true,
            deleteArchive: state.settings.defaultDeleteArchive !== false,
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
  useEffect(() => {
    let live = true;
    const load = () =>
      window.tools
        .getDownloadDiskInfo()
        .then((info) => live && setDisk(info))
        .catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
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
  const deleteCandidates = (ids: string[]) =>
    setCandidates((current) => current.filter((item) => !ids.includes(item.id)));
  const deleteCollection = (collection: string) =>
    setCandidates((current) =>
      current.filter((item) => (item.collection || 'Sin colección') !== collection),
    );
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
            disk={disk}
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
            isCollapsed={isCollapsed}
            toggleCollapsed={toggleCollapsed}
            deleteCandidates={deleteCandidates}
            deleteCollection={deleteCollection}
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

function LinksModal({ links, onClose }: { links: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = links.join('\n');
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="image-search-overlay" onClick={onClose}>
      <div className="links-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Todos los enlaces</h2>
            <p>{links.length} enlace{links.length === 1 ? '' : 's'} en la cola de descargas.</p>
          </div>
        </header>
        <textarea className="links-modal-text" readOnly value={text} />
        <footer>
          <span>{copied ? 'Copiado ✓' : ''}</span>
          <div>
            <button onClick={copyAll} disabled={!links.length}>
              Copiar todos
            </button>
            <button onClick={onClose}>Cerrar</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function DownloadsTab({
  tasks,
  disk,
  isCollapsed,
  toggleCollapsed,
}: {
  tasks: DownloadTask[];
  disk: DownloadDiskInfo | null;
  isCollapsed: (key: string) => boolean;
  toggleCollapsed: (key: string) => void;
}) {
  const [showLinks, setShowLinks] = useState(false);
  const groups = Map.groupBy(tasks, (task) => task.destination);
  const setGroupPassword = async (groupTasks: DownloadTask[], label: string) => {
    const eligible = groupTasks.filter((task) => task.status !== 'completed');
    if (!eligible.length) return;
    const value = prompt(
      `Contraseña para ${label} (${eligible.length} archivo${eligible.length === 1 ? '' : 's'}):`,
    );
    if (value === null) return;
    for (const task of eligible) {
      // Si el archivo ya se descargó (tiene filePath), la contraseña se usa
      // para reintentar la extracción de inmediato en vez de solo guardarla.
      if (task.filePath) await window.tools.retryExtraction(task.id, value);
      else await window.tools.updateDownload(task.id, { password: value });
    }
  };
  const groupSpeed = (groupTasks: DownloadTask[]) =>
    groupTasks
      .filter((task) => task.status === 'downloading')
      .reduce((total, task) => total + (task.speed || 0), 0);
  const controlGroup = (groupTasks: DownloadTask[], action: string, confirmMessage?: string) => {
    const ids = groupTasks
      .filter((task) => {
        if (action === 'pause') return task.status === 'downloading';
        if (action === 'resume') return ['paused', 'stopped', 'error'].includes(task.status);
        if (action === 'stop') return ['downloading', 'paused', 'pending'].includes(task.status);
        if (action === 'remove') return true;
        return false;
      })
      .map((task) => task.id);
    if (!ids.length) return;
    if (confirmMessage && !confirm(confirmMessage)) return;
    void window.tools.controlDownloads(ids, action);
  };
  const hasAnyDownloading = tasks.some((task) => task.status === 'downloading');
  const hasAnyResumable = tasks.some((task) => ['paused', 'stopped', 'error'].includes(task.status));
  const hasAnyStoppable = tasks.some((task) =>
    ['downloading', 'paused', 'pending'].includes(task.status),
  );
  return (
    <>
      {showLinks && (
        <LinksModal
          links={tasks.map((task) => task.originalUrl)}
          onClose={() => setShowLinks(false)}
        />
      )}
      <div className="downloads-toolbar">
        <span>
          {tasks.length} descargas · {tasks.filter((task) => task.status === 'downloading').length}{' '}
          activas
        </span>
        <span className="downloads-disk" title="Espacio del disco predeterminado (C:)">
          {disk
            ? `Disco ${disk.drive} ${formatSize(disk.free)} libres de ${formatSize(disk.total)}`
            : 'Disco —'}
        </span>
        <div className="downloads-toolbar-actions">
          <button
            disabled={!hasAnyDownloading}
            title="Pausar todas las descargas"
            onClick={() => controlGroup(tasks, 'pause')}
          >
            Ⅱ Pausar todo
          </button>
          <button
            disabled={!hasAnyResumable}
            title="Continuar todas las descargas"
            onClick={() => controlGroup(tasks, 'resume')}
          >
            ▶ Continuar todo
          </button>
          <button
            disabled={!hasAnyStoppable}
            title="Detener todas las descargas"
            onClick={() =>
              controlGroup(tasks, 'stop', `¿Detener las ${tasks.length} descargas de la lista?`)
            }
          >
            ■ Detener todo
          </button>
          <button disabled={!tasks.length} onClick={() => setShowLinks(true)}>
            Listar enlaces
          </button>
          <button
            disabled={!tasks.some((task) => task.status === 'completed')}
            onClick={() => window.tools.clearCompletedDownloads()}
          >
            Limpiar completadas
          </button>
        </div>
      </div>
      {tasks.length ? (
        [...groups].map(([directory, items]) => {
          const groupKey = `dir:${directory}`;
          const groupProgress = progressOf(items);
          const groupComplete =
            items.length > 0 && items.every((task) => task.status === 'completed');
          const speed = groupSpeed(items);
          const hasDownloading = items.some((task) => task.status === 'downloading');
          const hasResumable = items.some((task) =>
            ['paused', 'stopped', 'error'].includes(task.status),
          );
          const hasStoppable = items.some((task) =>
            ['downloading', 'paused', 'pending'].includes(task.status),
          );
          const hasRemovable = items.length > 0;
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
                  </span>
                  <small>
                    {items.length} archivos · {groupProgress}%
                    {speed > 0 && ` · ${formatSize(speed)}/s`}
                  </small>
                  {groupComplete && <em title="Grupo completado">✓</em>}
                </div>
                <div className="download-group-actions">
                  {hasDownloading && (
                    <button
                      className="download-group-toggle"
                      type="button"
                      onClick={() => controlGroup(items, 'pause')}
                      title="Pausar grupo"
                      aria-label={`Pausar ${directory}`}
                    >
                      Ⅱ
                    </button>
                  )}
                  {hasResumable && (
                    <button
                      className="download-group-toggle"
                      type="button"
                      onClick={() => controlGroup(items, 'resume')}
                      title="Continuar grupo"
                      aria-label={`Continuar ${directory}`}
                    >
                      ▶
                    </button>
                  )}
                  {hasStoppable && (
                    <button
                      className="download-group-toggle"
                      type="button"
                      onClick={() => controlGroup(items, 'stop')}
                      title="Detener grupo"
                      aria-label={`Detener ${directory}`}
                    >
                      ■
                    </button>
                  )}
                  <button
                    className="download-group-toggle"
                    type="button"
                    onClick={() => void setGroupPassword(items, `el grupo "${directory}"`)}
                    title="Contraseña para todo el grupo"
                    aria-label={`Contraseña para ${directory}`}
                  >
                    ⌕
                  </button>
                  <button
                    className="download-group-toggle"
                    type="button"
                    onClick={() => void window.tools.showDownloadDirectory(directory)}
                    title="Mostrar carpeta en el explorador"
                    aria-label={`Mostrar carpeta ${directory}`}
                  >
                    ▣
                  </button>
                  {hasRemovable && (
                    <button
                      className="download-group-toggle"
                      type="button"
                      onClick={() =>
                        controlGroup(
                          items,
                          'remove',
                          `¿Borrar ${items.length} descarga${items.length === 1 ? '' : 's'} de "${directory}"?`,
                        )
                      }
                      title="Borrar grupo"
                      aria-label={`Borrar ${directory}`}
                    >
                      ×
                    </button>
                  )}
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
                        <div className="collection-head">
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
                          <button
                            className="download-group-toggle"
                            type="button"
                            onClick={() =>
                              void setGroupPassword(collectionTasks, `la colección "${collection}"`)
                            }
                            title="Contraseña para toda la colección"
                            aria-label={`Contraseña para ${collection}`}
                          >
                            ⌕
                          </button>
                        </div>
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
  // Cualquier tarea puede borrarse en cualquier estado; si está descargando
  // o extrayendo (p. ej. quedó colgada) se pide confirmación primero.
  const removable = true;
  const remove = () => {
    if (
      ['downloading', 'extracting'].includes(task.status) &&
      !confirm(`¿Detener y borrar la descarga de "${task.name}"?`)
    )
      return;
    void window.tools.controlDownload(task.id, 'remove');
  };
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
          <button title="Quitar" onClick={remove}>
            ×
          </button>
        )}
      </div>
      {task.error && <p>{task.error}</p>}
    </article>
  );
}

const BEST_QUALITY: VideoQualityOption = { label: 'Mejor calidad', videoFormat: 'video:best' };

// Selector de resolución para los videos de una lista de YouTube. Las
// calidades reales del video se piden bajo demanda (al abrir el selector) en
// vez de al identificar la lista completa, para no disparar cientos de
// consultas a yt-dlp cuando se identifica una lista grande.
function QualitySelect({
  url,
  value,
  onChange,
}: {
  url: string;
  value: string;
  onChange: (videoFormat: string) => void;
}) {
  const [options, setOptions] = useState<VideoQualityOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = () => {
    if (options || loading) return;
    setLoading(true);
    window.tools
      .getVideoQualityOptions(url)
      .then((result) => setOptions(result.length ? result : [BEST_QUALITY]))
      .catch(() => setOptions([BEST_QUALITY]))
      .finally(() => setLoading(false));
  };
  const known = options && options.length ? options : [BEST_QUALITY];
  const hasCurrentValue = known.some((option) => option.videoFormat === value);
  return (
    <select
      className="candidate-quality"
      value={value}
      title="Resolución a descargar"
      onFocus={load}
      onChange={(event) => onChange(event.target.value)}
    >
      {!hasCurrentValue && <option value={value}>{value}</option>}
      {known.map((option) => (
        <option value={option.videoFormat} key={option.videoFormat}>
          {option.label}
        </option>
      ))}
      {loading && (
        <option value="" disabled>
          Cargando calidades…
        </option>
      )}
    </select>
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
  isCollapsed: (key: string) => boolean;
  toggleCollapsed: (key: string) => void;
  deleteCandidates: (ids: string[]) => void;
  deleteCollection: (collection: string) => void;
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
  isCollapsed,
  toggleCollapsed,
  deleteCandidates,
  deleteCollection,
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
      {candidates.length ? (
        [...Map.groupBy(candidates, (item) => item.collection || 'Sin colección')].map(
          ([collection, items]) => {
            const groupKey = `colc:${collection}`;
            return (
              <section
                className={`collector-group ${isCollapsed(groupKey) ? 'collapsed' : ''}`}
                key={groupKey}
              >
                <div className="collector-group-head">
                  <button
                    className="collector-group-toggle"
                    type="button"
                    onClick={() => toggleCollapsed(groupKey)}
                    title={`${isCollapsed(groupKey) ? 'Expandir colección' : 'Colapsar colección'}`}
                    aria-label={`${isCollapsed(groupKey) ? 'Expandir' : 'Colapsar'} ${collection}`}
                  >
                    {isCollapsed(groupKey) ? '▸' : '▾'}
                  </button>
                  <strong className="collector-group-title" title={collection}>
                    {collection}
                  </strong>
                  <small className="collector-group-count">
                    {items.length} enlace{items.length === 1 ? '' : 's'}
                  </small>
                  <button
                    className="collector-group-delete"
                    type="button"
                    title={`Eliminar la colección ${collection}`}
                    aria-label={`Eliminar colección ${collection}`}
                    onClick={() => {
                      if (
                        confirm(
                          `¿Eliminar la colección "${collection}" (${items.length} enlace${items.length === 1 ? '' : 's'} identificados)?`,
                        )
                      )
                        deleteCollection(collection);
                    }}
                  >
                    ×
                  </button>
                </div>
                {!isCollapsed(groupKey) &&
                  items.map((item) => (
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
                        <span className="candidate-controls">
                          <input
                            className="candidate-collection"
                            value={item.collection || ''}
                            onChange={(event) =>
                              update(item.id, { collection: event.target.value })
                            }
                            placeholder="Colección"
                          />
                          <label
                            className="candidate-delete-archive"
                            title="Eliminar el comprimido original después de la extracción"
                          >
                            <input
                              type="checkbox"
                              checked={item.deleteArchive !== false}
                              onChange={(event) =>
                                update(item.id, { deleteArchive: event.target.checked })
                              }
                            />
                            <span>Eliminar comprimido</span>
                          </label>
                        </span>
                      </div>
                      {item.mode === 'Playlist' && item.videoUrl ? (
                        <QualitySelect
                          url={item.videoUrl}
                          value={item.videoFormat || 'video:best'}
                          onChange={(videoFormat) => update(item.id, { videoFormat })}
                        />
                      ) : (
                        <span className="candidate-quality-placeholder" aria-hidden="true" />
                      )}
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
                      <button
                        title="Eliminar enlace identificado"
                        aria-label={`Eliminar ${item.name}`}
                        onClick={() => deleteCandidates([item.id])}
                      >
                        ×
                      </button>
                    </article>
                  ))}
              </section>
            );
          },
        )
      ) : (
        <div className="collector-empty">
          <b>↓</b>
          <span>Identifica enlaces o pega texto para agruparlos en colecciones.</span>
        </div>
      )}
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
        <label className="check">
          <input
            type="checkbox"
            checked={settings.clipboard}
            onChange={(event) => save({ clipboard: event.target.checked })}
          />{' '}
          Detectar enlaces copiados
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoExtract}
            onChange={(event) => save({ autoExtract: event.target.checked })}
          />{' '}
          Extraer comprimidos automáticamente
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.defaultDeleteArchive !== false}
            onChange={(event) => save({ defaultDeleteArchive: event.target.checked })}
          />{' '}
          Eliminar comprimidos tras extraer (por defecto)
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
