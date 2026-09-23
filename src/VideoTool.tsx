import { useEffect, useState } from 'react';
import type { VideoFolder, VideoState, VideoTrack } from './types';
import { loadCollapsed, saveCollapsed } from './collapseState';

type Codec = 'h264' | 'h265';
type Selections = Record<string, { audio: number[]; subtitles: number[] }>;
const MP4_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const extensionLabel = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 && index < name.length - 1 ? name.slice(index + 1, index + 4).toUpperCase() : '';
};
const LUFS_PRESETS = [
  { value: -14, label: '-14 Streaming' },
  { value: -16, label: '-16 General' },
  { value: -18, label: '-18 Conservador' },
  { value: -23, label: '-23 Broadcast' },
];

export default function VideoTool() {
  const [folders, setFolders] = useState<VideoFolder[]>([]);
  const [codec, setCodec] = useState<Codec>('h264');
  const [selections, setSelections] = useState<Selections>({});
  const [running, setRunning] = useState(false);
  const [globalProgress, setGlobalProgress] = useState(0);
  const [fileProgress, setFileProgress] = useState(0);
  const [activeFile, setActiveFile] = useState('Sin procesos activos');
  const [activeFolder, setActiveFolder] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(loadCollapsed('video')));
  useEffect(() => {
    saveCollapsed('video', [...collapsed]);
  }, [collapsed]);
  const [logs, setLogs] = useState<{ text: string; tone?: string }[]>([]);
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [normalizeTarget, setNormalizeTarget] = useState(-16);

  useEffect(() => {
    const hydrate = (state: VideoState) => {
      setFolders(state.folders);
      setCodec(state.codec);
      setSelections(state.trackSelections);
      setRunning(state.running);
      setGlobalProgress(state.globalProgress);
      setFileProgress(state.fileProgress);
      setActiveFile(state.activeFile);
      setActiveFolder(state.activeFolder);
      setLogs(state.logs);
      setNormalizeAudio(state.normalizeAudio);
      setNormalizeTarget(state.normalizeTarget);
    };
    window.tools.getVideoState().then(hydrate);
    return window.tools.onVideoState(hydrate);
  }, []);

  function setNormalizeOptions(data: { normalizeAudio?: boolean; normalizeTarget?: number }) {
    if (typeof data.normalizeAudio === 'boolean') setNormalizeAudio(data.normalizeAudio);
    if (typeof data.normalizeTarget === 'number') setNormalizeTarget(data.normalizeTarget);
    window.tools.setVideoNormalize(data);
  }

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
        for (const video of folder.videos) {
          if (!video.audio.length && !video.subtitles.length) continue;
          const pickDefaults = (tracks: { index: number; default?: boolean }[]) => {
            const flagged = tracks.filter((track) => track.default);
            return (flagged.length ? flagged : tracks.slice(0, 1)).map((track) => track.index);
          };
          next[video.path] ||= {
            audio: pickDefaults(video.audio),
            subtitles: pickDefaults(
              video.subtitles.filter((track) => MP4_SUBTITLE_CODECS.has(track.codec)),
            ),
          };
        }
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

  const selectTracks = (videoPath: string, type: 'audio' | 'subtitles', indices: number[]) =>
    setSelections((current) => ({
      ...current,
      [videoPath]: { ...current[videoPath], [type]: indices },
    }));

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
        normalizeAudio,
        normalizeTarget,
      });
    } catch (error) {
      addLog(`No se pudo iniciar: ${String(error)}`, 'error');
      setRunning(false);
    }
  };

  const clear = async () => {
    setFolders([]);
    setLogs([]);
    setGlobalProgress(0);
    setFileProgress(0);
    setActiveFile('Sin procesos activos');
    setActiveFolder('');
    await window.tools.clearVideoState();
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
  const processedCount = folders.reduce(
    (count, folder) => count + folder.videos.filter((video) => video.processed).length,
    0,
  );
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
          <span>1</span>
          <div>
            <h2>Selecciona las carpetas</h2>
            <p>Puedes procesar varias carpetas en una sola ejecución.</p>
          </div>
        </div>
        <div className="video-folder-actions">
          <button onClick={addFolders}>+ Añadir carpetas</button>
          <button disabled={running || !folders.length} onClick={clear}>
            Limpiar
          </button>
        </div>
        {folders.length ? (
          <div className="results vfs-results">
            <div>
              <label>
                {videoCount} video{videoCount === 1 ? '' : 's'} en {folders.length} carpeta
                {folders.length === 1 ? '' : 's'}
              </label>
              <span>
                {processedCount} procesado{processedCount === 1 ? '' : 's'}
              </span>
            </div>
            <section className="video-folders">
              {folders.map((folder) => (
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
                  onSelect={selectTracks}
                />
              ))}
            </section>
          </div>
        ) : (
          <div className="video-empty">No hay carpetas seleccionadas.</div>
        )}
        <div className="divider" />
        <div
          className={`step${!folders.length ? ' locked' : ''}`}
          title={!folders.length ? 'Completa el paso 1 para desbloquear.' : undefined}
        >
          <span>2</span>
          <div>
            <h2>Configura la conversión</h2>
            <p>Los originales se conservan y la salida se guarda en una subcarpeta.</p>
          </div>
        </div>
        <div className="codec-options">
          <button
            className={codec === 'h264' ? 'active' : ''}
            disabled={running || !folders.length}
            onClick={() => changeCodec('h264')}
          >
            <strong>H.264</strong>
            <small>Máxima compatibilidad</small>
          </button>
          <button
            className={codec === 'h265' ? 'active' : ''}
            disabled={running || !folders.length}
            onClick={() => changeCodec('h265')}
          >
            <strong>H.265</strong>
            <small>Mayor compresión</small>
          </button>
        </div>
        <div className="video-normalize-row">
          <label>
            <input
              type="checkbox"
              disabled={running || !folders.length}
              checked={normalizeAudio}
              onChange={(event) => setNormalizeOptions({ normalizeAudio: event.target.checked })}
            />
            <span>Normalizar audio</span>
            <small>Loudnorm en la misma conversión</small>
          </label>
          {normalizeAudio && (
            <div className="lufs-presets">
              {LUFS_PRESETS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  disabled={running || !folders.length}
                  className={normalizeTarget === value ? 'active' : ''}
                  onClick={() => setNormalizeOptions({ normalizeTarget: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="sd-disclaimer">
          <strong>Qué implica convertir a SD</strong>
          <span>
            El video se reduce hasta 480p y se comprime en MP4, por lo que perderá detalle fino. El
            audio se convierte a AAC de 128 kbps. Los subtítulos de texto se convierten a mov_text;
            PGS y VobSub se omiten por incompatibilidad con MP4. Los originales no se modifican.
          </span>
        </aside>
        <div className="normalize-progress">
          <span>
            <strong>Progreso global</strong>
            <b>{globalProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${globalProgress}%` }} />
          </i>
          {videoCount > 0 && (
            <em>
              {processedCount} de {videoCount} archivos procesados
            </em>
          )}
          <br />
          <span>
            <strong>{activeFile}</strong>
            <b>{fileProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${fileProgress}%` }} />
          </i>
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

function FolderCard({
  folder,
  selections,
  controlsDisabled,
  removeDisabled,
  collapsed,
  onCollapse,
  onRemove,
  onToggle,
  onSelect,
}: {
  folder: VideoFolder;
  selections: Selections;
  controlsDisabled: boolean;
  removeDisabled: boolean;
  collapsed: boolean;
  onCollapse: () => void;
  onRemove: () => void;
  onToggle: (path: string, type: 'audio' | 'subtitles', index: number) => void;
  onSelect: (path: string, type: 'audio' | 'subtitles', indices: number[]) => void;
}) {
  const doneCount = folder.videos.filter((video) => video.processed).length;
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
        <em>
          {doneCount} de {folder.videos.length}
          {folder.processed ? ' · Completada' : ''}
        </em>
      </header>
      {!collapsed &&
        folder.videos.map((video) => (
          <details key={video.path}>
            <summary>
              <b className="video-ext">{extensionLabel(video.file)}</b>
              <span className="summary-info">
                {video.file}
                {!!(video.audio.length || video.subtitles.length) && (
                  <>
                    {' · '}
                    {video.audio.length} audio · {video.subtitles.length} subtítulos
                  </>
                )}
              </span>
              {video.processed && (
                <em className="file-check" title="Archivo procesado">
                  ✓
                </em>
              )}
            </summary>
            {video.probeError ? (
              <p className="track-error">No se pudieron leer las pistas: {video.probeError}</p>
            ) : video.audio.length || video.subtitles.length ? (
              <div className="tracks">
                <TrackGroup
                  title="Audio"
                  tracks={video.audio}
                  selected={selections[video.path]?.audio || []}
                  disabled={controlsDisabled}
                  onToggle={(index) => onToggle(video.path, 'audio', index)}
                  onSelect={(indices) => onSelect(video.path, 'audio', indices)}
                />
                <TrackGroup
                  title="Subtítulos"
                  tracks={video.subtitles}
                  selected={selections[video.path]?.subtitles || []}
                  disabled={controlsDisabled}
                  onToggle={(index) => onToggle(video.path, 'subtitles', index)}
                  onSelect={(indices) => onSelect(video.path, 'subtitles', indices)}
                />
              </div>
            ) : (
              <p className="track-note">
                Sin pistas detalladas; la conversión conserva las pistas originales.
              </p>
            )}
          </details>
        ))}
    </article>
  );
}

function TrackGroup({
  title,
  tracks,
  selected,
  disabled,
  onToggle,
  onSelect,
}: {
  title: string;
  tracks: VideoTrack[];
  selected: number[];
  disabled: boolean;
  onToggle: (index: number) => void;
  onSelect: (indices: number[]) => void;
}) {
  if (!tracks.length) return null;
  const selectable = tracks.filter(
    (track) => !(title === 'Subtítulos' && !MP4_SUBTITLE_CODECS.has(track.codec)),
  );
  const allSelected =
    selectable.length > 0 && selectable.every((track) => selected.includes(track.index));
  const noneSelected = selectable.every((track) => !selected.includes(track.index));
  const indices = selectable.map((track) => track.index);
  return (
    <section>
      <div className="tracks-header">
        <strong>{title}</strong>
        {selectable.length > 0 && (
          <span>
            <button
              type="button"
              disabled={disabled || allSelected}
              onClick={() => onSelect(indices)}
            >
              Todo
            </button>
            <button type="button" disabled={disabled || noneSelected} onClick={() => onSelect([])}>
              Ninguno
            </button>
          </span>
        )}
      </div>
      {tracks.map((track) => {
        const incompatible = title === 'Subtítulos' && !MP4_SUBTITLE_CODECS.has(track.codec);
        return (
          <label className={incompatible ? 'track-incompatible' : ''} key={track.index}>
            <input
              type="checkbox"
              disabled={disabled || incompatible}
              checked={selected.includes(track.index)}
              onChange={() => onToggle(track.index)}
            />{' '}
            Pista {track.index}:{' '}
            {[track.language, track.codec, track.title].filter(Boolean).join(' · ')}
            {track.default ? ' (predeterminada)' : ''}
            {incompatible ? ' · no compatible con MP4' : ''}
          </label>
        );
      })}
    </section>
  );
}
