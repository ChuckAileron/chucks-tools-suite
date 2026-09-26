import { useEffect, useState } from 'react';
import type { HijitoPriority, HijitoSubtask, HijitoTask, HijitoTrack } from './types';

const PRIORITY_LABELS: Record<HijitoPriority, string> = {
  bajo:  'Baja',
  medio: 'Media',
  alto:  'Alta',
};
const PRIORITY_WEIGHT: Record<HijitoPriority, number> = {
  alto:  0,
  medio: 1,
  bajo:  2,
};

type TaskDraft = {
  taskId: number | null;
  trackSlug: string;
  description: string;
  dueDate: string;
  priority: HijitoPriority;
};

type TaskHandlers = {
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSubtask: (text: string) => void;
  onToggleSubtask: (subtask: HijitoSubtask) => void;
  onDeleteSubtask: (subtask: HijitoSubtask) => void;
};

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function compareTasks(a: HijitoTask, b: HijitoTask): number {
  const byPriority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  return byPriority !== 0 ? byPriority : a.id - b.id;
}

function CatIcon({ size = 18 }: { size?: number }) {
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
      <path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z" />
      <path d="M8 14v.5" />
      <path d="M16 14v.5" />
      <path d="M11.25 16.25h1.5L12 17l-.75-.75Z" />
    </svg>
  );
}

function PawIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <circle cx="6.6" cy="7.7" r="1.9" />
      <circle cx="10.1" cy="4.9" r="1.9" />
      <circle cx="13.9" cy="4.9" r="1.9" />
      <circle cx="17.4" cy="7.7" r="1.9" />
      <path d="M12 11.3c-2.7 0-4.8 1.7-4.8 3.7 0 1.9 1.8 3.3 4.8 3.3s4.8-1.4 4.8-3.3c0-2-2.1-3.7-4.8-3.7Z" />
    </svg>
  );
}

