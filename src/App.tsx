import { useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';
import MoverTool from './MoverTool';
import RenameTool from './RenameTool';
import VideoTool from './VideoTool';
import NormalizeTool from './NormalizeTool';
import AnalogReplayTool from './AnalogReplayTool';
import DownloadsTool from './DownloadsTool';
import CollectionTool from './CollectionTool';
import HddInventoryTool from './HddInventoryTool';
import MediaPlayerTool from './MediaPlayerTool';
import TrimTool from './TrimTool';
import BinderTrackTool from './BinderTrackTool';
import ChuckBotTool from './ChuckBotTool';
import WikiTool from './WikiTool';
import HijitosTool from './HijitosTool';
import ImageTool from './ImageTool';
import type {
  ChuckBotOllamaStatus,
  ChuckBotServerStatus,
  DownloadCandidate,
  DownloadPriority,
  DownloadsState,
  HddDrive,
  HddEntry,
  MediaOrigin,
  NormalizeState,
  NowPlaying,
  TrimState,
  VideoState,
} from './types';
type Tool =
  | 'mover'
  | 'rename'
  | 'video'
  | 'normalize'
  | 'downloads'
  | 'collection'
  | 'replay'
  | 'hdd'
  | 'media'
  | 'trim'
  | 'bindertrack'
  | 'chuckbot'
  | 'wiki'
  | 'hijitos'
  | 'image';
type Theme = 'light' | 'dark';
const THEME_KEY = 'chucks-tools-theme';
function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage no disponible
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const EMPTY_DOWNLOADS: DownloadsState = {
  settings: {
    defaultDirectory:     '',
    defaultDeleteArchive: true,
    concurrency:          3,
    autoExtract:          true,
    clipboard:            true,
    googleDriveApiKey:    '',
  },
  tasks: [],
};
const EMPTY_VIDEO: VideoState         = {
  running:               false,
  codec:                 'h264',
  folders:               [],
  trackSelections:       {},
  globalProgress:        0,
  fileProgress:          0,
  activeFile:            'Sin procesos activos',
  activeFolder:          '',
  logs:                  [],
  normalizeAudio:        false,
  normalizeTarget:       -16,
  concurrencyPreference: 'auto',
  concurrency:           0,
};
const EMPTY_NORMALIZE: NormalizeState = {
  running:        false,
  globalProgress: 0,
  fileProgress:   0,
  activeFile:     'Sin procesos activos',
  message:        '',
  targetDb:       -16,
  folders:        [],
  type:           'audio',
  files:          [],
  selected:       [],
  processed:      [],
  logs:           [],
};
const EMPTY_TRIM: TrimState           = {
  running:        false,
  globalProgress: 0,
  fileProgress:   0,
  activeFile:     'Sin procesos activos',
  message:        '',
  folders:        [],
  type:           'audio',
  files:          [],
  selected:       [],
  processed:      [],
  settings:       {},
  logs:           [],
};
export default function App() {
  const [tool, setTool]   = useState<Tool>('hijitos');
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // localStorage no disponible
    }
  }, [theme]);
  const toggleTheme                         = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  const [downloads, setDownloads]           = useState<DownloadsState>(EMPTY_DOWNLOADS);
  const [video, setVideo]                   = useState<VideoState>(EMPTY_VIDEO);
  const [normalize, setNormalize]           = useState<NormalizeState>(EMPTY_NORMALIZE);
  const [trim, setTrim]                     = useState<TrimState>(EMPTY_TRIM);
  const [candidates, setCandidates]         = useState<DownloadCandidate[]>([]);
  const [downloadNotice, setDownloadNotice] = useState(0);
  // Estado del Inventario HDD elevado a App para poder recordar la
  // navegación del usuario (disco/carpeta) al volver desde el reproductor.
  const [hddActiveDriveId, setHddActiveDriveId] = useState<number | null>(null);
  const [hddParentPath, setHddParentPath]       = useState('');
  const [nowPlaying, setNowPlaying]             = useState<NowPlaying | null>(null);
  const [mediaOrigin, setMediaOrigin]           = useState<MediaOrigin>(null);
  // Estado de ChuckBot elevado a App: el estado del servidor y de Ollama se
  // consultan de forma continua mientras la app está abierta, de modo que al
  // cambiar de sección y volver, el encendido se conserva (solo se apaga por
  // acción del usuario o al salir del programa).
  const [chuckbotServer, setChuckbotServer] = useState<ChuckBotServerStatus>({
    running: false,
  });
  const [chuckbotOllama, setChuckbotOllama] = useState<ChuckBotOllamaStatus>({
    running: false,
  });
  useEffect(() => {
    const pollChuckbot = () => {
      window.tools
        .chuckbotStatus()
        .then(setChuckbotServer)
        .catch(() => setChuckbotServer({ running: false }));
      window.tools
        .chuckbotOllamaStatus()
        .then(setChuckbotOllama)
        .catch(() => setChuckbotOllama({ running: false }));
    };
    pollChuckbot();
    const timer = window.setInterval(pollChuckbot, 4000);
    return () => window.clearInterval(timer);
  }, []);
  const playFromHdd        = (drive: HddDrive, entry: HddEntry) => {
    setNowPlaying({ drive, entry });
    setMediaOrigin('hdd');
    setTool('media');
  };
  const backFromMediaToHdd = () => {
    setMediaOrigin(null);
    setTool('hdd');
  };
  const mergeCandidates    = (found: DownloadCandidate[]) =>
    setCandidates((current) => {
      const key      = (item: DownloadCandidate) => `${item.originalUrl}|${item.mode || ''}`;
      const existing = new Set(current.map(key));
      return [
        ...current,
        ...found
          .filter((item) => !existing.has(key(item)))
          .map((item) => ({
            ...item,
            destination:   downloads.settings.defaultDirectory,
            priority:      'medium' as DownloadPriority,
            extract:       true,
            deleteArchive: downloads.settings.defaultDeleteArchive !== false,
          })),
      ];
    });
  const captureClipboard = useEffectEvent(async (value: string) => {
    try {
      const found = await window.tools.analyzeDownloads(value);
      mergeCandidates(found);
      if (found.length && tool !== 'downloads') setDownloadNotice((n) => n + found.length);
    } catch {
      // sin enlaces detectables
    }
  });
  useEffect(() => {
    window.tools.getDownloads().then(setDownloads);
    window.tools.getVideoState().then(setVideo);
    window.tools.getNormalizeState().then(setNormalize);
    window.tools.getTrimState().then(setTrim);
    const stopDownloads = window.tools.onDownloadsState(setDownloads);
    const stopVideo     = window.tools.onVideoState(setVideo);
    const stopNormalize = window.tools.onNormalizeState(setNormalize);
    const stopTrim      = window.tools.onTrimState(setTrim);
    const stopClipboard = window.tools.onClipboardLinks(captureClipboard);
    return () => {
      stopDownloads();
      stopVideo();
      stopNormalize();
      stopTrim();
      stopClipboard();
    };
  }, []);
  const downloadProgress = downloads.tasks.length
    ? Math.round(
        downloads.tasks.reduce(
          (total, task) => total + (task.status === 'completed' ? 100 : task.progress),
          0,
        ) / downloads.tasks.length,
      )
    : 0;
  return (
    <div className="suite">
      <aside className="sidebar">
        <div className="suite-brand">
          <span>CT</span>
          <div>
            <strong>CHUCK's</strong>
            <small>Tools Suite</small>
          </div>
        </div>
        <nav>
          <p>HERRAMIENTAS</p>
          <button className={tool === 'hijitos' ? 'active' : ''} onClick={() => setTool('hijitos')}>
            <i>
              <CatIcon />
            </i>
            <span>
              <strong>Hijitos ❤</strong>
              <small>Tareas por gatito</small>
            </span>
          </button>
          <button
            className={tool === 'collection' ? 'active' : ''}
            onClick={() => setTool('collection')}
          >
            <i>
              <BookIcon />
            </i>
            <span>
              <strong>Colección</strong>
              <small>Catálogo local</small>
            </span>
          </button>
          <button
            className={tool === 'bindertrack' ? 'active' : ''}
            onClick={() => setTool('bindertrack')}
          >
            <i>
              <BinderTrackIcon />
            </i>
            <span>
              <strong>BinderTrack</strong>
              <small>Mantenedor TCG</small>
            </span>
          </button>
          <button
            className={tool === 'chuckbot' ? 'active' : ''}
            onClick={() => setTool('chuckbot')}
          >
            <i>
              <ChuckBotIcon />
            </i>
            <span>
              <strong>ChuckBot</strong>
              <small>IA local</small>
            </span>
          </button>
          <button className={tool === 'wiki' ? 'active' : ''} onClick={() => setTool('wiki')}>
            <i>
              <WikiIcon />
            </i>
            <span>
              <strong>Wiki</strong>
              <small>Base de conocimiento</small>
            </span>
          </button>
          <button
            className={tool === 'downloads' ? 'active' : ''}
            onClick={() => {
              setTool('downloads');
              setDownloadNotice(0);
            }}
          >
            <i>↓</i>
            <span>
              <strong>Descargas</strong>
              <small>Gestor de enlaces</small>
              <SidebarProgress
                value={downloadProgress}
                label={downloads.tasks.length ? `${downloadProgress}% global` : 'Sin tareas'}
                active={downloads.tasks.some((task) =>
                  ['pending', 'downloading', 'extracting'].includes(task.status),
                )}
              />
            </span>
            {downloadNotice > 0 && (
              <em className="nav-notice" title="Nuevos enlaces capturados">
                {downloadNotice}
              </em>
            )}
          </button>
          <button className={tool === 'mover' ? 'active' : ''} onClick={() => setTool('mover')}>
            <i>↗</i>
            <span>
              <strong>Organizar archivos</strong>
              <small>Mover por tipo</small>
            </span>
          </button>
          <button className={tool === 'rename' ? 'active' : ''} onClick={() => setTool('rename')}>
            <i>Aa</i>
            <span>
              <strong>Renombrar archivos</strong>
              <small>Edición en lote</small>
            </span>
          </button>
          <button className={tool === 'trim' ? 'active' : ''} onClick={() => setTool('trim')}>
            <i>
              <ScissorsIcon />
            </i>
            <span>
              <strong>Cortar audio/video</strong>
              <small>Recortar archivos</small>
              <SidebarProgress
                value={trim.globalProgress}
                label={trim.running ? `${trim.globalProgress}% global` : 'Sin tareas'}
                active={trim.running}
              />
            </span>
          </button>
          <button className={tool === 'video' ? 'active' : ''} onClick={() => setTool('video')}>
            <i>
              <img src="icons/sd-card.png" alt="" aria-hidden="true" />
            </i>
            <span>
              <strong>Video a SD</strong>
              <small>Conversión a 480p</small>
              <SidebarProgress
                value={video.globalProgress}
                label={video.folders.length ? `${video.globalProgress}% global` : 'Sin tareas'}
                active={video.running}
              />
            </span>
          </button>
          <button
            className={tool === 'normalize' ? 'active' : ''}
            onClick={() => setTool('normalize')}
          >
            <i>
              <VolumeIcon />
            </i>
            <span>
              <strong>Normalizar volumen</strong>
              <small>Audio y video</small>
              <SidebarProgress
                value={normalize.globalProgress}
                label={normalize.running ? `${normalize.globalProgress}% global` : 'Sin tareas'}
                active={normalize.running}
              />
            </span>
          </button>
          <button className={tool === 'replay' ? 'active' : ''} onClick={() => setTool('replay')}>
            <i>
              <TvIcon />
            </i>
            <span>
              <strong>AnalogReplayTV</strong>
              <small>Configuración TV</small>
            </span>
          </button>
          <button className={tool === 'image' ? 'active' : ''} onClick={() => setTool('image')}>
            <i>
              <ImageIcon />
            </i>
            <span>
              <strong>Convertir imágenes</strong>
              <small>Cambio de formato</small>
            </span>
          </button>
          <button className={tool === 'hdd' ? 'active' : ''} onClick={() => setTool('hdd')}>
            <i>
              <HddIcon />
            </i>
            <span>
              <strong>Inventario HDD</strong>
              <small>Catálogo de discos</small>
            </span>
          </button>
          <button className={tool === 'media' ? 'active' : ''} onClick={() => setTool('media')}>
            <i>
              <PlayIcon />
            </i>
            <span>
              <strong>Reproductor</strong>
              <small>Video, audio e imágenes</small>
            </span>
          </button>
        </nav>
        <button
          className="theme-toggle"
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          <i>{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</i>
          <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
        </button>
        <div className="local">
          <b>● Todo permanece local</b>
          <small>Tus archivos nunca salen de este equipo.</small>
        </div>
        <footer>
          CHUCK's Tools Suite <span>v1.10</span>
        </footer>
      </aside>
      <main className="content">
        <div className="mobile-brand">CHUCK's Tools Suite</div>
        {tool === 'mover' ? (
          <MoverTool />
        ) : tool === 'hijitos' ? (
          <HijitosTool />
        ) : tool === 'rename' ? (
          <RenameTool />
        ) : tool === 'video' ? (
          <VideoTool />
        ) : tool === 'normalize' ? (
          <NormalizeTool />
        ) : tool === 'trim' ? (
          <TrimTool />
        ) : tool === 'replay' ? (
          <AnalogReplayTool />
        ) : tool === 'collection' ? (
          <CollectionTool />
        ) : tool === 'bindertrack' ? (
          <BinderTrackTool />
        ) : tool === 'wiki' ? (
          <WikiTool />
        ) : tool === 'chuckbot' ? (
          <ChuckBotTool
            server={chuckbotServer}
            ollama={chuckbotOllama}
            onServerChange={setChuckbotServer}
            onOllamaChange={setChuckbotOllama}
          />
        ) : tool === 'hdd' ? (
          <HddInventoryTool
            activeDriveId={hddActiveDriveId}
            onActiveDriveIdChange={setHddActiveDriveId}
            parentPath={hddParentPath}
            onParentPathChange={setHddParentPath}
            onPlay={playFromHdd}
          />
        ) : tool === 'media' ? (
          <MediaPlayerTool
            nowPlaying={nowPlaying}
            origin={mediaOrigin}
            onBackToHdd={backFromMediaToHdd}
          />
        ) : tool === 'image' ? (
          <ImageTool />
        ) : (
          <DownloadsTool candidates={candidates} setCandidates={setCandidates} />
        )}
      </main>
    </div>
  );
}

function SidebarIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function BookIcon() {
  return (
    <SidebarIcon>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </SidebarIcon>
  );
}

function CatIcon() {
  return (
    <SidebarIcon>
      <path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z" />
      <path d="M8 14v.5" />
      <path d="M16 14v.5" />
      <path d="M11.25 16.25h1.5L12 17l-.75-.75Z" />
    </SidebarIcon>
  );
}

function BinderTrackIcon() {
  return (
    <SidebarIcon>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
      <line x1="8" y1="7" x2="15" y2="7" />
      <line x1="8" y1="11" x2="15" y2="11" />
      <circle cx="8" cy="15" r="1" fill="currentColor" stroke="none" />
      <line x1="11" y1="15" x2="15" y2="15" />
    </SidebarIcon>
  );
}

function VolumeIcon() {
  return (
    <SidebarIcon>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </SidebarIcon>
  );
}

function SunIcon() {
  return (
    <SidebarIcon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </SidebarIcon>
  );
}

function MoonIcon() {
  return (
    <SidebarIcon>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </SidebarIcon>
  );
}

function HddIcon() {
  return (
    <SidebarIcon>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <line x1="2.5" y1="14" x2="21.5" y2="14" />
      <circle cx="8" cy="17" r="1" fill="currentColor" stroke="none" />
      <line x1="11.5" y1="17" x2="17" y2="17" />
    </SidebarIcon>
  );
}

function PlayIcon() {
  return (
    <SidebarIcon>
      <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
    </SidebarIcon>
  );
}

function WikiIcon() {
  return (
    <SidebarIcon>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
      <path d="M9 7v10M9 7l3 2 3-2v10l-3-2-3 2" />
    </SidebarIcon>
  );
}

function ChuckBotIcon() {
  return (
    <SidebarIcon>
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M12 8V5a2 2 0 0 1 2-2h2" />
      <path d="M8 8a4 4 0 1 1 8 0" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    </SidebarIcon>
  );
}

function ScissorsIcon() {
  return (
    <SidebarIcon>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </SidebarIcon>
  );
}

function TvIcon() {
  return (
    <SidebarIcon>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <polyline points="17 2 12 7 7 2" />
    </SidebarIcon>
  );
}

function ImageIcon() {
  return (
    <SidebarIcon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </SidebarIcon>
  );
}

function SidebarProgress({
  value,
  label,
  active,
}: {
  value: number;
  label: string;
  active: boolean;
}) {
  return (
    <span className={`sidebar-progress ${active ? 'running' : ''}`}>
      <span className="sidebar-progress-track">
        <span
          className="sidebar-progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
      <small>{label}</small>
    </span>
  );
}
