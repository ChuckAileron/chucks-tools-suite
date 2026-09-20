import { useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';
import MoverTool from './MoverTool';
import RenameTool from './RenameTool';
import VideoTool from './VideoTool';
import NormalizeTool from './NormalizeTool';
import AnalogReplayTool from './AnalogReplayTool';
import DownloadsTool from './DownloadsTool';
import CollectionTool from './CollectionTool';
import type {
  DownloadCandidate,
  DownloadPriority,
  DownloadsState,
  NormalizeState,
  VideoState,
} from './types';
type Tool = 'mover' | 'rename' | 'video' | 'normalize' | 'downloads' | 'collection' | 'replay';
const EMPTY_DOWNLOADS: DownloadsState = {
  settings: {
    defaultDirectory: '',
    concurrency: 3,
    autoExtract: true,
    clipboard: true,
    googleDriveApiKey: '',
  },
  tasks: [],
};
const EMPTY_VIDEO: VideoState = {
  running: false,
  codec: 'h264',
  folders: [],
  trackSelections: {},
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Sin procesos activos',
  activeFolder: '',
  logs: [],
  normalizeAudio: false,
  normalizeTarget: -16,
};
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
};
export default function App() {
  const [tool, setTool] = useState<Tool>('collection');
  const [downloads, setDownloads] = useState<DownloadsState>(EMPTY_DOWNLOADS);
  const [video, setVideo] = useState<VideoState>(EMPTY_VIDEO);
  const [normalize, setNormalize] = useState<NormalizeState>(EMPTY_NORMALIZE);
  const [candidates, setCandidates] = useState<DownloadCandidate[]>([]);
  const [downloadNotice, setDownloadNotice] = useState(0);
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
            destination: downloads.settings.defaultDirectory,
            priority: 'medium' as DownloadPriority,
            extract: true,
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
    const stopDownloads = window.tools.onDownloadsState(setDownloads);
    const stopVideo = window.tools.onVideoState(setVideo);
    const stopNormalize = window.tools.onNormalizeState(setNormalize);
    const stopClipboard = window.tools.onClipboardLinks(captureClipboard);
    return () => {
      stopDownloads();
      stopVideo();
      stopNormalize();
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
        </nav>
        <div className="local">
          <b>● Todo permanece local</b>
          <small>Tus archivos nunca salen de este equipo.</small>
        </div>
        <footer>
          CHUCK's Tools Suite <span>v1.9</span>
        </footer>
      </aside>
      <main className="content">
        <div className="mobile-brand">CHUCK's Tools Suite</div>
        {tool === 'mover' ? (
          <MoverTool />
        ) : tool === 'rename' ? (
          <RenameTool />
        ) : tool === 'video' ? (
          <VideoTool />
        ) : tool === 'normalize' ? (
          <NormalizeTool />
        ) : tool === 'replay' ? (
          <AnalogReplayTool />
        ) : tool === 'collection' ? (
          <CollectionTool />
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

function VolumeIcon() {
  return (
    <SidebarIcon>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
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