function ImageIcon({ size = 18 }: { size?: number }) {
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

function TrackBanner({
  banner,
  editable = false,
  onEdit,
  mode = 'photo',
  position = { x: 50, y: 50 },
}: {
  banner: string;
  editable?: boolean;
  onEdit?: () => void;
  mode?: 'photo' | 'banner';
  position?: { x: number; y: number };
}) {
  const isRemote                  = /^(?:https?:|data:)/i.test(banner);
  const [localSrc, setLocalSrc]   = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  const labels = mode === 'banner'
    ? { empty: 'Sin banner principal', off: 'Agregar banner', on: 'Cambiar banner' }
    : { empty: 'Sin foto', off: 'Agregar foto', on: 'Cambiar foto' };
  useEffect(() => {
    if (!banner || isRemote) return;
    let active = true;
    window.tools
      .hijitosReadBanner(banner)
      .then((data) => {
        if (active) {
          setLoadedFor(banner);
          setLocalSrc(data);
          setFailedFor((previous) => (previous === banner ? null : previous));
        }
      })
      .catch(() => {
        // error de lectura: el track se muestra sin banner hasta cambiar de ruta
      });
    return () => {
      active = false;
    };
  }, [banner, isRemote]);
  const source = isRemote ? banner : loadedFor === banner ? localSrc : null;
  const broken = failedFor === banner;
  if (!editable && (!source || broken)) return null;
  const kind = mode === 'banner' ? 'hijito-banner-main' : 'hijito-banner-photo';
  return (
    <div className={`hijito-banner ${kind}`}>
      {source && !broken ? (
        <img
          src={source}
          alt=""
          style={{ objectPosition: `${position.x}% ${position.y}%` }}
          onError={() => setFailedFor(banner)}
        />
      ) : (
        <span className="hijito-banner-placeholder">
          <ImageIcon size={26} />
          {labels.empty}
        </span>
      )}
      {editable && (
        <button type="button" className="hijito-banner-edit" onClick={onEdit} title="Cambiar">
          <ImageIcon size={13} />
          <span className="hijito-banner-edit-label">
            {source && !broken ? labels.on : labels.off}
          </span>
        </button>
      )}
    </div>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const size          = 78;
  const stroke        = 9;
  const radius        = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped       = Math.min(100, Math.max(0, percent));
  return (
    <svg className="hijito-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="hijito-ring-track" cx={size / 2} cy={size / 2} r={radius} />
      <circle
        className="hijito-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central">
        {clamped}%
      </text>
    </svg>
  );
}

function SubtaskComposer({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit          = () => {
    const clean = text.trim();
    if (!clean) return;
    onAdd(clean);
    setText('');
  };
  return (
    <div className="hijito-composer">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        placeholder="+ Agregar subtarea…"
      />
      <button type="button" disabled={!text.trim()} onClick={submit}>
        Agregar
      </button>
    </div>
  );
}

function TaskRow({ task, expanded, handlers }: { task: HijitoTask; expanded: boolean; handlers: TaskHandlers }) {
  const overdue = !task.done && task.dueDate && task.dueDate < todayIso();
  const doneSub = task.subtasks.filter((subtask) => subtask.done).length;
  return (
    <li className={`hijito-task${task.done ? ' done' : ''}`}>
      <label className="hijito-check" title={task.done ? 'Deshacer: volver a pendiente' : 'Marcar como realizada'}>
        <input type="checkbox" checked={task.done} onChange={handlers.onToggleDone} />
      </label>
      <button type="button" className="hijito-task-main" onClick={handlers.onToggleExpand}>
        <span className="hijito-task-desc">{task.description}</span>
        <span className={`hijito-priority hijito-priority-${task.priority}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.dueDate && (
          <span className={`hijito-due${overdue ? ' overdue' : ''}`}>
            📅 {formatDate(task.dueDate)}
          </span>
        )}
        {task.subtasks.length > 0 && (
          <span className="hijito-subtask-count">
            {doneSub}/{task.subtasks.length} ✓
          </span>
        )}
      </button>
      <span className="hijito-task-actions">
        <button type="button" title="Editar tarea" onClick={handlers.onEdit}>
          ✎
        </button>
        <button type="button" className="danger" title="Eliminar tarea" onClick={handlers.onDelete}>
          ✕
        </button>
      </span>
      {expanded && (
        <div className="hijito-expanded">
          {task.subtasks.length === 0 ? (
            <p className="hijito-subtask-empty">Sin subtareas todavía.</p>
          ) : (
            <ul className="hijito-subtasks">
              {task.subtasks.map((subtask) => (
                <li key={subtask.id} className={subtask.done ? 'done' : ''}>
                  <label className="hijito-check">
                    <input
                      type="checkbox"
                      checked={subtask.done}
                      onChange={() => handlers.onToggleSubtask(subtask)}
                    />
                  </label>
                  <span className="hijito-subtask-desc">{subtask.description}</span>
                  <button type="button" title="Eliminar subtarea" onClick={() => handlers.onDeleteSubtask(subtask)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SubtaskComposer onAdd={handlers.onAddSubtask} />
        </div>
      )}
    </li>
  );
}

function TrackCard({
  track,
  expandedTasks,
  handlers,
  onNewTask,
  onEditTrack,
}: {
  track: HijitoTrack;
  expandedTasks: Set<number>;
  handlers: (task: HijitoTask) => TaskHandlers;
  onNewTask: () => void;
  onEditTrack: () => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const pending                           = track.tasks.filter((task) => !task.done).sort(compareTasks);
  const completed                         = track.tasks
    .filter((task) => task.done)
    .sort((a, b) => b.id - a.id);
  return (
    <section className="hijito-track">
      <TrackBanner
        banner={track.banner}
        position={{ x: track.bannerX, y: track.bannerY }}
        editable
        onEdit={onEditTrack}
      />
      <div className="hijito-track-head">
        <button type="button" className="hijito-track-title" onClick={onEditTrack} title="Configurar gatito">
          <span className="hijito-track-paw"><PawIcon /></span>
          <span className="hijito-track-name">
            <strong>{track.name}</strong>
            <small>
              {track.stats.total} tareas · {track.stats.pending} pendientes · {track.stats.done} realizadas
            </small>
          </span>
        </button>
        <ProgressRing percent={track.stats.percent} />
      </div>
      <div className="hijito-track-body">
        <div className="hijito-group-title">
          <strong>Pendientes</strong>
          <button type="button" className="hijito-new-task" onClick={onNewTask}>
            + Nueva tarea
          </button>
        </div>
        {pending.length === 0 ? (
          <p className="hijito-empty"><PawIcon size={15} /> Sin tareas pendientes. ¡A crear la primera!</p>
        ) : (
          <ul className="hijito-list">
            {pending.map((task) => (
              <TaskRow key={task.id} task={task} expanded={expandedTasks.has(task.id)} handlers={handlers(task)} />
            ))}
          </ul>
        )}
        {completed.length > 0 && (
          <div className="hijito-completed">
            <button
              type="button"
              className="hijito-completed-toggle"
              onClick={() => setShowCompleted((shown) => !shown)}
            >
              Realizadas ({completed.length}) <span>{showCompleted ? '▲' : '▼'}</span>
            </button>
            {showCompleted && (
              <ul className="hijito-list">
                {completed.map((task) => (
                  <TaskRow key={task.id} task={task} expanded={expandedTasks.has(task.id)} handlers={handlers(task)} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TaskEditor({
  tracks,
  draft,
  onClose,
  onSave,
}: {
  tracks: HijitoTrack[];
  draft: TaskDraft;
  onClose: () => void;
  onSave: (draft: TaskDraft) => void;
}) {
  const [form, setForm]   = useState<TaskDraft>(draft);
  const [error, setError] = useState('');
  const submit            = () => {
    if (!form.description.trim()) {
      setError('La descripción es obligatoria.');
      return;
    }
    onSave(form);
  };
  return (
    <div
      className="image-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-search-modal hijito-editor">
        <header>
          <div>
            <h2>{draft.taskId ? 'Editar tarea' : 'Nueva tarea'}</h2>
            <p>La tarea entrará directamente en la sección de pendientes de su gatito.</p>
          </div>
        </header>
        <div className="collection-form-grid">
          <label>
            <span>Gatito *</span>
            <select value={form.trackSlug} onChange={(event) => setForm({ ...form, trackSlug: event.target.value })}>
              {tracks.map((track) => (
                <option value={track.slug} key={track.slug}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Prioridad</span>
            <select
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as HijitoPriority })}
            >
              <option value="bajo">Baja</option>
              <option value="medio">Media</option>
              <option value="alto">Alta</option>
            </select>
          </label>
          <label className="wide">
            <span>Descripción *</span>
            <textarea
              autoFocus
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="¿Qué hay que hacer?"
            />
          </label>
          <label className="wide">
            <span>Fecha de compromiso (opcional)</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </label>
        </div>
        {error && <p className="hijito-form-error">{error}</p>}
        <footer>
          <span>💡 Puedes dividir la tarea en subtareas desde su vista.</span>
          <div>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="prompt-confirm" onClick={submit}>
              {draft.taskId ? 'Guardar cambios' : 'Crear tarea'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function TrackEditor({
  track,
  onClose,
  onSave,
}: {
  track: HijitoTrack;
  onClose: () => void;
  onSave: (patch: { name: string; banner: string; bannerX: number; bannerY: number }) => void;
}) {
  const [name, setName]       = useState(track.name);
  const [banner, setBanner]   = useState(track.banner);
  const [bannerX, setBannerX] = useState(track.bannerX ?? 50);
  const [bannerY, setBannerY] = useState(track.bannerY ?? 50);
  const [error, setError]     = useState('');
  const pickImage             = async () => {
    const picked = await window.tools.hijitosSelectBanner();
    if (picked) setBanner(picked);
  };
  const submit   = () => {
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    onSave({
      name:    name.trim(),
      banner:  banner.trim(),
      bannerX: Math.min(100, Math.max(0, Math.round(bannerX))),
      bannerY: Math.min(100, Math.max(0, Math.round(bannerY))),
    });
  };
  const position = { x: bannerX, y: bannerY };
  const presets  = [
    { x: 0, y: 0, label: 'Arriba-izquierda' },
    { x: 50, y: 0, label: 'Arriba-centro' },
    { x: 100, y: 0, label: 'Arriba-derecha' },
    { x: 0, y: 50, label: 'Centro-izquierda' },
    { x: 50, y: 50, label: 'Centro' },
    { x: 100, y: 50, label: 'Centro-derecha' },
    { x: 0, y: 100, label: 'Abajo-izquierda' },
    { x: 50, y: 100, label: 'Abajo-centro' },
    { x: 100, y: 100, label: 'Abajo-derecha' },
  ];
  return (
    <div
      className="image-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-search-modal hijito-editor">
        <header>
          <div>
            <h2>Configurar {track.name}</h2>
            <p>Personaliza el nombre y el banner del gatito (URL o ruta local).</p>
          </div>
        </header>
        <div className="collection-form-grid">
          <label>
            <span>Nombre</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>Banner (URL o ruta local)</span>
            <div className="collection-image-row">
              <input
                value={banner}
                onChange={(event) => setBanner(event.target.value)}
                placeholder="https://… o C:\carpeta\imagen.png"
              />
              <button type="button" onClick={pickImage}>
                Elegir imagen…
              </button>
            </div>
          </label>
          {banner && (
            <label className="wide">
              <span>Vista previa</span>
              <TrackBanner banner={banner} position={position} />
            </label>
          )}
          {banner && (
            <label className="wide hijito-position">
              <span>Posición de la imagen</span>
              <div className="collection-image-row">
                <label>
                  <span>X</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={bannerX}
                    onChange={(event) => setBannerX(Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={bannerY}
                    onChange={(event) => setBannerY(Number(event.target.value))}
                  />
                </label>
                <button type="button" onClick={() => { setBannerX(50); setBannerY(50); }}>
                  Centro
                </button>
                <button type="button" onClick={() => { setBannerX(0); setBannerY(0); }}>
                  Arriba izq.
                </button>
                <button type="button" onClick={() => { setBannerX(0); setBannerY(100); }}>
                  Abajo izq.
                </button>
              </div>
              <div className="hijito-position-grid" role="group" aria-label="Posición rápida">
                {presets.map((preset) => (
                  <button
                    key={`${preset.x}-${preset.y}`}
                    type="button"
                    title={preset.label}
                    className={preset.x === bannerX && preset.y === bannerY ? 'active' : ''}
                    onClick={() => { setBannerX(preset.x); setBannerY(preset.y); }}
                  />
                ))}
              </div>
            </label>
          )}
        </div>
        {error && <p className="hijito-form-error">{error}</p>}
        <footer>
          <span>La ruta local se guarda tal cual y se carga solo en este equipo.</span>
          <div>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="prompt-confirm" onClick={submit}>
              Guardar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function BannerEditor({
  banner,
  onClose,
  onSave,
}: {
  banner: string;
  onClose: () => void;
  onSave: (banner: string) => void;
}) {
  const [value, setValue] = useState(banner);
  const pickImage         = async () => {
    const picked = await window.tools.hijitosSelectBanner();
    if (picked) setValue(picked);
  };
  const submit = () => onSave(value.trim());
  return (
    <div
      className="image-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-search-modal hijito-editor">
        <header>
          <div>
            <h2>Banner principal</h2>
            <p>Imagen de cabecera de la sección Hijitos, por URL o ruta local.</p>
          </div>
        </header>
        <div className="collection-form-grid">
          <label className="wide">
            <span>Banner (URL o ruta local)</span>
            <div className="collection-image-row">
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="https://… o C:\carpeta\imagen.png"
              />
              <button type="button" onClick={pickImage}>
                Elegir imagen…
              </button>
            </div>
          </label>
          {value && (
            <label className="wide">
              <span>Vista previa</span>
              <TrackBanner banner={value} />
            </label>
          )}
        </div>
        <footer>
          <span>Déjalo vacío para quitar el banner.</span>
          <div>
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="prompt-confirm" onClick={submit}>
              Guardar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function HijitosTool() {
  const [tracks, setTracks]               = useState<HijitoTrack[]>([]);
  const [banner, setBanner]               = useState('');
  const [loaded, setLoaded]               = useState(false);
  const [message, setMessage]             = useState('');
  const [taskEditor, setTaskEditor]       = useState<TaskDraft | null>(null);
  const [trackEditor, setTrackEditor]     = useState<string | null>(null);
  const [bannerEditor, setBannerEditor]   = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());

  useEffect(() => {
    let active = true;
    Promise.all([window.tools.hijitosList(), window.tools.hijitosGetBanner()])
      .then(([trackData, bannerData]) => {
        if (active) {
          setTracks(trackData);
          setBanner(bannerData);
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = async () => {
    try {
      const [trackData, bannerData] = await Promise.all([
        window.tools.hijitosList(),
        window.tools.hijitosGetBanner(),
      ]);
      setTracks(trackData);
      setBanner(bannerData);
      setMessage('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const openNewTask = (trackSlug: string) =>
    setTaskEditor({ taskId: null, trackSlug, description: '', dueDate: '', priority: 'medio' });

  const openEditTask = (task: HijitoTask) =>
    setTaskEditor({
      taskId:      task.id,
      trackSlug:   task.trackSlug,
      description: task.description,
      dueDate:     task.dueDate,
      priority:    task.priority,
    });

  const toggleTaskExpanded = (id: number) =>
    setExpandedTasks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveTask = async (draft: TaskDraft) => {
    try {
      if (draft.taskId) {
        await window.tools.hijitosUpdateTask(draft.taskId, {
          trackSlug:   draft.trackSlug,
          description: draft.description.trim(),
          dueDate:     draft.dueDate,
          priority:    draft.priority,
        });
      } else {
        await window.tools.hijitosCreateTask({
          trackSlug:   draft.trackSlug,
          description: draft.description.trim(),
          dueDate:     draft.dueDate,
          priority:    draft.priority,
        });
      }
      setTaskEditor(null);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const toggleTaskDone = async (task: HijitoTask) => {
    try {
      await window.tools.hijitosUpdateTask(task.id, { done: !task.done });
      setExpandedTasks((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const deleteTask = async (task: HijitoTask) => {
    if (!confirm(`¿Eliminar la tarea "${task.description}"?`)) return;
    try {
      await window.tools.hijitosDeleteTask(task.id);
      setExpandedTasks((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const addSubtask = async (task: HijitoTask, text: string) => {
    try {
      await window.tools.hijitosCreateSubtask(task.id, text);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const toggleSubtask = async (subtask: HijitoSubtask) => {
    try {
      await window.tools.hijitosUpdateSubtask(subtask.id, { done: !subtask.done });
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const deleteSubtask = async (subtask: HijitoSubtask) => {
    if (!confirm('¿Eliminar esta subtarea?')) return;
    try {
      await window.tools.hijitosDeleteSubtask(subtask.id);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const saveTrack = async (
    slug: string,
    patch: { name: string; banner: string; bannerX: number; bannerY: number },
  ) => {
    try {
      await window.tools.hijitosUpdateTrack(slug, patch);
      setTrackEditor(null);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const saveBanner = async (value: string) => {
    try {
      await window.tools.hijitosSetBanner(value);
      setBannerEditor(false);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const makeHandlers = (task: HijitoTask): TaskHandlers => ({
    onToggleExpand:  () => toggleTaskExpanded(task.id),
    onToggleDone:    () => void toggleTaskDone(task),
    onEdit:          () => openEditTask(task),
    onDelete:        () => void deleteTask(task),
    onAddSubtask:    (text) => void addSubtask(task, text),
    onToggleSubtask: (subtask) => void toggleSubtask(subtask),
    onDeleteSubtask: (subtask) => void deleteSubtask(subtask),
  });

  const pendingTotal = tracks.reduce((sum, track) => sum + track.stats.pending, 0);
  const trackOpen    = tracks.find((track) => track.slug === trackEditor) ?? null;

  return (
    <section className="tool hijitos-tool">
      <header>
        <span>
          <CatIcon size={22} />
        </span>
        <div>
          <h1>Hijitos ❤</h1>
          <p>Seguimiento de tareas de Izumi y Pepita.</p>
        </div>
        <b>● Todo permanece local</b>
        {pendingTotal > 0 && <b className="hijito-badge"><PawIcon size={14} /> {pendingTotal} pendientes</b>}
      </header>
      {message && <p className="hijito-message">{message}</p>}
      {!loaded ? (
        <p className="hijito-empty">Cargando gatitos…</p>
      ) : (
        <div className="hijito-main-banner">
          <TrackBanner banner={banner} editable mode="banner" onEdit={() => setBannerEditor(true)} />
        </div>
      )}
      {loaded && (
        <div className="hijito-tracks">
          {tracks.map((track) => (
            <TrackCard
              key={track.slug}
              track={track}
              expandedTasks={expandedTasks}
              handlers={makeHandlers}
              onNewTask={() => openNewTask(track.slug)}
              onEditTrack={() => setTrackEditor(track.slug)}
            />
          ))}
        </div>
      )}
      {taskEditor && (
        <TaskEditor
          tracks={tracks}
          draft={taskEditor}
          onClose={() => setTaskEditor(null)}
          onSave={(draft) => void saveTask(draft)}
        />
      )}
      {trackOpen && (
        <TrackEditor
          track={trackOpen}
          onClose={() => setTrackEditor(null)}
          onSave={(patch) => void saveTrack(trackOpen.slug, patch)}
        />
      )}
      {bannerEditor && (
        <BannerEditor
          banner={banner}
          onClose={() => setBannerEditor(false)}
          onSave={(value) => void saveBanner(value)}
        />
      )}
    </section>
  );
}