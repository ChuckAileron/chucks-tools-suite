import { useEffect, useMemo, useState } from 'react';
import ReactPlayer from 'react-player';
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import type { HddDrive, HddEntry, MediaOrigin, NowPlaying } from './types';
import { hddMediaUrl } from './mediaUrl';

const CATEGORY_LABEL: Record<string, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Imagen',
  document: 'Documento',
  other: 'Archivo',
};

export default function MediaPlayerTool({
  nowPlaying,
  origin,
  onBackToHdd,
}: {
  nowPlaying: NowPlaying | null;
  origin: MediaOrigin;
  onBackToHdd: () => void;
}) {
  if (!nowPlaying) {
    return (
      <section className="tool media-tool">
        <header>
          <span>▶</span>
          <div>
            <h1>Reproductor</h1>
            <p>Reproduce video, audio, imágenes y documentos catalogados en tus discos duros.</p>
          </div>
        </header>
        <div className="workspace">
          <div className="collector-empty media-empty-state">
            <b>🎬</b>
            <span>
              No hay contenido en reproducción. Ve a "Inventario HDD", abre el contenido de un
              disco conectado y pulsa "▶ Reproducir" sobre un archivo.
            </span>
          </div>
        </div>
      </section>
    );
  }

  const { drive, entry } = nowPlaying;

  return (
    <section className="tool media-tool">
      <div className="media-hero">
        <div className="media-hero-top">
          {origin === 'hdd' && (
            <button className="media-back" type="button" onClick={onBackToHdd}>
              ← Volver a Inventario HDD
            </button>
          )}
          <span className={`hdd-badge ${drive.connected ? 'connected' : 'disconnected'}`}>
            {drive.connected ? `● ${drive.code}` : '○ HDD desconectado'}
          </span>
        </div>
        <h1 title={entry.relativePath}>{entry.name}</h1>
        <p className="media-meta">
          <span className="media-category-badge">
            {CATEGORY_LABEL[entry.category] || entry.category}
          </span>
          <span>
            {drive.code}
            {entry.parentPath ? ` / ${entry.parentPath}` : ''}
          </span>
        </p>
      </div>
      <div className="media-stage">
        {!drive.connected ? (
          <div className="collector-empty">
            <b>○</b>
            <span>Conecta el HDD "{drive.code}" para reproducir este archivo.</span>
          </div>
        ) : entry.category === 'video' ? (
          <VideoStage drive={drive} entry={entry} />
        ) : entry.category === 'audio' ? (
          <AudioStage drive={drive} entry={entry} />
        ) : entry.category === 'image' ? (
          <ImageGallery drive={drive} entry={entry} />
        ) : entry.category === 'document' ? (
          <DocumentViewer drive={drive} entry={entry} />
        ) : (
          <div className="collector-empty">
            <b>📦</b>
            <span>Este tipo de archivo no tiene un reproductor disponible en la suite.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function VideoStage({ drive, entry }: { drive: HddDrive; entry: HddEntry }) {
  const src = useMemo(() => hddMediaUrl(drive.id, entry.id), [drive.id, entry.id]);
  return (
    <div className="media-video-wrap">
      <ReactPlayer key={src} src={src} controls playing width="100%" height="100%" />
    </div>
  );
}

function AudioStage({ drive, entry }: { drive: HddDrive; entry: HddEntry }) {
  const src = useMemo(() => hddMediaUrl(drive.id, entry.id), [drive.id, entry.id]);
  return (
    <div className="media-audio-wrap">
      <div className="media-audio-art">🎵</div>
      <AudioPlayer
        key={src}
        src={src}
        autoPlayAfterSrcChange={false}
        showJumpControls
        layout="stacked-reverse"
        customAdditionalControls={[]}
      />
    </div>
  );
}

function ImageGallery({ drive, entry }: { drive: HddDrive; entry: HddEntry }) {
  const [siblings, setSiblings] = useState<HddEntry[]>([entry]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    window.tools.hddEntries(drive.id, entry.parentPath).then((list) => {
      if (!active) return;
      const images = list.filter((item) => item.category === 'image' && !item.isDirectory);
      setSiblings(images.length ? images : [entry]);
    });
    return () => {
      active = false;
    };
  }, [drive.id, entry, entry.parentPath]);

  useEffect(() => {
    siblings
      .filter((item) => item.hasThumbnail && thumbs[item.id] === undefined)
      .forEach((item) => {
        window.tools.hddThumbnail(item.id).then((url) => {
          if (url) setThumbs((current) => ({ ...current, [item.id]: url }));
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblings]);

  const initialIndex = Math.max(0, siblings.findIndex((item) => item.id === entry.id));
  const slides = siblings.map((item) => ({
    src: hddMediaUrl(drive.id, item.id),
    alt: item.name,
    title: item.name,
  }));

  return (
    <div className="media-gallery">
      <div className="media-gallery-grid">
        {siblings.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`media-gallery-item ${item.id === entry.id ? 'active' : ''}`}
            title={item.name}
            onClick={() => setLightboxIndex(index)}
          >
            <img
              src={thumbs[item.id] || hddMediaUrl(drive.id, item.id)}
              alt={item.name}
              loading="lazy"
            />
          </button>
        ))}
      </div>
      <Lightbox
        open={lightboxIndex !== null}
        close={() => setLightboxIndex(null)}
        index={lightboxIndex ?? initialIndex}
        slides={slides}
        plugins={[Zoom]}
        zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
      />
    </div>
  );
}

function DocumentViewer({ drive, entry }: { drive: HddDrive; entry: HddEntry }) {
  const [state, setState] = useState<{ loading: boolean; text: string; error: string }>({
    loading: true,
    text: '',
    error: '',
  });

  useEffect(() => {
    let active = true;
    window.tools
      .mediaDocumentText(drive.id, entry.id)
      .then((result) => {
        if (active) setState({ loading: false, text: result.text, error: '' });
      })
      .catch((err) => {
        if (active)
          setState({ loading: false, text: '', error: String((err as Error).message || err) });
      });
    return () => {
      active = false;
    };
  }, [drive.id, entry.id]);
  const { loading, text, error } = state;

  return (
    <div className="media-document">
      {loading ? (
        <div className="collector-empty">
          <b>📄</b>
          <span>Extrayendo contenido del documento…</span>
        </div>
      ) : error ? (
        <p className="hdd-modal-error">{error}</p>
      ) : text.trim() ? (
        <pre className="media-document-text">{text}</pre>
      ) : (
        <div className="collector-empty">
          <b>📄</b>
          <span>No se pudo extraer texto de este documento.</span>
        </div>
      )}
    </div>
  );
}
