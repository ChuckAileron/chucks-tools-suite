import { useEffect, useState } from 'react';
import type { CalendarioEvent } from './types';

type EventFields = {
  title: string;
  label: string;
  color: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  description: string;
  images: string[];
  isHoliday?: boolean;
};
type EventDraft = EventFields & { id?: number };
type EventPageProps = {
  draft: EventDraft;
  setDraft: (draft: EventDraft) => void;
  colors: string[];
  isNew: boolean;
  busy: boolean;
  save: () => void;
  remove: () => void;
  cancel: () => void;
};

const WEEKDAYS                             = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH_NAMES                          = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const EVENT_COLORS                         = ['teal', 'azul', 'naranja', 'rojo', 'verde', 'morado', 'amarillo'];
const COLOR_LABELS: Record<string, string> = {
  teal:     'Turquesa',
  azul:     'Azul',
  naranja:  'Naranja',
  rojo:     'Rojo',
  verde:    'Verde',
  morado:   'Morado',
  amarillo: 'Amarillo',
};
const MIN_YEAR                             = 2000;
const pad2                                 = (value: number) => `${value}`.padStart(2, '0');
const dateStr                              = (year: number, month: number, day: number) =>
  `${year}-${pad2(month)}-${pad2(day)}`;
const todayStr                             = () => {
  const now = new Date();
  return dateStr(now.getFullYear(), now.getMonth() + 1, now.getDate());
};
const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};
const dateLabel = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date               = new Date(year, month - 1, day);
  return formatDate(value) + ' · ' + date.toLocaleDateString('es-AR', { weekday: 'long' });
};

