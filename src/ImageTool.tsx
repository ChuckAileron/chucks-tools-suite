import { useState } from 'react';
import type { ImageConvertOutcome, ImageConvertResult, ImageFormat } from './types';

const FORMAT_OPTIONS: { id: ImageFormat; label: string; description: string }[] = [
  { id: 'jpg', label: 'JPEG', description: 'Fotografía liviana con pérdida' },
  { id: 'png', label: 'PNG', description: 'Calidad sin pérdida y transparencia' },
  { id: 'webp', label: 'WebP', description: 'Ideal para la web, transparente' },
  { id: 'gif', label: 'GIF', description: 'Animaciones y máxima compatibilidad' },
  { id: 'tiff', label: 'TIFF', description: 'Edición e impresión sin pérdida' },
  { id: 'avif', label: 'AVIF', description: 'Máxima compresión moderna' },
];

const INPUT_HINT = 'JPG · JPEG · PNG · WebP · GIF · TIFF · AVIF · HEIC/HEIF';

function ImageIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function splitPath(filePath: string) {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return index > 0
    ? { name: filePath.slice(index + 1), dir: filePath.slice(0, index) }
    : { name: filePath, dir: '' };
}

function extensionOf(name: string) {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toUpperCase() : '';
}

function ResultRow({ result }: { result: ImageConvertResult }) {
  const { name, dir } = splitPath(result.output ?? result.input);
  return (
    <div className={`image-result-row${result.ok ? ' ok' : ' fail'}`}>
      <i>{result.ok ? '✓' : '✗'}</i>
      <span>
        <strong>{name}</strong>
        <small>{dir}</small>
      </span>
      {result.ok ? (
        <b>{extensionOf(name)}</b>
      ) : (
        <em>{result.error ?? 'Error desconocido'}</em>
      )}
    </div>
  );
}

export default function ImageTool() {
  const [files, setFiles]     = useState<string[]>([]);
  const [format, setFormat]   = useState<ImageFormat>('webp');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<ImageConvertOutcome | null>(null);

  const pickFiles = async () => {
    try {
      const picked = await window.tools.imagesSelect();
      if (!picked.length) return;
      setFiles((current) => [...new Set([...current, ...picked])]);
      setOutcome(null);
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const removeFile = (filePath: string) => {
    setFiles((current) => current.filter((item) => item !== filePath));
  };

  const clearList = () => {
    setFiles([]);
    setOutcome(null);
  };

  const convert = async () => {
    if (!files.length || running) return;
    setRunning(true);
    setMessage('');
    setOutcome(null);
    try {
      setOutcome(await window.tools.imagesConvert(format, files));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const completed   = outcome ? outcome.results.filter((item) => item.ok).length : 0;
  const failedCount = outcome ? outcome.results.length - completed : 0;
  const formatLabel = FORMAT_OPTIONS.find((option) => option.id === format)?.label ?? format;

  return (
    <section className="tool image-tool">
      <header>
        <span>
          <ImageIcon />
        </span>
        <div>
          <h1>Convertir imágenes</h1>
          <p>Cambia el formato de tus imágenes y conserva siempre el original.</p>
        </div>
        <b>● Libvips local</b>
      </header>
      <div className="workspace">
        <div className="step">
          <span>1</span>
          <div>
            <h2>Elige las imágenes</h2>
            <p>Formatos aceptados: {INPUT_HINT}.</p>
          </div>
        </div>
        <div className="video-folder-actions">
          <button onClick={pickFiles} disabled={running}>
            + Agregar imágenes
          </button>
          <button onClick={clearList} disabled={running || !files.length}>
            Limpiar
          </button>
        </div>
        {files.length ? (
          <div className="results image-results">
            <div>
              <label>
                {files.length} imagen{files.length === 1 ? '' : 'es'} seleccionada
                {files.length === 1 ? '' : 's'}
              </label>
              <span>Salida en la misma carpeta</span>
            </div>
            <section className="image-file-list">
              {files.map((filePath) => {
                const { name, dir } = splitPath(filePath);
                return (
                  <div className="image-file-row" key={filePath}>
                    <span>
                      <strong>{name}</strong>
                      <small>{dir}</small>
                    </span>
                    <b>{extensionOf(name)}</b>
                    <button
                      type="button"
                      title="Quitar de la lista"
                      disabled={running}
                      onClick={() => removeFile(filePath)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </section>
          </div>
        ) : (
          <div className="video-empty">Aún no hay imágenes seleccionadas.</div>
        )}
        <div className="divider" />
        <div className="step">
          <span>2</span>
          <div>
            <h2>Elige el formato de salida</h2>
            <p>La conversión se guarda junto al archivo original.</p>
          </div>
        </div>
        <div className="image-format-grid">
          {FORMAT_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={format === option.id ? 'active' : ''}
              disabled={running || !files.length}
              onClick={() => {
                setFormat(option.id);
                setOutcome(null);
              }}
            >
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
        <div className="divider" />
        <aside className="sd-disclaimer">
          <strong>Qué hace el conversor</strong>
          <span>
            Los originales no se modifican. Cada imagen se convierte a {formatLabel} y se guarda en
            su misma carpeta; si coincide con la extensión de origen, se escribe con el sufijo
            «-convertido». JPEG/WebP usan calidad 90 y AVIF calidad 70; PNG y TIFF conservan la
            pérdida nula.
          </span>
        </aside>
        {message && <p className="image-message error">{message}</p>}
        {outcome && (
          <div className="image-outcome">
            <div className="image-outcome-head">
              <strong>
                {completed} convertida{completed === 1 ? '' : 's'} a {formatLabel}
              </strong>
              {failedCount > 0 && <em>{failedCount} con errores</em>}
            </div>
            <div className="image-outcome-list">
              {outcome.results.map((result) => (
                <ResultRow key={result.input} result={result} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="tool-action simple">
        <span>
          {files.length
            ? `${files.length} imagen${files.length === 1 ? '' : 'es'} → ${formatLabel}`
            : 'Selecciona imágenes para convertir'}
        </span>
        <button disabled={!files.length} onClick={convert}>
          {running ? 'Convirtiendo…' : `Convertir a ${formatLabel} →`}
        </button>
      </div>
    </section>
  );
}