import { useEffect, useEffectEvent, useState } from 'react';
import MoverTool from './MoverTool';
import RenameTool from './RenameTool';
import VideoTool from './VideoTool';
import NormalizeTool from './NormalizeTool';
import UrlBypassTool from './UrlBypassTool';
import DownloadsTool from './DownloadsTool';
import CollectionTool from './CollectionTool';
import type {
  DownloadCandidate,
  DownloadPriority,
  DownloadsState,
  VideoState,
} from './types';
type Tool = 'mover' | 'rename' | 'video' | 'normalize' | 'urls' | 'downloads' | 'collection';
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
  activeFile: 'Ningún archivo en proceso',
  activeFolder: '',
  logs: [],
};
export default function App() {
  const [tool, setTool] = useState<Tool>('collection');
  const [downloads, setDownloads] = useState<DownloadsState>(EMPTY_DOWNLOADS);
  const [video, setVideo] = useState<VideoState>(EMPTY_VIDEO);
  const [candidates, setCandidates] = useState<DownloadCandidate[]>([]);
  const [downloadNotice, setDownloadNotice] = useState(0);
  const mergeCandidates = (found: DownloadCandidate[]) =>
    setCandidates((current) => {
      const existing = new Set(current.map((item) => item.originalUrl));
      return [
        ...current,
        ...found
          .filter((item) => !existing.has(item.originalUrl))
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
    const stopDownloads = window.tools.onDownloadsState(setDownloads);
    const stopVideo = window.tools.onVideoState(setVideo);
    const stopClipboard = window.tools.onClipboardLinks(captureClipboard);
    return () => {
      stopDownloads();
      stopVideo();
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
            <i>CL</i>
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
            <em className="wip-badge">WIP</em>
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
            <i>SD</i>
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
            <i>LU</i>
            <span>
              <strong>Normalizar volumen</strong>
              <small>Audio y video</small>
            </span>
          </button>
          <button className={tool === 'urls' ? 'active' : ''} onClick={() => setTool('urls')}>
            <i>↗</i>
            <span>
              <strong>Bypass de URLs</strong>
              <small>Enlaces cortos y ads</small>
            </span>
            <em className="wip-badge">WIP</em>
          </button>
        </nav>
        <div className="local">
          <b>● Todo permanece local</b>
          <small>Tus archivos nunca salen de este equipo.</small>
        </div>
        <footer>
          CHUCK's Tools Suite <span>v1.6</span>
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
        ) : tool === 'collection' ? (
          <CollectionTool />
        ) : tool === 'urls' ? (
          <UrlBypassTool />
        ) : (
          <DownloadsTool candidates={candidates} setCandidates={setCandidates} />
        )}
      </main>
    </div>
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