function useImageSources(images: string[]) {
  const [sources, setSources] = useState<Record<string, string>>({});
  const key                   = images.join('|');
   
  useEffect(() => {
    let cancelled                      = false;
    const next: Record<string, string> = {};
    const local: string[]              = [];
    for (const image of images) {
      if (/^https?:\/\//i.test(image)) next[image] = image;
      else local.push(image);
    }
    Promise.all(
      local.map((image) =>
        window.tools.calendarioReadImage(image).then((src) => ({ image, src })),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        for (const { image, src } of entries) if (src) next[image] = src;
        setSources(next);
      })
      .catch(() => {
        if (!cancelled) setSources(next);
      });
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return sources;
}

export default function CalendarioTool() {
  const [year, setYear]               = useState<number>(new Date().getFullYear());
  const [events, setEvents]           = useState<CalendarioEvent[]>([]);
  const [colors, setColors]           = useState<string[]>(EVENT_COLORS);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [draft, setDraft]             = useState<EventDraft | null>(null);
  const [message, setMessage]         = useState('');
  const [busy, setBusy]               = useState(false);

  const newest = new Date().getFullYear() + 1;
  const years  = Array.from({ length: newest - MIN_YEAR + 1 }, (_, index) => newest - index);

  const reload = async () => {
    try {
      const list = await window.tools.calendarioEvents(`${year}-01-01`, `${year}-12-31`);
      setEvents(list);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    window.tools
      .calendarioEvents(`${year}-01-01`, `${year}-12-31`)
      .then(setEvents)
      .catch((error) => setMessage(String(error)));
  }, [year]);

  useEffect(() => {
    window.tools
      .calendarioColors()
      .then(setColors)
      .catch(() => setColors(EVENT_COLORS));
  }, []);

  const openEvent = (event: CalendarioEvent) => {
    setDraft({
      id:          event.id,
      title:       event.title,
      label:       event.label,
      color:       event.color,
      startDate:   event.startDate,
      endDate:     event.endDate,
      allDay:      event.allDay,
      startTime:   event.startTime || '',
      endTime:     event.endTime || '',
      description: event.description,
      images:      event.images,
      isHoliday:   event.isHoliday,
    });
  };

  const createFromDay = (day: string) => {
    setDraft({
      title:       '',
      label:       '',
      color:       colors[0] || 'teal',
      startDate:   day,
      endDate:     day,
      allDay:      true,
      startTime:   '',
      endTime:     '',
      description: '',
      images:      [],
    });
    setSelectedDay(null);
  };

  const cancelEvent = () => {
    setDraft(null);
  };

  const saveEvent = () =>
    run(async () => {
      if (!draft) return;
      const payload = {
        title:       draft.title,
        label:       draft.label,
        color:       draft.color,
        startDate:   draft.startDate,
        endDate:     draft.endDate,
        allDay:      draft.allDay,
        startTime:   draft.allDay ? null : draft.startTime,
        endTime:     draft.allDay ? null : draft.endTime,
        description: draft.description,
        images:      draft.images,
      };
      if (draft.id !== undefined) {
        await window.tools.calendarioUpdate(draft.id, payload);
        setMessage('Evento actualizado.');
      } else {
        await window.tools.calendarioCreate(payload);
        setMessage('Evento creado.');
      }
      await reload();
      cancelEvent();
    });

  const removeEvent = () => {
    if (!draft || draft.id === undefined) return;
    if (!window.confirm(`¿Eliminar el evento "${draft.title}"?`)) return;
    run(async () => {
      await window.tools.calendarioDelete(draft.id as number);
      await reload();
      cancelEvent();
      setMessage('Evento eliminado.');
    });
  };

  const updateHolidays = () =>
    run(async () => {
      const result = await window.tools.calendarioUpdateHolidays(year);
      await reload();
      setMessage(`Feriados actualizados: ${result.total} para ${result.year}.`);
    });

  const dayEvents = (day: string) =>
    events
      .filter((event) => event.startDate <= day && event.endDate >= day)
      .sort((a, b) => {
        const aAll = a.allDay ? 0 : 1;
        const bAll = b.allDay ? 0 : 1;
        if (aAll !== bAll) return aAll - bAll;
        return (a.startTime || '').localeCompare(b.startTime || '');
      });

  return (
    <section className="tool calendario-tool">
      <header>
        <span>CA</span>
        <div>
          <h1>Calendario</h1>
          <p>Eventos por día o por rango de días, con hora y notas con imágenes.</p>
        </div>
        <b>● SQLite local</b>
      </header>
      {message && <p className="calendario-message">{message}</p>}
      {draft ? (
        <EventPage
          draft={draft}
          setDraft={setDraft}
          colors={colors}
          isNew={draft.id === undefined}
          busy={busy}
          save={saveEvent}
          remove={removeEvent}
          cancel={cancelEvent}
        />
      ) : (
        <div className="workspace calendario-workspace">
          <div className="calendario-yearbar">
            <button
              onClick={() => setYear((previous) => previous - 1)}
              disabled={year <= MIN_YEAR}
              title="Año anterior"
            >
              ◀
            </button>
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <button
              onClick={() => setYear((previous) => previous + 1)}
              disabled={year >= newest}
              title="Año siguiente"
            >
              ▶
            </button>
            <button
              className="calendario-holidays"
              onClick={updateHolidays}
              disabled={busy}
              title="Actualizar feriados de Chile desde la API"
            >
              {busy ? 'Actualizando…' : 'Actualizar feriados'}
            </button>
          </div>
          <div className="calendario-grid">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <MonthPanel
                key={month}
                year={year}
                month={month}
                events={events}
                onDay={setSelectedDay}
                onEvent={openEvent}
              />
            ))}
          </div>
          {selectedDay && (
            <div className="calendario-overlay" onClick={() => setSelectedDay(null)}>
              <div className="calendario-dialog" onClick={(event) => event.stopPropagation()}>
                <header>
                  <h2>{dateLabel(selectedDay)}</h2>
                  <button
                    className="calendario-dialog-close"
                    onClick={() => setSelectedDay(null)}
                  >
                    ✕
                  </button>
                </header>
                <button className="calendario-new-event" onClick={() => createFromDay(selectedDay)}>
                  + Nuevo evento
                </button>
                {dayEvents(selectedDay).map((event) => (
                  <button
                    key={event.id}
                    className={`calendario-agenda-item cal-event-${event.color}`}
                    onClick={() => {
                      setSelectedDay(null);
                      openEvent(event);
                    }}
                  >
                    <b>
                      {event.isHoliday ? '⚑ ' : ''}
                      {event.title}
                    </b>
                    <span>{eventTimeLabel(event)}</span>
                  </button>
                ))}
                {dayEvents(selectedDay).length === 0 && (
                  <p className="calendario-dialog-empty">Sin eventos este día.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MonthPanel({ year, month, events, onDay, onEvent }: {
  year: number;
  month: number;
  events: CalendarioEvent[];
  onDay: (day: string) => void;
  onEvent: (event: CalendarioEvent) => void;
}) {
  const startWeekday             = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth              = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const today                    = todayStr();
  return (
    <div className="calendario-month">
      <header>{MONTH_NAMES[month - 1]}</header>
      <div className="calendario-weekdays">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="calendario-days">
        {cells.map((day, index) => {
          if (day === null) return <span key={index} className="calendario-cell empty" />;
          const current = dateStr(year, month, day);
          const list    = events
            .filter((event) => event.startDate <= current && event.endDate >= current)
            .sort((a, b) => {
              const aAll = a.allDay ? 0 : 1;
              const bAll = b.allDay ? 0 : 1;
              if (aAll !== bAll) return aAll - bAll;
              return (a.startTime || '').localeCompare(b.startTime || '');
            });
          const shown   = list.slice(0, 3);
          const extra   = list.length - shown.length;
          const holiday = list.some((event) => event.isHoliday);
          return (
            <div
              key={index}
              className={`calendario-cell${current === today ? ' today' : ''}${holiday ? ' holiday' : ''}`}
              onClick={() => onDay(current)}
            >
              <span className="calendario-day-num">{day}</span>
              {shown.map((event) => (
                <button
                  key={event.id}
                  className={`cal-pill cal-event-${event.color}${event.isHoliday ? ' cal-pill-holiday' : ''}`}
                  title={event.title}
                  onClick={(click) => {
                    click.stopPropagation();
                    onEvent(event);
                  }}
                >
                  {event.isHoliday ? '⚑' : event.title}
                </button>
              ))}
              {extra > 0 && <span className="calendario-more">+{extra} más</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const eventTimeLabel = (event: CalendarioEvent) => {
  if (event.allDay) return 'Todo el día';
  if (event.startTime && event.endTime) return `${event.startTime} – ${event.endTime}`;
  return event.startTime || 'Todo el día';
};

const eventRangeLabel = (event: Pick<CalendarioEvent, 'startDate' | 'endDate' | 'allDay' | 'startTime' | 'endTime'>) => {
  const range =
    event.startDate === event.endDate
      ? formatDate(event.startDate)
      : `${formatDate(event.startDate)} → ${formatDate(event.endDate)}`;
  const time  = event.allDay
    ? 'Todo el día'
    : event.startTime
      ? event.endTime
        ? `${event.startTime} – ${event.endTime}`
        : event.startTime
      : '';
  return time ? `${range} · ${time}` : range;
};

function EventPage({ draft, setDraft, colors, isNew, busy, save, remove, cancel }: EventPageProps) {
  const [mode, setMode]         = useState<'view' | 'edit'>(isNew ? 'edit' : 'view');
  const [urlInput, setUrlInput] = useState('');
  const sources                 = useImageSources(draft.images);
  const sourceEntries           = Object.entries(sources);

  const set = (patch: Partial<EventDraft>) => setDraft({ ...draft, ...patch });

  const addImages = async () => {
    try {
      const files = await window.tools.imagesSelect();
      if (files.length) set({ images: [...draft.images, ...files] });
    } catch (error) {
      console.error('calendario:add-images', error);
    }
  };

  const addUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\/.+/i.test(url)) {
      window.alert('Ingresá una URL válida (http/https).');
      return;
    }
    set({ images: [...draft.images, url] });
    setUrlInput('');
  };

  const removeImage = (image: string) =>
    set({ images: draft.images.filter((item) => item !== image) });

  return (
    <div className="workspace calendario-event-page">
      <header className="calendario-page-head">
        <button className="calendario-back" onClick={cancel}>
          ← Volver al año
        </button>
        <p className="calendario-page-head-stats">
          <span className={`cal-event-${draft.color}`}>{COLOR_LABELS[draft.color] ?? draft.color}</span>
          <span>{eventRangeLabel(draft)}</span>
        </p>
      </header>
      {mode === 'view' ? (
        <article className="calendario-page-view">
          <h1>{draft.title}</h1>
          {draft.isHoliday && <span className="calendario-page-holiday">⚑ Feriado de Chile</span>}
          {draft.label && <span className="calendario-page-label">{draft.label}</span>}
          {draft.description && (
            <div className="calendario-page-text">
              {draft.description.split('\n').map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          )}
          {sourceEntries.length > 0 && (
            <div className="calendario-image-grid">
              {sourceEntries.map(([image, src]) =>
                src ? (
                  <figure key={image}>
                    <img src={src} alt={image} />
                  </figure>
                ) : null,
              )}
            </div>
          )}
          <button className="calendario-edit-btn" onClick={() => setMode('edit')} disabled={busy}>
            Editar evento
          </button>
        </article>
      ) : (
        <article className="calendario-page-edit">
          <div className="calendario-form-grid">
            <label className="wide">
              Título
              <input
                value={draft.title}
                placeholder="p. ej. Cumpleaños, Entrega, Viaje..."
                onChange={(event) => set({ title: event.target.value })}
              />
            </label>
            <label>
              Etiqueta
              <input
                value={draft.label}
                placeholder="p. ej. Personal, Trabajo"
                onChange={(event) => set({ label: event.target.value })}
              />
            </label>
            <div>
              <span className="calendario-field-label">Color</span>
              <div className="calendario-colors">
                {colors.map((color) => (
                  <button
                    key={color}
                    className={`cal-swatch cal-event-${color}${draft.color === color ? ' active' : ''}`}
                    title={COLOR_LABELS[color] ?? color}
                    onClick={() => set({ color })}
                  />
                ))}
              </div>
            </div>
            <label>
              Desde
              <input
                type="date"
                value={draft.startDate}
                onChange={(event) => set({ startDate: event.target.value })}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={draft.endDate}
                onChange={(event) => set({ endDate: event.target.value })}
              />
            </label>
            <label className="calendario-check wide">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(event) => set({ allDay: event.target.checked })}
              />
              Todo el día
            </label>
            {!draft.allDay && (
              <>
                <label>
                  Hora de inicio
                  <input
                    type="time"
                    value={draft.startTime}
                    onChange={(event) => set({ startTime: event.target.value })}
                  />
                </label>
                <label>
                  Hora de fin
                  <input
                    type="time"
                    value={draft.endTime}
                    onChange={(event) => set({ endTime: event.target.value })}
                  />
                </label>
              </>
            )}
            <label className="wide">
              Notas
              <textarea
                value={draft.description}
                placeholder="Textos sobre el evento..."
                onChange={(event) => set({ description: event.target.value })}
              />
            </label>
            <div className="wide calendario-images">
              <span className="calendario-field-label">Imágenes</span>
              <div className="calendario-images-actions">
                <button onClick={addImages}>+ Agregar imágenes</button>
                <input
                  value={urlInput}
                  placeholder="Pegar URL de imagen..."
                  onChange={(event) => setUrlInput(event.target.value)}
                />
                <button onClick={addUrl} disabled={!urlInput.trim()}>
                  Agregar URL
                </button>
              </div>
              {sourceEntries.length > 0 && (
                <div className="calendario-image-grid">
                  {sourceEntries.map(([image, src]) =>
                    src ? (
                      <figure key={image}>
                        <img src={src} alt={image} />
                        <figcaption>
                          <button onClick={() => removeImage(image)}>Quitar</button>
                        </figcaption>
                      </figure>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="calendario-actions">
            <button className="calendario-danger" onClick={remove} disabled={busy} hidden={isNew}>
              Eliminar evento
            </button>
            <button className="calendario-save" onClick={save} disabled={busy}>
              Guardar evento
            </button>
          </div>
        </article>
      )}
    </div>
  );
}