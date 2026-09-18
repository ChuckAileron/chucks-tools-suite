import { useState } from 'react';
import MoverTool from './MoverTool';
import RenameTool from './RenameTool';
import VideoTool from './VideoTool';
import NormalizeTool from './NormalizeTool';
type Tool = 'mover' | 'rename' | 'video' | 'normalize';
export default function App() {
  const [tool, setTool] = useState<Tool>('mover');
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
        </nav>
        <div className="local">
          <b>● Todo permanece local</b>
          <small>Tus archivos nunca salen de este equipo.</small>
        </div>
        <footer>
          CHUCK's Tools Suite <span>v1.3</span>
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
        ) : (
          <NormalizeTool />
        )}
      </main>
    </div>
  );
}
