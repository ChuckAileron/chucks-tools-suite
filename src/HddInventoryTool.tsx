import { useEffect, useState } from 'react';
import type { HddDrive, HddEntry, HddScanState } from './types';

const EMPTY_SCAN: HddScanState               = {
  running:    false,
  driveId:    null,
  processed:  0,
  thumbnails: 0,
  current:    '',
  error:      '',
};
const CATEGORY_LABEL: Record<string, string> = {
  folder:   'Carpeta',
  video:    'Video',
  image:    'Foto',
  audio:    'Audio',
  document: 'Documento',
  other:    'Otro',
};
const CATEGORY_ICON: Record<string, string>  = {
  folder:   '📁',
  video:    '🎬',
  image:    '🖼',
  audio:    '🎵',
  document: '📄',
  other:    '📦',
};
const formatSize                             = (bytes: number) =>
  !bytes
    ? '—'
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1073741824
        ? `${(bytes / 1048576).toFixed(1)} MB`
        : `${(bytes / 1073741824).toFixed(2)} GB`;
const formatDate                             = (value: string | null) => (value ? new Date(value).toLocaleString('es') : '—');

export default function HddInventoryTool({
  activeDriveId,
  onActiveDriveIdChange,
  parentPath,
  onParentPathChange,
  onPlay,
}: {
  activeDriveId?: number | null;
  onActiveDriveIdChange?: (id: number | null) => void;
  parentPath?: string;
  onParentPathChange?: (value: string) => void;
  onPlay?: (drive: HddDrive, entry: HddEntry) => void;
}) {
  const [drives, setDrives]                               = useState<HddDrive[]>([]);
  const [loading, setLoading]                             = useState(false);
  const [scanState, setScanState]                         = useState<HddScanState>(EMPTY_SCAN);
  const [internalActiveDriveId, setInternalActiveDriveId] = useState<number | null>(null);
  const effectiveActiveDriveId                            = activeDriveId !== undefined ? activeDriveId : internalActiveDriveId;
  const setActiveDriveId                                  = onActiveDriveIdChange || setInternalActiveDriveId;
  const [registerRoot, setRegisterRoot]                   = useState<string | null>(null);
  const [editingDrive, setEditingDrive]                   = useState<HddDrive | null>(null);
  const [message, setMessage]                             = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setDrives(await window.tools.hddList());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    window.tools.hddList().then(setDrives);
    window.tools.hddScanState().then(setScanState);
    const stop = window.tools.onHddScanState((state) => {
      setScanState(state);
      if (!state.running) window.tools.hddList().then(setDrives);
    });
    return stop;
  }, []);

  const activeDrive = drives.find((d) => d.id === effectiveActiveDriveId) || null;

  const startRegister = async () => {
    const rootPath = await window.tools.hddSelectRoot();
    if (rootPath) setRegisterRoot(rootPath);
  };
  const startScan   = async (id: number) => {
    setMessage('');
    try {
      await window.tools.hddStartScan(id);
    } catch (error) {
      setMessage(String((error as Error).message || error));
    }
  };
  const removeDrive = async (drive: HddDrive) => {
    if (
      !confirm(
        `¿Quitar "${drive.code}" del inventario? Se borrará el catálogo y las miniaturas guardadas.`,
      )
    )
      return;
    await window.tools.hddRemove(drive.id);
    if (effectiveActiveDriveId === drive.id) setActiveDriveId(null);
    load();
  };

  if (activeDrive)
    return (
      <HddExplorer
        drive={activeDrive}
        scanState={scanState}
        parentPath={parentPath}
        onParentPathChange={onParentPathChange}
        onBack={() => setActiveDriveId(null)}
        onRefresh={load}
        onPlay={onPlay}
      />
    );

  return (
    <section className="tool hdd-tool">
      <header>
        <span>HD</span>
        <div>
          <h1>Inventario HDD</h1>
          <p>Cataloga el contenido de tus discos duros externos con miniaturas y ficha técnica.</p>
        </div>
        <b>● Catálogo local</b>
      </header>
      <div className="workspace">
        <div className="rename-toolbar">
          <button onClick={startRegister}>+ Registrar HDD</button>
          <button disabled={loading} onClick={load}>
            Actualizar lista
          </button>
        </div>
        {message && <p className="hdd-message">{message}</p>}
        {drives.length ? (
          <div className="hdd-drives">
            {drives.map((drive) => {
              const scanning = scanState.running && scanState.driveId === drive.id;
              return (
                <article className="hdd-drive-card" key={drive.id}>
                  <header>
                    <strong>{drive.code}</strong>
                    <span className={`hdd-badge ${drive.connected ? 'connected' : 'disconnected'}`}>
                      {drive.connected ? `● Conectado (${drive.mountPoint})` : '○ Desconectado'}
                    </span>
                  </header>
                  {drive.label && <p className="hdd-drive-label">{drive.label}</p>}
                  <dl className="hdd-drive-stats">
                    <div>
                      <dt>Archivos</dt>
                      <dd>{drive.stats.files}</dd>
                    </div>
                    <div>
                      <dt>Contenido</dt>
                      <dd>{formatSize(drive.stats.bytes)}</dd>
                    </div>
                    <div>
                      <dt>Capacidad</dt>
                      <dd>{formatSize(drive.totalBytes)}</dd>
                    </div>
                    <div>
                      <dt>Último análisis</dt>
                      <dd>{formatDate(drive.lastScannedAt)}</dd>
                    </div>
                  </dl>
                  {scanning && (
                    <p className="hdd-scan-status">
                      Analizando… {scanState.processed} elementos · {scanState.thumbnails}{' '}
                      miniaturas
                      <br />
                      <small title={scanState.current}>{scanState.current}</small>
                    </p>
                  )}
                  {!scanning && scanState.driveId === drive.id && scanState.error && (
                    <p className="hdd-scan-error">{scanState.error}</p>
                  )}
                  <div className="hdd-drive-actions">
                    <button onClick={() => setActiveDriveId(drive.id)}>Ver contenido</button>
                    <button
                      disabled={!drive.connected || (scanState.running && !scanning)}
                      title={
                        drive.connected
                          ? 'Analizar y actualizar miniaturas'
                          : 'Conecta el HDD para analizarlo'
                      }
                      onClick={() =>
                        scanning ? window.tools.hddCancelScan() : startScan(drive.id)
                      }
                    >
                      {scanning ? 'Cancelar análisis' : 'Analizar HDD'}
                    </button>
                    <button onClick={() => setEditingDrive(drive)}>Editar</button>
                    <button onClick={() => removeDrive(drive)}>Quitar</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="collector-empty">
            <b>💽</b>
            <span>Registra un disco duro para comenzar a catalogar su contenido.</span>
          </div>
        )}
      </div>
      {registerRoot && (
        <RegisterModal
          rootPath={registerRoot}
          onClose={() => setRegisterRoot(null)}
          onDone={() => {
            setRegisterRoot(null);
            load();
          }}
        />
      )}
      {editingDrive && (
        <EditDriveModal
          drive={editingDrive}
          onClose={() => setEditingDrive(null)}
          onDone={() => {
            setEditingDrive(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function RegisterModal({
  rootPath,
  onClose,
  onDone,
}: {
  rootPath: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode]   = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await window.tools.hddRegister({ rootPath, code, label });
      onDone();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-search-overlay" onClick={onClose}>
      <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Registrar disco duro</h2>
          <p title={rootPath}>Carpeta raíz elegida: {rootPath}</p>
        </header>
        <label className="hdd-field">
          Identificador
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="HDD-001"
            autoFocus
          />
        </label>
        <label className="hdd-field">
          Nombre (opcional)
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Backups fotos familia"
          />
        </label>
        {error && <p className="hdd-modal-error">{error}</p>}
        <footer>
          <span />
          <div>
            <button disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button className="prompt-confirm" disabled={busy || !code.trim()} onClick={submit}>
              Registrar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function EditDriveModal({
  drive,
  onClose,
  onDone,
}: {
  drive: HddDrive;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode]   = useState(drive.code);
  const [label, setLabel] = useState(drive.label);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await window.tools.hddUpdate(drive.id, { code, label });
      onDone();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-search-overlay" onClick={onClose}>
      <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Editar HDD</h2>
        </header>
        <label className="hdd-field">
          Identificador
          <input value={code} onChange={(event) => setCode(event.target.value)} autoFocus />
        </label>
        <label className="hdd-field">
          Nombre (opcional)
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        {error && <p className="hdd-modal-error">{error}</p>}
        <footer>
          <span />
          <div>
            <button disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button className="prompt-confirm" disabled={busy || !code.trim()} onClick={submit}>
              Guardar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function HddExplorer({
  drive,
  scanState,
  parentPath: parentPathProp,
  onParentPathChange,
  onBack,
  onRefresh,
  onPlay,
}: {
  drive: HddDrive;
  scanState: HddScanState;
  parentPath?: string;
  onParentPathChange?: (value: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onPlay?: (drive: HddDrive, entry: HddEntry) => void;
}) {
  const [internalParentPath, setInternalParentPath] = useState('');
  const parentPath                                  = parentPathProp !== undefined ? parentPathProp : internalParentPath;
  const setParentPath                               = onParentPathChange || setInternalParentPath;
  const [entries, setEntries]                       = useState<HddEntry[]>([]);
  const [thumbs, setThumbs]                         = useState<Record<number, string>>({});
  const [renaming, setRenaming]                     = useState<HddEntry | null>(null);
  const [renameValue, setRenameValue]               = useState('');
  const [applyToDisk, setApplyToDisk]               = useState(false);
  const [detail, setDetail]                         = useState<HddEntry | null>(null);
  const [preview, setPreview]                       = useState<HddEntry | null>(null);
  const [message, setMessage]                       = useState('');
  const scanning                                    = scanState.running && scanState.driveId === drive.id;

  const loadEntries = async (nextParent: string) => {
    const list = await window.tools.hddEntries(drive.id, nextParent);
    setEntries(list);
  };
  useEffect(() => {
    window.tools.hddEntries(drive.id, parentPath).then(setEntries);
  }, [drive.id, parentPath]);
  useEffect(() => {
    entries
      .filter((entry) => entry.hasThumbnail && thumbs[entry.id] === undefined)
      .forEach((entry) => {
        window.tools.hddThumbnail(entry.id).then((url) => {
          if (url) setThumbs((current) => ({ ...current, [entry.id]: url }));
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const crumbs = parentPath ? parentPath.split('/') : [];
  const goTo   = (index: number) => setParentPath(crumbs.slice(0, index).join('/'));

  const showInFolder = async (entry: HddEntry) => {
    setMessage('');
    try {
      await window.tools.hddShowInFolder(drive.id, entry.id);
    } catch (error) {
      setMessage(String((error as Error).message || error));
    }
  };

  const startRename   = (entry: HddEntry) => {
    setRenaming(entry);
    setRenameValue(entry.name);
    setApplyToDisk(false);
    setMessage('');
  };
  const confirmRename = async () => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renaming.name) {
      setRenaming(null);
      return;
    }
    if (renaming.isDirectory) {
      const count = await window.tools.hddDescendantCount(drive.id, renaming.id);
      if (
        count > 0 &&
        !confirm(
          `Esta carpeta tiene ${count} elemento${count === 1 ? '' : 's'} catalogado${count === 1 ? '' : 's'} debajo. Cambiar su nombre actualizará todas esas rutas en la base de datos${applyToDisk && drive.connected ? ' y moverá la carpeta real (sus archivos internos conservan su ubicación relativa)' : ''}. ¿Continuar?`,
        )
      )
        return;
    }
    try {
      await window.tools.hddRename({
        driveId:     drive.id,
        entryId:     renaming.id,
        newName:     trimmed,
        applyToDisk: applyToDisk && drive.connected,
      });
      setRenaming(null);
      loadEntries(parentPath);
      onRefresh();
    } catch (error) {
      setMessage(String((error as Error).message || error));
    }
  };

  return (
    <section className="tool hdd-tool">
      <header>
        <span>HD</span>
        <div>
          <h1>{drive.code}</h1>
          <p>{drive.label || 'Contenido catalogado del disco.'}</p>
        </div>
        <b className={drive.connected ? '' : 'hdd-header-disconnected'}>
          {drive.connected ? `● ${drive.mountPoint}` : '○ Desconectado'}
        </b>
      </header>
      <div className="workspace">
        <div className="rename-toolbar">
          <button onClick={onBack}>← Volver al inventario</button>
        </div>
        {scanning && (
          <p className="hdd-scan-status">
            Analizando… {scanState.processed} elementos · {scanState.thumbnails} miniaturas ·{' '}
            <span title={scanState.current}>{scanState.current}</span>
          </p>
        )}
        {message && <p className="hdd-modal-error">{message}</p>}
        <nav className="hdd-breadcrumbs">
          <button onClick={() => goTo(0)}>{drive.code}</button>
          {crumbs.map((crumb, index) => (
            <span key={index}>
              <i>/</i>
              <button onClick={() => goTo(index + 1)}>{crumb}</button>
            </span>
          ))}
        </nav>
        <div className="builder-grid-wrap">
          <table className="builder-grid hdd-entries-grid">
            <thead>
              <tr>
                <th>Miniatura</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Tamaño</th>
                <th>Modificado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entries.length ? (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {thumbs[entry.id] ? (
                        <button
                          className="hdd-thumb-button"
                          type="button"
                          title="Ver miniatura en grande"
                          aria-label={`Ver miniatura de ${entry.name} en grande`}
                          onClick={() => setPreview(entry)}
                        >
                          <img className="hdd-thumb" src={thumbs[entry.id]} alt="" />
                        </button>
                      ) : (
                        <span className="hdd-thumb-placeholder">
                          {CATEGORY_ICON[entry.category]}
                        </span>
                      )}
                    </td>
                    <td>
                      {entry.isDirectory ? (
                        <button
                          className="hdd-entry-name"
                          onClick={() => setParentPath(entry.relativePath)}
                        >
                          📁 {entry.name}
                        </button>
                      ) : entry.category !== 'other' ? (
                        <button className="hdd-entry-name" onClick={() => setDetail(entry)}>
                          {entry.name}
                        </button>
                      ) : (
                        <span>{entry.name}</span>
                      )}
                    </td>
                    <td>{CATEGORY_LABEL[entry.category]}</td>
                    <td>{entry.isDirectory ? '—' : formatSize(entry.size)}</td>
                    <td>{formatDate(entry.modifiedAt)}</td>
                    <td className="hdd-entry-actions">
                      {!entry.isDirectory && entry.category !== 'other' && onPlay && (
                        <button
                          disabled={!drive.connected}
                          title={
                            drive.connected
                              ? 'Abrir en el reproductor'
                              : 'Conecta el HDD para reproducir el archivo'
                          }
                          onClick={() => onPlay(drive, entry)}
                        >
                          ▶ Reproducir
                        </button>
                      )}
                      <button onClick={() => startRename(entry)}>Renombrar</button>
                      <button
                        disabled={!drive.connected}
                        title={
                          drive.connected
                            ? 'Ver en carpeta'
                            : 'Conecta el HDD para ver el archivo en su carpeta'
                        }
                        onClick={() => showInFolder(entry)}
                      >
                        Ver en carpeta
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="builder-empty" colSpan={6}>
                    Esta carpeta está vacía en el catálogo. Ejecuta "Analizar HDD" si esperabas
                    contenido aquí.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {renaming && (
        <div className="image-search-overlay" onClick={() => setRenaming(null)}>
          <div className="hdd-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Renombrar {renaming.isDirectory ? 'carpeta' : 'archivo'}</h2>
              <p>{renaming.relativePath}</p>
            </header>
            <label className="hdd-field">
              Nuevo nombre
              <input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                autoFocus
              />
            </label>
            <label className="hdd-field check">
              <input
                type="checkbox"
                checked={applyToDisk && drive.connected}
                disabled={!drive.connected}
                onChange={(event) => setApplyToDisk(event.target.checked)}
              />
              Aplicar también al {renaming.isDirectory ? 'la carpeta' : 'archivo'} real en el disco
              {!drive.connected && ' (el HDD debe estar conectado)'}
            </label>
            {renaming.isDirectory && (
              <p className="hdd-modal-hint">
                Cambiar el nombre de una carpeta actualiza las rutas de todo su contenido en la base
                de datos.
              </p>
            )}
            <footer>
              <span />
              <div>
                <button onClick={() => setRenaming(null)}>Cancelar</button>
                <button className="prompt-confirm" onClick={confirmRename}>Guardar</button>
              </div>
            </footer>
          </div>
        </div>
      )}
      {preview && (
        <div className="image-search-overlay" onClick={() => setPreview(null)}>
          <div className="hdd-preview-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 title={preview.relativePath}>{preview.name}</h2>
              <button
                title="Cerrar"
                aria-label="Cerrar vista previa"
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </header>
            <img className="hdd-preview-image" src={thumbs[preview.id]} alt={preview.name} />
          </div>
        </div>
      )}
      {detail && (
        <div className="image-search-overlay" onClick={() => setDetail(null)}>
          <div className="hdd-modal hdd-detail-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{detail.name}</h2>
              <p>Propiedades técnicas (media_properties)</p>
            </header>
            {Object.keys(detail.mediaProperties).length ? (
              <pre className="hdd-detail-json">
                {JSON.stringify(detail.mediaProperties, null, 2)}
              </pre>
            ) : (
              <p className="hdd-modal-hint">
                Sin datos técnicos todavía. Ejecuta "Analizar HDD" para generarlos.
              </p>
            )}
            <footer>
              <span />
              <div>
                <button className="prompt-confirm" onClick={() => setDetail(null)}>Cerrar</button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
