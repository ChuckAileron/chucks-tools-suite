import { useEffect, useState } from 'react';
import type { VideoFolder, VideoTrack } from './types';

type Codec = 'h264' | 'h265';
type Selections = Record<string, { audio: number[]; subtitles: number[] }>;

export default function VideoTool() {
  const [folders, setFolders] = useState<VideoFolder[]>([]);
  const [codec, setCodec] = useState<Codec>('h264');
  const [selections, setSelections] = useState<Selections>({});
  const [running, setRunning] = useState(false);
  const [globalProgress, setGlobalProgress] = useState(0);
  const [fileProgress, setFileProgress] = useState(0);
  const [activeFile, setActiveFile] = useState('Ningún archivo en proceso');
  const [activeFolder, setActiveFolder] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<{ text: string; tone?: string }[]>([]);

  useEffect(
    () =>
      window.tools.onVideoProgress((data) => {
        if (data.type === 'folder-start') {
          setActiveFolder(data.folder || '');
          addLog(`Procesando: ${data.folder}`);
        }
        if (data.type === 'info' && data.message) addLog(data.message);
        if (data.type === 'queue-progress')
          setGlobalProgress(data.total ? Math.floor(((data.current || 0) / data.total) * 100) : 0);
        if (data.type === 'file-start') {
          setActiveFile(data.file || 'Archivo');
          setFileProgress(0);
          addLog(`Convirtiendo ${data.file}`);
        }
        if (data.type === 'file-progress') setFileProgress(data.percent || 0);
        if (data.type === 'file-done') {
          setFileProgress(100);
          addLog(`${data.file} completado`, 'success');
        }
        if (data.type === 'folder-done') {
          setActiveFolder('');
          addLog(`Carpeta completada: ${data.folder}`, 'success');
        }
        if (data.type === 'error') addLog(`Error: ${data.message}`, 'error');
        if (data.type === 'cancelled' || data.type === 'all-done') {
          addLog(
            data.type === 'cancelled' ? 'Conversión cancelada.' : 'Conversión finalizada.',
            data.type === 'cancelled' ? 'error' : 'success',
          );
          setRunning(false);
          setActiveFolder('');
        }
      }),
    [],
  );

  function addLog(text: string, tone?: string) {
    setLogs((current) => [...current.slice(-99), { text, tone }]);
  }

  const inspect = async (paths: string[], selectedCodec = codec) => {
    const results = await window.tools.inspectVideoFolders({
      folders: paths,
      codec: selectedCodec,
    });
    setFolders((current) => {
      const map = new Map(current.map((folder) => [folder.folder, folder]));
      results.forEach((folder) => map.set(folder.folder, folder));
      return [...map.values()];
    });
    setSelections((current) => {
      const next = { ...current };
      for (const folder of results)
        for (const video of folder.videos)
          next[video.path] ||= {
            audio: video.audio.map((track) => track.index),
            subtitles: video.subtitles.map((track) => track.index),
          };
      return next;
    });
    return results;
  };

  const addFolders = async () => {
    const paths = await window.tools.selectVideoFolders();
    if (!paths.length) return;
    try {
      const results = await inspect(paths);
      if (running) {
        const appended = await window.tools.appendVideoFolders({
          folders: results.map((folder) => folder.folder),
          codec,
        });
        if (appended)
          addLog(
            `${results.length} carpeta${results.length === 1 ? '' : 's'} añadida${results.length === 1 ? '' : 's'} a la cola.`,
          );
      }
    } catch (error) {
      addLog(`No se pudieron inspeccionar las carpetas: ${String(error)}`, 'error');
    }
  };

  const changeCodec = async (value: Codec) => {
    setCodec(value);
    if (folders.length)
      await inspect(
        folders.map((folder) => folder.folder),
        value,
      );
  };

  const toggleTrack = (videoPath: string, type: 'audio' | 'subtitles', index: number) =>
    setSelections((current) => {
      const selected = new Set(current[videoPath]?.[type] || []);
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      return { ...current, [videoPath]: { ...current[videoPath], [type]: [...selected] } };
    });

  const start = async () => {
    setRunning(true);
    setLogs([]);
    setGlobalProgress(0);
    setFileProgress(0);
    try {
      await window.tools.startVideoConversion({
        folders: folders.map((folder) => folder.folder),
        codec,
        trackSelections: selections,
      });
    } catch (error) {
      addLog(`No se pudo iniciar: ${String(error)}`, 'error');
      setRunning(false);
    }
  };

  const removeFolder = async (folder: string) => {
    if (running && !(await window.tools.skipVideoFolder(folder))) return;
    setFolders((current) => current.filter((item) => item.folder !== folder));
  };

  const toggleFolder = (folder: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const videoCount = folders.reduce((count, folder) => count + folder.videos.length, 0);
  return (
    <section className="tool video-tool">
      <header>
        <span>SD</span>
        <div>
          <h1>Video a SD</h1>
          <p>Convierte colecciones de video a 480p para ahorrar espacio.</p>
        </div>
        <b>● FFmpeg local</b>
      </header>
      <div className="workspace">
        <div className="step">
          <span>01</span>
          <div>
            <h2>Selecciona las carpetas</h2>
            <p>Puedes procesar varias carpetas en una sola ejecución.</p>
          </div>
        </div>
        <div className="video-folder-actions">
          <button onClick={addFolders}>+ Añadir carpetas</button>
          <button disabled={running || !folders.length} onClick={() => setFolders([])}>
            Limpiar
          </button>
        </div>
        <div className="video-folders">
          {folders.length ? (
            folders.map((folder) => (
              <FolderCard
                key={folder.folder}
                folder={folder}
                selections={selections}
                controlsDisabled={running}
                removeDisabled={running && activeFolder === folder.folder}
                collapsed={collapsed.has(folder.folder)}
                onCollapse={() => toggleFolder(folder.folder)}
                onRemove={() => removeFolder(folder.folder)}
                onToggle={toggleTrack}
              />
            ))
          ) : (
            <div className="video-empty">No hay carpetas seleccionadas.</div>
          )}
        </div>
        <div className="divider" />
        <div className="step">
          <span>02</span>
          <div>
            <h2>Configura la conversión</h2>
            <p>Los originales se conservan y la salida se guarda en una subcarpeta.</p>
          </div>
        </div>
        <div className="codec-options">
          <button
            className={codec === 'h264' ? 'active' : ''}
            disabled={running}
            onClick={() => changeCodec('h264')}
          >
            <strong>H.264</strong>
            <small>Máxima compatibilidad</small>
          </button>
          <button
            className={codec === 'h265' ? 'active' : ''}
            disabled={running}
            onClick={() => changeCodec('h265')}
          >
            <strong>H.265</strong>
            <small>Mayor compresión</small>
          </button>
        </div>
        <aside className="sd-disclaimer">
          <strong>Qué implica convertir a SD</strong>
          <span>
            El video se reduce hasta 480p y se vuelve a comprimir, por lo que perderá detalle fino.
            El audio se convierte a AAC de 128 kbps; esto reduce espacio, pero también puede
            disminuir su fidelidad. Los archivos originales no se modifican.
          </span>
        </aside>
        <div className="video-progress">
          <Progress label="Progreso global" value={globalProgress} />
          <Progress label={activeFile} value={fileProgress} />
        </div>
        <div className="video-log">
          {logs.length ? (
            logs.map((item, index) => (
              <div className={item.tone} key={`${index}-${item.text}`}>
                {item.text}
              </div>
            ))
          ) : (
            <span>El registro de conversión aparecerá aquí.</span>
          )}
        </div>
        <div className="tool-action simple">
          <span>
            {videoCount} videos en {folders.length} carpetas
          </span>
          {running ? (
            <button className="cancel-button" onClick={() => window.tools.cancelVideoConversion()}>
              Cancelar conversión
            </button>
          ) : (
            <button disabled={!folders.length} onClick={start}>
              Iniciar conversión →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>
        <strong>{label}</strong>
        <b>{value}%</b>
      </span>
      <i>
        <b style={{ width: `${value}%` }} />
      </i>
    </div>
  );
}

function FolderCard({
  folder,
  selections,
  controlsDisabled,
  removeDisabled,
  collapsed,
  onCollapse,
  onRemove,
  onToggle,
}: {
  folder: VideoFolder;
  selections: Selections;
  controlsDisabled: boolean;
  removeDisabled: boolean;
  collapsed: boolean;
  onCollapse: () => void;
  onRemove: () => void;
  onToggle: (path: string, type: 'audio' | 'subtitles', index: number) => void;
}) {
  return (
    <article className={`${folder.processed ? 'processed' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <header>
        <button
          className="collapse-folder"
          onClick={onCollapse}
          aria-label={collapsed ? 'Expandir carpeta' : 'Colapsar carpeta'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span title={folder.folder}>{folder.folder}</span>
        <b>{folder.videos.length} videos</b>
        {folder.processed && <em>Completada</em>}
        <button
          disabled={removeDisabled}
          onClick={onRemove}
          title={
            removeDisabled
              ? 'No se puede quitar la carpeta que se está procesando'
              : 'Quitar carpeta'
          }
        >
          Quitar
        </button>
      </header>
      {!collapsed &&
        folder.videos.map(
          (video) =>
            (video.audio.length || video.subtitles.length || video.probeError) && (
              <details key={video.path}>
                <summary>
                  {video.file} · {video.audio.length} audio · {video.subtitles.length} subtítulos
                </summary>
                {video.probeError ? (
                  <p className="track-error">No se pudieron leer las pistas: {video.probeError}</p>
                ) : (
                  <div className="tracks">
                    <TrackGroup
                      title="Audio"
                      tracks={video.audio}
                      selected={selections[video.path]?.audio || []}
                      disabled={controlsDisabled}
                      onToggle={(index) => onToggle(video.path, 'audio', index)}
                    />
                    <TrackGroup
                      title="Subtítulos"
                      tracks={video.subtitles}
                      selected={selections[video.path]?.subtitles || []}
                      disabled={controlsDisabled}
                      onToggle={(index) => onToggle(video.path, 'subtitles', index)}
                    />
                  </div>
                )}
              </details>
            ),
        )}
    </article>
  );
}

function TrackGroup({
  title,
  tracks,
  selected,
  disabled,
  onToggle,
}: {
  title: string;
  tracks: VideoTrack[];
  selected: number[];
  disabled: boolean;
  onToggle: (index: number) => void;
}) {
  if (!tracks.length) return null;
  return (
    <section>
      <strong>{title}</strong>
      {tracks.map((track) => (
        <label key={track.index}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.includes(track.index)}
            onChange={() => onToggle(track.index)}
          />{' '}
          Pista {track.index}:{' '}
          {[track.language, track.codec, track.title].filter(Boolean).join(' · ')}
          {track.default ? ' (predeterminada)' : ''}
        </label>
      ))}
    </section>
  );
}
