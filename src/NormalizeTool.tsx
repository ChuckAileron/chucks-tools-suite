import { useEffect, useState } from 'react';
import type { NormalizeFile, NormalizeState } from './types';
type MediaType = 'audio' | 'video';
const formatSize = (bytes: number) =>
  bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const LUFS_PRESETS = [
  { value: -14, label: '-14 Streaming' },
  { value: -16, label: '-16 General' },
  { value: -18, label: '-18 Conservador' },
  { value: -23, label: '-23 Broadcast' },
];
const EMPTY_NORMALIZE: NormalizeState = {
  running: false,
  globalProgress: 0,
  fileProgress: 0,
  activeFile: 'Ningún archivo en proceso',
  message: '',
};
export default function NormalizeTool() {
  const [folders, setFolders] = useState<string[]>([]);
  const [type, setType] = useState<MediaType>('audio');
  const [target, setTarget] = useState(-16);
  const [files, setFiles] = useState<NormalizeFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [normalize, setNormalize] = useState<NormalizeState>(EMPTY_NORMALIZE);
  const [message, setMessage] = useState('');
  const [processed, setProcessed] = useState<Set<string>>(new Set());
  useEffect(() => {
    window.tools.getNormalizeState().then(setNormalize);
    const stop = window.tools.onNormalizeState(setNormalize);
    return stop;
  }, []);
  useEffect(() => {
    return window.tools.onNormalizeProgress((data) => {
      if (data.type !== 'file-done' || !data.path) return;
      const filePath = data.path;
      setProcessed((current) => {
        const next = new Set(current);
        next.add(filePath);
        return next;
      });
    });
  }, []);
  const addFolders = async () => {
    const paths = await window.tools.selectNormalizeFolders();
    setFolders((current) => [...new Set([...current, ...paths])]);
    setFiles([]);
    setSelected(new Set());
    setProcessed(new Set());
  };
  const scan = async () => {
    setMessage('Explorando archivos...');
    try {
      const result = await window.tools.scanNormalizeFiles({ folders, type });
      setFiles(result);
      setSelected(new Set(result.map((file) => file.path)));
      setProcessed(new Set(result.filter((file) => file.processed).map((file) => file.path)));
      setMessage(
        result.length
          ? 'Revisa la selección antes de continuar.'
          : 'No se encontraron archivos compatibles.',
      );
    } catch (error) {
      setMessage(String(error));
    }
  };
  const start = async () => {
    if (target < -50 || target > -5)
      return setMessage('El objetivo debe estar entre -50 y -5 LUFS.');
    setMessage('');
    await window.tools.startNormalization({
      files: files.filter((file) => selected.has(file.path)),
      type,
      targetDb: target,
    });
  };
  const all = files.length > 0 && selected.size === files.length;
  return (
    <section className="tool normalize-tool">
      <header>
        <span>LU</span>
        <div>
          <h1>Normalizar volumen</h1>
          <p>Equilibra el nivel percibido de audios y videos con FFmpeg.</p>
        </div>
        <b>● FFmpeg local</b>
      </header>
      <div className="workspace">
        <div className="step">
          <span>01</span>
          <div>
            <h2>Selecciona el contenido</h2>
            <p>Puedes procesar varias carpetas en una ejecución.</p>
          </div>
        </div>
        <div className="normalize-controls">
          <button disabled={normalize.running} onClick={addFolders}>
            + Añadir carpetas
          </button>
          <button
            disabled={normalize.running || !folders.length}
            onClick={() => {
              setFolders([]);
              setFiles([]);
              setSelected(new Set());
              setProcessed(new Set());
            }}
          >
            Limpiar
          </button>
          <select
            disabled={normalize.running}
            value={type}
            onChange={(event) => {
              setType(event.target.value as MediaType);
              setFiles([]);
              setSelected(new Set());
              setProcessed(new Set());
            }}
          >
            <option value="audio">Archivos de audio</option>
            <option value="video">Videos con audio</option>
          </select>
        </div>
        <div className="normalize-folders">
          {folders.length ? (
            folders.map((folder) => (
              <div key={folder}>
                <span title={folder}>{folder}</span>
                <button
                  disabled={normalize.running}
                  onClick={() => setFolders((current) => current.filter((item) => item !== folder))}
                >
                  Quitar
                </button>
              </div>
            ))
          ) : (
            <p>No hay carpetas seleccionadas.</p>
          )}
        </div>
        <div className="divider" />
        <div className="step">
          <span>02</span>
          <div>
            <h2>Configura la normalización</h2>
            <p>El valor recomendado para contenido general es -16 LUFS.</p>
          </div>
        </div>
        <label className="lufs-target">
          <strong>Objetivo de sonoridad</strong>
          <input
            type="number"
            min="-50"
            max="-5"
            value={target}
            disabled={normalize.running}
            onChange={(event) => setTarget(Number(event.target.value))}
          />
          <span>LUFS</span>
        </label>
        <div className="lufs-presets">
          {LUFS_PRESETS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              disabled={normalize.running}
              className={target === value ? 'active' : ''}
              onClick={() => setTarget(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="scan-row">
          <span>{message || normalize.message || 'Selecciona carpetas para comenzar.'}</span>
          <button disabled={!folders.length || normalize.running} onClick={scan}>
            Explorar archivos
          </button>
        </div>
        {files.length > 0 && (
          <div className="results normalize-results">
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={all}
                  onChange={() =>
                    setSelected(all ? new Set() : new Set(files.map((file) => file.path)))
                  }
                />{' '}
                {files.length} archivos
              </label>
              <span>{selected.size} seleccionados</span>
            </div>
            <section>
              {files.map((file) => (
                <label key={file.path}>
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(file.path)) next.delete(file.path);
                      else next.add(file.path);
                      setSelected(next);
                    }}
                  />
                  <span>
                    <strong>
                      {file.name}
                      {processed.has(file.path) && (
                        <em className="file-check" title="Archivo procesado">
                          ✓
                        </em>
                      )}
                    </strong>
                    <small>{file.folder}</small>
                  </span>
                  <i>{formatSize(file.size)}</i>
                </label>
              ))}
            </section>
          </div>
        )}
        <div className="normalize-progress">
          <span>
            <strong>{normalize.message || 'Sin procesos activos'}</strong>
            <b>{normalize.fileProgress}%</b>
          </span>
          <i>
            <b style={{ width: `${normalize.fileProgress}%` }} />
          </i>
        </div>
        <div className="tool-action simple">
          <span>
            Los originales se conservan. El resultado se guarda en{' '}
            <strong>normalized_output-audio</strong> o <strong>normalized_output-video</strong>{' '}
            dentro de cada carpeta.
          </span>
          {normalize.running ? (
            <button className="cancel-button" onClick={() => window.tools.cancelNormalization()}>
              Cancelar proceso
            </button>
          ) : (
            <button disabled={!selected.size} onClick={start}>
              Normalizar {selected.size || ''} archivos →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
