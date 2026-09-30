import { useEffect, useState } from 'react';
import type { ImageConvertResult, ImageFormat, ImageState } from './types';

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

function StatusRow({ file, result }: { file: string; result?: ImageConvertResult }) {
  const { name, dir } = splitPath(file);
  const status        = !result ? 'pending' : result.ok ? 'ok' : 'fail';
  return (
    <div className={`image-file-row status-${status}`}>
      <i>{!result ? '…' : result.ok ? '✓' : '✗'}</i>
      <span>
        <strong>{name}</strong>
        <small>{dir}</small>
      </span>
      {result?.ok && result.output ? (
        <em className="image-output-name">{splitPath(result.output).name}</em>
      ) : result && !result.ok ? (
        <em className="image-error">{result.error ?? 'Error desconocido'}</em>
      ) : (
        <b>{extensionOf(name)}</b>
      )}
    </div>
  );
}

export default function ImageTool() {
  const [files, setFiles]     = useState<string[]>([]);
  const [format, setFormat]   = useState<ImageFormat>('webp');
  const [message, setMessage] = useState('');
  const [state, setState]     = useState<ImageState | null>(null);

  const running     = state?.running ?? false;
  const showLocal   = files.length > 0;
  const hasJob      = !showLocal && (running || (state?.files.length ?? 0) > 0 || (state?.results.length ?? 0) > 0);
  const jobFiles    = showLocal ? files : state?.files ?? [];
  const formatLabel = FORMAT_OPTIONS.find((option) => option.id === format)?.label ?? format;
  const formatState = FORMAT_OPTIONS.find((option) => option.id === (state?.format ?? format))?.label ?? format;

  useEffect(() => {
    window.tools
      .getImagesState()
      .then(setState)
      .catch(() => setState(null));
    return window.tools.onImagesState(setState);
  }, []);

  const resultsByInput = new Map<string, ImageConvertResult>();
  for (const result of state?.results ?? []) resultsByInput.set(result.input, result);
  const completed = state ? state.results.filter((item) => item.ok).length : 0;
  const failed    = state && state.results.length > 0 ? state.results.length - completed : 0;

  const pickFiles = async () => {
    try {
      const picked = await window.tools.imagesSelect();
      if (!picked.length) return;
      setFiles((current) => [...new Set([...current, ...picked])]);
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
  };

  const convert = async () => {
    if (!files.length || running) return;
    setMessage('');
    try {
      await window.tools.startImageConversion(format, files);
      setFiles([]);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const cancel = () => {
    window.tools
      .cancelImageConversion()
      .then(() => setMessage('Conversión cancelada por el usuario.'))
      .catch(() => {});
  };

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
          <button onClick={clearList} disabled={running || !showLocal || !files.length}>
            Limpiar
          </button>
        </div>
        {jobFiles.length ? (
          <div className="results image-results">
            <div>
              <label>
                {jobFiles.length} imagen{jobFiles.length === 1 ? '' : 'es'}
              </label>
              <span>
                {running
                  ? `Convirtiendo a ${formatState}…`
                  : showLocal
                    ? 'Salida en la misma carpeta'
                    : `Lote a ${formatState}`}
              </span>
            </div>
            <section className="image-file-list">
              {jobFiles.map((filePath) =>
                showLocal ? (
                  <div className="image-file-row" key={filePath}>
                    <span>
                      <strong>{splitPath(filePath).name}</strong>
                      <small>{splitPath(filePath).dir}</small>
                    </span>
                    <b>{extensionOf(splitPath(filePath).name)}</b>
                    <button
                      type="button"
                      title="Quitar de la lista"
                      disabled={running}
                      onClick={() => removeFile(filePath)}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <StatusRow key={filePath} file={filePath} result={resultsByInput.get(filePath)} />
                ),
              )}
            </section>
          </div>
        ) : (
          <div className="video-empty">Aún no hay imágenes seleccionadas.</div>
        )}
        {running && (
          <div className="normalize-progress">
            <span>
              <strong>Progreso global</strong>
              <b>{state?.globalProgress ?? 0}%</b>
            </span>
            <i>
              <b style={{ width: `${state?.globalProgress ?? 0}%` }} />
            </i>
            <em>
              {state?.results.length ?? 0} de {jobFiles.length} imágenes procesadas
            </em>
            <span>
              <strong>{state?.activeFile ?? 'Sin procesos activos'}</strong>
              <b>{state?.fileProgress ?? 0}%</b>
            </span>
            <i>
              <b style={{ width: `${state?.fileProgress ?? 0}%` }} />
            </i>
          </div>
        )}
        {!running && !showLocal && state && state.results.length > 0 && (
          <div className="image-outcome">
            <div className="image-outcome-head">
              <strong>
                {completed} convertida{completed === 1 ? '' : 's'} a {formatState}
              </strong>
              {failed > 0 && <em>{failed} con errores</em>}
            </div>
          </div>
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
              disabled={running}
              onClick={() => {
                setFormat(option.id);
                setMessage('');
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
      </div>
      <div className="tool-action simple">
        <span>
          {running
            ? 'La conversión continúa aunque cambies de sección'
            : hasJob
              ? `${completed} convertidas en el último lote`
              : files.length
                ? `${files.length} imagen${files.length === 1 ? '' : 'es'} → ${formatLabel}`
                : 'Selecciona imágenes para convertir'}
        </span>
        {running ? (
          <button className="cancel-button" onClick={cancel}>
            Cancelar conversión
          </button>
        ) : (
          <button disabled={!files.length} onClick={convert}>
            Convertir a {formatLabel} →
          </button>
        )}
      </div>
    </section>
  );
}