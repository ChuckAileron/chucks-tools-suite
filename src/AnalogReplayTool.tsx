import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AnalogChannel,
  AnalogFolderVideo,
  AnalogMonthSchedule,
  AnalogScheduleConfig,
  AnalogScheduleEntry,
  AnalogScheduleStatus,
  AnalogShow,
} from './types';

type Screen = 'home' | 'channels' | 'shows' | 'schedule';
const SCREENS: Record<Screen, { title: string; subtitle: string }> = {
  home: { title: 'Inicio', subtitle: 'Resumen general de la configuración' },
  channels: { title: 'Canales', subtitle: 'Crear, editar y eliminar canales' },
  shows: { title: 'Programas', subtitle: 'Crear, editar y eliminar programas' },
  schedule: { title: 'Programación', subtitle: 'Estado, generación y reseteo de la programación' },
};
const NAV_ITEMS: { id: Screen; label: string; short: string }[] = [
  { id: 'home', label: 'Inicio', short: 'IN' },
  { id: 'channels', label: 'Canales', short: 'CN' },
  { id: 'shows', label: 'Programas', short: 'PG' },
  { id: 'schedule', label: 'Programación', short: 'PR' },
];

export default function AnalogReplayTool() {
  const [screen, setScreen] = useState<Screen>('home');
  const [channels, setChannels] = useState<AnalogChannel[]>([]);
  const [shows, setShows] = useState<AnalogShow[]>([]);
  const meta = SCREENS[screen];
  const reloadCounts = useCallback(async () => {
    try {
      const [loadedChannels, loadedShows] = await Promise.all([
        window.tools.analogListChannels(),
        window.tools.analogListShows(),
      ]);
      setChannels(loadedChannels);
      setShows(loadedShows);
    } catch {
      // los contadores son informativos; cada pantalla muestra su propio error
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([window.tools.analogListChannels(), window.tools.analogListShows()])
      .then(([loadedChannels, loadedShows]) => {
        if (cancelled) return;
        setChannels(loadedChannels);
        setShows(loadedShows);
      })
      .catch(() => {
        // los contadores son informativos; cada pantalla muestra su propio error
      });
    return () => {
      cancelled = true;
    };
  }, [screen]);

  return (
    <section className="tool analog-tool">
      <header>
        <span>TV</span>
        <div>
          <h1>AnalogReplayTV</h1>
          <p>Configuración de canales, programas y programación compartida con AnalogReplayTV.</p>
        </div>
        <b>● SQLite compartido</b>
      </header>
      <div className="download-tabs">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={screen === item.id ? 'active' : ''}
            onClick={() => setScreen(item.id)}
          >
            {item.label}
            {item.id === 'channels' && <b>{channels.length}</b>}
            {item.id === 'shows' && <b>{shows.length}</b>}
          </button>
        ))}
      </div>
      <div className="workspace analog-workspace">
        <div className="step">
          <span>{NAV_ITEMS.findIndex((item) => item.id === screen) + 1}</span>
          <div>
            <h2>{meta.title}</h2>
            <p>{meta.subtitle}</p>
          </div>
        </div>
        {screen === 'home' && <HomeScreen onNavigate={setScreen} refreshCounts={reloadCounts} />}
        {screen === 'channels' && <ChannelsScreen refreshCounts={reloadCounts} />}
        {screen === 'shows' && <ShowsScreen refreshCounts={reloadCounts} />}
        {screen === 'schedule' && <ScheduleScreen refreshCounts={reloadCounts} />}
      </div>
    </section>
  );
}

function HomeScreen({
  onNavigate,
  refreshCounts,
}: {
  onNavigate: (screen: Screen) => void;
  refreshCounts: () => void;
}) {
  const [channels, setChannels] = useState<AnalogChannel[]>([]);
  const [shows, setShows] = useState<AnalogShow[]>([]);
  const [status, setStatus] = useState<AnalogScheduleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [loadedChannels, loadedShows, scheduleStatus] = await Promise.all([
          window.tools.analogListChannels(),
          window.tools.analogListShows(),
          window.tools.analogScheduleStatus().catch(() => null),
        ]);
        if (cancelled) return;
        setChannels(loadedChannels);
        setShows(loadedShows);
        setStatus(scheduleStatus);
        refreshCounts();
      } catch (failure) {
        if (!cancelled) setError(String(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCounts]);

  const enabledChannels = channels.filter((channel) => channel.isEnabled !== false);
  const totalEpisodes = shows.reduce(
    (total, show) =>
      total + show.seasons.reduce((sum, season) => sum + (season.episodes?.length || 0), 0),
    0,
  );
  const scheduleReady = status?.status === 'ready' && status.config?.primaryYear;
  if (loading) return <p className="analog-message">Cargando resumen de la configuración...</p>;
  if (error) return <p className="analog-message analog-error">{error}</p>;
  return (
    <div className="analog-home">
      <div className="analog-stats">
        <button onClick={() => onNavigate('channels')} title="Administrar canales">
          <strong>{enabledChannels.length}</strong>
          <span>
            Canales{channels.length !== enabledChannels.length && ` de ${channels.length}`}
          </span>
        </button>
        <button onClick={() => onNavigate('shows')} title="Administrar programas">
          <strong>{shows.length}</strong>
          <span>Programas</span>
        </button>
        <button onClick={() => onNavigate('schedule')} title="Ver programación">
          <strong>{totalEpisodes}</strong>
          <span>Episodios</span>
        </button>
        <button
          className={scheduleReady ? '' : 'warning'}
          onClick={() => onNavigate('schedule')}
          title="Ver programación"
        >
          <strong>{scheduleReady ? status?.config.primaryYear : '—'}</strong>
          <span>{scheduleReady ? 'Programación activa' : 'Sin programación'}</span>
        </button>
      </div>
      <div className="analog-panel">
        <h3>Resumen de la programación</h3>
        {scheduleReady ? (
          <ul className="analog-summary">
            <li>
              <b>Año principal</b>
              <span>{status?.config.primaryYear}</span>
            </li>
            <li>
              <b>Meses generados</b>
              <span>{status?.config.generatedMonths.length}</span>
            </li>
            {status?.config.lastGenerated && (
              <li>
                <b>Última generación</b>
                <span>{formatDateTime(status.config.lastGenerated)}</span>
              </li>
            )}
          </ul>
        ) : (
          <div className="analog-empty">
            <p>
              Todavía no hay una programación generada. Crea o revisa tus canales y programas, y
              luego genera la programación.
            </p>
            <button className="analog-primary" onClick={() => onNavigate('schedule')}>
              Configurar Programación
            </button>
          </div>
        )}
      </div>
      <div className="analog-panel">
        <h3>Acciones rápidas</h3>
        <div className="analog-actions">
          <button className="analog-primary" onClick={() => onNavigate('channels')}>
            + Crear Canal
          </button>
          <button className="analog-primary" onClick={() => onNavigate('shows')}>
            + Crear Programa
          </button>
          <button onClick={() => onNavigate('schedule')}>Resetear Programación</button>
        </div>
      </div>
    </div>
  );
}

type ChannelView = 'list' | 'create' | 'edit' | 'import';
function ChannelsScreen({ refreshCounts }: { refreshCounts: () => void }) {
  const [channels, setChannels] = useState<AnalogChannel[]>([]);
  const [view, setView] = useState<ChannelView>('list');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState<AnalogChannel | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setMessage('');
    try {
      setChannels(await window.tools.analogListChannels());
      refreshCounts();
    } catch (failure) {
      setMessage(String(failure));
    }
  }, [refreshCounts]);
  useEffect(() => {
    let cancelled = false;
    window.tools
      .analogListChannels()
      .then((loaded) => {
        if (cancelled) return;
        setChannels(loaded);
        setMessage('');
        void refreshCounts();
      })
      .catch((failure) => {
        if (!cancelled) setMessage(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshCounts]);

  const resetForm = () => {
    setName('');
    setNumber('');
    setDescription('');
    setEnabled(true);
    setEditing(null);
  };
  const save = async () => {
    const parsed = Number.parseInt(number, 10);
    if (!name.trim()) return setMessage('El nombre del canal es requerido.');
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999)
      return setMessage('El número de canal debe estar entre 1 y 999.');
    const holder = channels.find(
      (channel) =>
        channel.number === parsed &&
        String(channel.uuid || channel.id) !== (editing ? String(editing.uuid || editing.id) : ''),
    );
    if (holder) return setMessage(`El número de canal ${parsed} ya lo usa «${holder.name}».`);
    setBusy(true);
    setMessage('');
    try {
      if (editing)
        await window.tools.analogUpdateChannel(editing.id, {
          name: name.trim(),
          number: parsed,
          description: description.trim(),
          isEnabled: enabled,
        });
      else
        await window.tools.analogCreateChannel({
          name: name.trim(),
          number: parsed,
          description: description.trim(),
          isEnabled: enabled,
        });
      resetForm();
      setView('list');
      await load();
      setMessage(editing ? 'Canal actualizado.' : 'Canal creado.');
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (channel: AnalogChannel) => {
    if (!confirm(`¿Eliminar el canal "${channel.name}"?`)) return;
    setBusy(true);
    try {
      await window.tools.analogDeleteChannel(channel.id);
      await load();
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (channel: AnalogChannel) => {
    try {
      await window.tools.analogUpdateChannel(channel.id, {
        isEnabled: channel.isEnabled === false,
      });
      await load();
    } catch (failure) {
      setMessage(String(failure));
    }
  };
  const importFile = async () => {
    setBusy(true);
    setMessage('');
    try {
      const filePath = await window.tools.analogSelectJson();
      if (!filePath) return;
      const count = await window.tools.analogImportChannels(filePath);
      setView('list');
      await load();
      setMessage(`Se importaron ${count} canales.`);
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {message && <p className="analog-message">{message}</p>}
      {view === 'list' && (
        <>
          <div className="analog-toolbar">
            <button
              className="analog-primary"
              onClick={() => {
                resetForm();
                setView('create');
              }}
            >
              + Crear Canal
            </button>
            <button onClick={() => setView('import')}>Importar Canales</button>
            <span>{channels.length} canales</span>
          </div>
          <div className="analog-list">
            {channels.map((channel) => (
              <article
                key={String(channel.uuid || channel.id)}
                className={channel.isEnabled === false ? 'disabled' : ''}
              >
                <div>
                  <h3>
                    <b>Canal {channel.number}</b> {channel.name}
                  </h3>
                  {channel.description && <p>{channel.description}</p>}
                  {channel.isEnabled === false && <small>Deshabilitado</small>}
                </div>
                <footer>
                  <button disabled={busy} onClick={() => void toggle(channel)}>
                    {channel.isEnabled === false ? 'Habilitar' : 'Deshabilitar'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(channel);
                      setName(channel.name);
                      setNumber(String(channel.number));
                      setDescription(channel.description || '');
                      setEnabled(channel.isEnabled !== false);
                      setView('edit');
                    }}
                  >
                    Editar
                  </button>
                  <button disabled={busy} onClick={() => void remove(channel)}>
                    Eliminar
                  </button>
                </footer>
              </article>
            ))}
            {!channels.length && <p className="analog-message">No hay canales configurados.</p>}
          </div>
        </>
      )}
      {(view === 'create' || view === 'edit') && (
        <div className="analog-panel">
          <h3>{view === 'edit' ? 'Editar canal' : 'Nuevo canal'}</h3>
          <div className="analog-form-grid">
            <label>
              <span>Nombre *</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>Número (1-999) *</span>
              <input
                type="number"
                min="1"
                max="999"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
              />
            </label>
            <label className="wide">
              <span>Descripción</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="analog-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>Canal habilitado</span>
            </label>
          </div>
          <div className="analog-actions">
            <button
              onClick={() => {
                resetForm();
                setView('list');
              }}
            >
              Cancelar
            </button>
            <button className="analog-primary" disabled={busy} onClick={() => void save()}>
              {view === 'edit' ? 'Actualizar Canal' : 'Agregar Canal'}
            </button>
          </div>
        </div>
      )}
      {view === 'import' && (
        <div className="analog-panel">
          <h3>Importar canales</h3>
          <p>Selecciona un archivo JSON con la configuración de canales para importar.</p>
          <div className="analog-actions">
            <button onClick={() => setView('list')}>Cancelar</button>
            <button className="analog-primary" disabled={busy} onClick={() => void importFile()}>
              Seleccionar Archivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ShowDraft = Omit<AnalogShow, 'id'> & { id?: number };
const EMPTY_SHOW: ShowDraft = {
  name: '',
  channel: [],
  seasons: [
    {
      season: 1,
      year: new Date().getFullYear(),
      episodes: [{ episode: 1, title: '', duration: '00:00' }],
      contentPath: '',
      contentPaths: [],
    },
  ],
  airYears: [],
  airUntilToDate: false,
  episodeAiringMode: 'daily-repeat',
};
type ShowView = 'list' | 'create' | 'edit' | 'import';
type ShowSort = 'channel-name' | 'name' | 'year';
function ShowsScreen({ refreshCounts }: { refreshCounts: () => void }) {
  const [shows, setShows] = useState<AnalogShow[]>([]);
  const [channels, setChannels] = useState<AnalogChannel[]>([]);
  const [view, setView] = useState<ShowView>('list');
  const [draft, setDraft] = useState<ShowDraft>(EMPTY_SHOW);
  const [channelInput, setChannelInput] = useState('');
  const [airYearInput, setAirYearInput] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sortBy, setSortBy] = useState<ShowSort>('name');
  const [channelFilter, setChannelFilter] = useState('');

  const load = useCallback(async () => {
    setMessage('');
    try {
      const [loadedShows, loadedChannels] = await Promise.all([
        window.tools.analogListShows(),
        window.tools.analogListChannels(),
      ]);
      setShows(loadedShows);
      setChannels(loadedChannels);
      refreshCounts();
    } catch (failure) {
      setMessage(String(failure));
    }
  }, [refreshCounts]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([window.tools.analogListShows(), window.tools.analogListChannels()])
      .then(([loadedShows, loadedChannels]) => {
        if (cancelled) return;
        setShows(loadedShows);
        setChannels(loadedChannels);
        setMessage('');
        void refreshCounts();
      })
      .catch((failure) => {
        if (!cancelled) setMessage(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshCounts]);

  const channelLabel = (entry: string) => {
    const match = channels.find(
      (channel) =>
        String(channel.id) === entry ||
        channel.uuid === entry ||
        channel.name.toLowerCase() === entry.toLowerCase(),
    );
    return match ? match.name : entry;
  };
  const channelKey = (channel: AnalogChannel) => String(channel.uuid || channel.id);
  const showChannelNames = (show: AnalogShow) =>
    show.channel.map(channelLabel).filter(Boolean).join(', ');
  const showYear = (show: AnalogShow) => {
    const years = (show.airYears || []).filter(Number.isInteger);
    return years.length ? Math.min(...years) : null;
  };
  const selectedChannel = channels.find((channel) => channelKey(channel) === channelFilter) || null;
  const visibleShows = shows.filter(
    (show) =>
      !selectedChannel ||
      show.channel.some(
        (entry) =>
          entry === selectedChannel.uuid ||
          entry === String(selectedChannel.id) ||
          String(entry).toLowerCase() === String(selectedChannel.name).toLowerCase(),
      ),
  );
  const sortedShows = [...visibleShows].sort((left, right) => {
    if (sortBy === 'channel-name') {
      const leftChannel = showChannelNames(left).toLowerCase();
      const rightChannel = showChannelNames(right).toLowerCase();
      if (leftChannel !== rightChannel) return leftChannel < rightChannel ? -1 : 1;
    } else if (sortBy === 'year') {
      const leftYear = showYear(left);
      const rightYear = showYear(right);
      if (leftYear == null && rightYear == null) {
        // sin años: se ordena por nombre
      } else if (leftYear == null) return 1;
      else if (rightYear == null) return -1;
      else if (leftYear !== rightYear) return leftYear - rightYear;
    }
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
  const addChannelTag = () => {
    const value = channelInput.trim();
    if (!value || draft.channel.includes(value)) {
      setChannelInput('');
      return;
    }
    setDraft({ ...draft, channel: [...draft.channel, value] });
    setChannelInput('');
  };
  const addAirYear = () => {
    const year = Number.parseInt(airYearInput.trim(), 10);
    if (Number.isInteger(year) && year >= 1900 && year <= 2100) {
      const current = draft.airYears || [];
      if (!current.includes(year))
        setDraft({ ...draft, airYears: [...current, year].sort((a, b) => a - b) });
    }
    setAirYearInput('');
  };
  const updateSeason = (index: number, patch: Partial<ShowDraft['seasons'][number]>) =>
    setDraft({
      ...draft,
      seasons: draft.seasons.map((season, position) =>
        position === index ? { ...season, ...patch } : season,
      ),
    });
  const updateEpisode = (
    seasonIndex: number,
    episodeIndex: number,
    patch: Partial<ShowDraft['seasons'][number]['episodes'][number]>,
  ) =>
    setDraft({
      ...draft,
      seasons: draft.seasons.map((season, position) =>
        position !== seasonIndex
          ? season
          : {
              ...season,
              episodes: season.episodes.map((episode, episodePosition) =>
                episodePosition !== episodeIndex ? episode : { ...episode, ...patch },
              ),
            },
      ),
    });

  const pickFolder = async (seasonIndex: number) => {
    try {
      const folderPath = await window.tools.analogSelectFolder();
      if (!folderPath) return;
      const videos: AnalogFolderVideo[] = await window.tools.analogFolderVideos(folderPath);
      if (!videos.length) return setMessage('No se encontraron videos en la carpeta.');
      updateSeason(seasonIndex, {
        contentPath: folderPath,
        episodes: videos.map((video) => ({
          episode: video.episode,
          title: video.title,
          duration: video.duration,
          fileName: video.fileName,
          fileNames: [video.fileName],
        })),
      });
      setMessage(`${videos.length} episodios detectados en la carpeta.`);
    } catch (failure) {
      setMessage(String(failure));
    }
  };
  const addContentPath = async (seasonIndex: number) => {
    try {
      const folderPath = await window.tools.analogSelectFolder();
      if (!folderPath) return;
      const season = draft.seasons[seasonIndex];
      const existing = season.contentPaths || [];
      if (season.contentPath === folderPath || existing.includes(folderPath)) return;
      let matches: Record<number, string | null> = {};
      try {
        matches = await window.tools.analogFolderMatch(
          folderPath,
          season.episodes.map((episode) => ({
            episode: episode.episode,
            fileNames: episodeFileNames(episode),
          })),
        );
      } catch {
        // el emparejamiento es opcional; la carpeta igual se agrega
      }
      setDraft({
        ...draft,
        seasons: draft.seasons.map((item, position) =>
          position !== seasonIndex
            ? item
            : {
                ...item,
                contentPaths: [...existing, folderPath],
                episodes: item.episodes.map((episode) => {
                  const matched = matches[episode.episode];
                  if (!matched) return episode;
                  const known = episodeFileNames(episode);
                  if (known.includes(matched)) return episode;
                  return { ...episode, fileNames: [...known, matched] };
                }),
              },
        ),
      });
    } catch (failure) {
      setMessage(String(failure));
    }
  };
  const save = async () => {
    if (!draft.name.trim()) return setMessage('El nombre del programa es requerido.');
    setBusy(true);
    setMessage('');
    try {
      const payload = {
        name: draft.name.trim(),
        channel: draft.channel,
        seasons: draft.seasons,
        airYears: draft.airYears || [],
        airUntilToDate: !!draft.airUntilToDate,
        episodeAiringMode: draft.episodeAiringMode || 'daily-repeat',
      };
      if (view === 'edit' && draft.id) await window.tools.analogUpdateShow(draft.id, payload);
      else await window.tools.analogCreateShow(payload);
      setDraft(EMPTY_SHOW);
      setView('list');
      await load();
      setMessage(view === 'edit' ? 'Programa actualizado.' : 'Programa creado.');
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (show: AnalogShow) => {
    if (!confirm(`¿Eliminar el programa "${show.name}"?`)) return;
    setBusy(true);
    try {
      await window.tools.analogDeleteShow(show.id);
      await load();
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const importFile = async () => {
    setBusy(true);
    setMessage('');
    try {
      const filePath = await window.tools.analogSelectJson();
      if (!filePath) return;
      const imported = await window.tools.analogImportShows(filePath);
      setView('list');
      await load();
      setMessage(`Se importaron ${imported.length} programas.`);
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {message && <p className="analog-message">{message}</p>}
      {view === 'list' && (
        <>
          <div className="analog-toolbar">
            <button
              className="analog-primary"
              onClick={() => {
                setDraft(EMPTY_SHOW);
                setView('create');
              }}
            >
              + Crear Programa
            </button>
            <button onClick={() => setView('import')}>Importar Programa</button>
            <span>
              {channelFilter ? `${sortedShows.length} de ${shows.length}` : shows.length} programas
            </span>
          </div>
          <div className="analog-filter-bar">
            <label>
              <span>Ordenar por</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as ShowSort)}
              >
                <option value="channel-name">Canal + Nombre</option>
                <option value="name">Nombre</option>
                <option value="year">Año</option>
              </select>
            </label>
            <label>
              <span>Filtrar por canal</span>
              <select
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value)}
              >
                <option value="">Todos los canales</option>
                {channels.map((channel) => (
                  <option key={channelKey(channel)} value={channelKey(channel)}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            {channelFilter && (
              <button type="button" onClick={() => setChannelFilter('')}>
                Quitar filtro
              </button>
            )}
          </div>
          <div className="analog-list">
            {sortedShows.map((show) => (
              <article key={show.uuid || show.id}>
                <div>
                  <h3>
                    {show.name}
                    {show.airUntilToDate && <em className="analog-badge">Hasta la fecha</em>}
                  </h3>
                  {!!show.channel.length && (
                    <p>
                      <b>Canales: </b>
                      {show.channel.map(channelLabel).join(', ')}
                    </p>
                  )}
                  {!!(show.airYears || []).length && (
                    <p>
                      <b>Transmisión: </b>
                      {(show.airYears || []).join(', ')}
                    </p>
                  )}
                  <p>
                    <b>Temporadas: </b>
                    {show.seasons
                      .map(
                        (season) =>
                          `T${season.season} (${season.year}, ${season.episodes.length} ep.)`,
                      )
                      .join(' · ') || '—'}
                  </p>
                </div>
                <footer>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setDraft({
                        ...show,
                        airYears: show.airYears || [],
                        seasons: show.seasons.map((season) => ({
                          ...season,
                          contentPaths: season.contentPaths || [],
                        })),
                      });
                      setView('edit');
                    }}
                  >
                    Editar
                  </button>
                  <button disabled={busy} onClick={() => void remove(show)}>
                    Eliminar
                  </button>
                </footer>
              </article>
            ))}
            {!shows.length && <p className="analog-message">No hay programas configurados.</p>}
            {shows.length > 0 && !sortedShows.length && (
              <p className="analog-message">No hay programas que coincidan con el filtro.</p>
            )}
          </div>
        </>
      )}
      {(view === 'create' || view === 'edit') && (
        <div className="analog-panel">
          <h3>{view === 'edit' ? 'Editar programa' : 'Nuevo programa'}</h3>
          <div className="analog-form-grid">
            <label>
              <span>Nombre *</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <div className="analog-field">
              <span>Canales</span>
              <div className="analog-inline">
                <input
                  list="analog-channel-options"
                  placeholder="Ej: Nickelodeon"
                  value={channelInput}
                  onChange={(event) => setChannelInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addChannelTag();
                    }
                  }}
                />
                <datalist id="analog-channel-options">
                  {channels.map((channel) => (
                    <option key={String(channel.uuid || channel.id)} value={channel.name} />
                  ))}
                </datalist>
                <button type="button" onClick={addChannelTag}>
                  Agregar
                </button>
              </div>
              {!!draft.channel.length && (
                <div className="analog-tags">
                  {draft.channel.map((entry) => (
                    <span key={entry}>
                      {channelLabel(entry)}
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            channel: draft.channel.filter((item) => item !== entry),
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="analog-field wide">
              <span>Años de transmisión</span>
              <div className="analog-inline">
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  placeholder="Ej: 1999"
                  value={airYearInput}
                  onChange={(event) => setAirYearInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addAirYear();
                    }
                  }}
                />
                <button type="button" onClick={addAirYear}>
                  Agregar Año
                </button>
              </div>
              <label className="analog-check">
                <input
                  type="checkbox"
                  checked={!!draft.airUntilToDate}
                  onChange={(event) => setDraft({ ...draft, airUntilToDate: event.target.checked })}
                />
                <span>Hasta la fecha (siempre en programación)</span>
              </label>
              {!!(draft.airYears || []).length && (
                <div className="analog-tags">
                  {(draft.airYears || []).map((year) => (
                    <span key={year}>
                      {year}
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            airYears: (draft.airYears || []).filter((item) => item !== year),
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="analog-field">
              <span>Repetición de episodios</span>
              <div className="analog-inline">
                <button
                  type="button"
                  className={draft.episodeAiringMode !== 'once-per-day' ? 'active' : ''}
                  onClick={() => setDraft({ ...draft, episodeAiringMode: 'daily-repeat' })}
                >
                  Un episodio por día
                </button>
                <button
                  type="button"
                  className={draft.episodeAiringMode === 'once-per-day' ? 'active' : ''}
                  onClick={() => setDraft({ ...draft, episodeAiringMode: 'once-per-day' })}
                >
                  Solo una vez al día
                </button>
              </div>
            </div>
          </div>
          {draft.seasons.map((season, seasonIndex) => (
            <div key={seasonIndex} className="analog-season">
              <h4>Temporada {season.season}</h4>
              <div className="analog-form-grid">
                <label>
                  <span>Año</span>
                  <input
                    type="number"
                    min="1900"
                    max="2100"
                    value={season.year}
                    onChange={(event) =>
                      updateSeason(seasonIndex, { year: Number(event.target.value) || season.year })
                    }
                  />
                </label>
                <div className="analog-field">
                  <span>Carpeta de contenido</span>
                  <div className="analog-inline">
                    <input
                      value={season.contentPath || ''}
                      readOnly
                      placeholder="Selecciona la carpeta..."
                    />
                    <button type="button" onClick={() => void pickFolder(seasonIndex)}>
                      Seleccionar Carpeta
                    </button>
                  </div>
                </div>
              </div>
              <div className="analog-field"><br/>
                <span>Carpetas adicionales</span>
                {(season.contentPaths || []).map((extra, pathIndex) => (
                  <div key={pathIndex} className="analog-path">
                    <span title={extra}>{extra}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateSeason(seasonIndex, {
                          contentPaths: (season.contentPaths || []).filter(
                            (_, position) => position !== pathIndex,
                          ),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => void addContentPath(seasonIndex)}>
                  + Agregar Carpeta
                </button>
              </div>
              <br/>
              <div className="analog-episodes">
                <div className="analog-episodes-head">
                  <span>#</span>
                  <span>Título</span>
                  <span>Duración</span>
                </div>
                {season.episodes.map((episode, episodeIndex) => (
                  <div key={episodeIndex} className="analog-episodes-row">
                    <input
                      type="number"
                      min="1"
                      value={episode.episode}
                      onChange={(event) =>
                        updateEpisode(seasonIndex, episodeIndex, {
                          episode: Number(event.target.value) || episode.episode,
                        })
                      }
                    />
                    <input
                      value={episode.title}
                      placeholder="Título del episodio"
                      onChange={(event) =>
                        updateEpisode(seasonIndex, episodeIndex, { title: event.target.value })
                      }
                    />
                    <input
                      value={episode.duration}
                      placeholder="00:00"
                      onChange={(event) =>
                        updateEpisode(seasonIndex, episodeIndex, { duration: event.target.value })
                      }
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateSeason(seasonIndex, {
                      episodes: [
                        ...season.episodes,
                        {
                          episode: season.episodes.length + 1,
                          title: '',
                          duration: '00:00',
                        },
                      ],
                    })
                  }
                >
                  Agregar Episodio
                </button>
              </div>
            </div>
          ))}
          <div className="analog-actions">
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  seasons: [
                    ...draft.seasons,
                    {
                      season: draft.seasons.length + 1,
                      year: new Date().getFullYear(),
                      episodes: [{ episode: 1, title: '', duration: '00:00' }],
                      contentPath: '',
                      contentPaths: [],
                    },
                  ],
                })
              }
            >
              Agregar Temporada
            </button>
          </div>
          <div className="analog-actions">
            <button
              onClick={() => {
                setDraft(EMPTY_SHOW);
                setView('list');
              }}
            >
              Cancelar
            </button>
            <button className="analog-primary" disabled={busy} onClick={() => void save()}>
              {view === 'edit' ? 'Actualizar Programa' : 'Crear Programa'}
            </button>
          </div>
        </div>
      )}
      {view === 'import' && (
        <div className="analog-panel">
          <h3>Importar programa</h3>
          <p>Selecciona un archivo JSON con la configuración del programa para importar.</p>
          <div className="analog-actions">
            <button onClick={() => setView('list')}>Cancelar</button>
            <button className="analog-primary" disabled={busy} onClick={() => void importFile()}>
              Seleccionar Archivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleScreen({ refreshCounts }: { refreshCounts: () => void }) {
  const [status, setStatus] = useState<AnalogScheduleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const next = await window.tools.analogScheduleStatus();
      setStatus(next);
      refreshCounts();
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setLoading(false);
    }
  }, [refreshCounts]);
  useEffect(() => {
    let cancelled = false;
    window.tools
      .analogScheduleStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setMessage('');
        setLoading(false);
        void refreshCounts();
      })
      .catch((failure) => {
        if (cancelled) return;
        setMessage(String(failure));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshCounts]);

  const reset = async () => {
    if (
      !confirm(
        '¿Resetear la programación?\n\nSe borrará toda la programación generada y deberás elegir un año nuevamente.',
      )
    )
      return;
    setResetting(true);
    setMessage('');
    try {
      const result = await window.tools.analogScheduleReset();
      if (!result.success) throw new Error(result.error || 'Error desconocido.');
      await reload();
      setMessage('Programación reseteada correctamente.');
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setResetting(false);
    }
  };
  const generate = async (year: number) => {
    setGenerating(true);
    setMessage('');
    try {
      const result = await window.tools.analogScheduleGenerate(year);
      if (!result.success) throw new Error(result.error || 'Error desconocido.');
      setShowSetup(false);
      await reload();
      setMessage(`Programación generada para el año ${year}.`);
    } catch (failure) {
      setMessage(String(failure));
    } finally {
      setGenerating(false);
    }
  };

  const isReady = status?.status === 'ready' && status.config?.primaryYear;
  if (loading) return <p className="analog-message">Consultando el estado de la programación...</p>;
  return (
    <div>
      {message && <p className="analog-message">{message}</p>}
      <div className="analog-panel">
        <h3>Estado</h3>
        <span className={`analog-status ${isReady ? 'ok' : 'warn'}`}>
          {isReady ? 'Programación activa' : 'Sin programación'}
        </span>
        {(isReady || status?.config?.primaryYear) && status?.config && (
          <ul className="analog-summary">
            <li>
              <b>Año principal</b>
              <span>{status.config.primaryYear}</span>
            </li>
            <li>
              <b>Meses generados</b>
              <span>{status.config.generatedMonths.length}</span>
            </li>
            {status.config.lastGenerated && (
              <li>
                <b>Última generación</b>
                <span>{formatDateTime(status.config.lastGenerated)}</span>
              </li>
            )}
          </ul>
        )}
        {!isReady && !status?.config?.primaryYear && (
          <p>Genera una programación eligiendo el año de transmisión.</p>
        )}
      </div>
      <div className="analog-panel">
        <h3>Generar programación</h3>
        <p>
          Elige el año principal y el sistema asignará los programas a los canales y distribuirá los
          horarios durante todo el año.
        </p>
        {!showSetup ? (
          <div className="analog-actions">
            <button className="analog-primary" onClick={() => setShowSetup(true)}>
              {isReady ? 'Regenerar Programación' : 'Generar Programación'}
            </button>
          </div>
        ) : (
          <YearPicker
            generating={generating}
            onCancel={() => setShowSetup(false)}
            onGenerate={(year) => void generate(year)}
          />
        )}
      </div>
      <DaySchedule key={status?.config?.lastGenerated || 'none'} />
      <div className="analog-panel analog-danger">
        <h3>Zona de riesgo</h3>
        <p>
          Resetear la programación borra toda la programación generada. Deberás elegir un año
          nuevamente para volver a generarla.
        </p>
        <div className="analog-actions">
          <button disabled={resetting} onClick={() => void reset()}>
            {resetting ? 'Resetando...' : 'Resetear Programación'}
          </button>
        </div>
      </div>
    </div>
  );
}

function YearPicker({
  generating,
  onCancel,
  onGenerate,
}: {
  generating: boolean;
  onCancel: () => void;
  onGenerate: (year: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [decade, setDecade] = useState<number | null>(null);
  const [year, setYear] = useState(currentYear);
  const decades: number[] = [];
  for (let value = 1950; value <= Math.floor(currentYear / 10) * 10; value += 10)
    decades.push(value);
  const yearsOfDecade =
    decade == null
      ? []
      : Array.from(
          { length: Math.min(decade + 9, currentYear) - decade + 1 },
          (_, index) => decade + index,
        ).reverse();
  return (
    <div className="analog-years">
      {decade == null ? (
        <>
          <h4>Paso 1: Selecciona la década</h4>
          <div className="analog-year-grid">
            {decades.map((value) => (
              <button
                key={value}
                disabled={generating}
                onClick={() => {
                  setDecade(value);
                  setYear(Math.min(value + 9, currentYear));
                }}
              >
                <strong>{value}s</strong>
                <small>
                  {value}-{Math.min(value + 9, currentYear)}
                </small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="analog-inline">
            <button disabled={generating} onClick={() => setDecade(null)}>
              ← Volver a Décadas
            </button>
            <h4>Paso 2: Selecciona el año ({decade}s)</h4>
          </div>
          <div className="analog-year-grid">
            {yearsOfDecade.map((value) => (
              <button
                key={value}
                disabled={generating}
                className={value === year ? 'active' : ''}
                onClick={() => setYear(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="analog-actions">
            <button disabled={generating} onClick={onCancel}>
              Cancelar
            </button>
            <button
              className="analog-primary"
              disabled={generating}
              onClick={() => onGenerate(year)}
            >
              {generating ? 'Generando...' : `Generar Programación ${year}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const SLOT_MINUTES = 30;
const SLOTS_PER_DAY = 1440 / SLOT_MINUTES;
function DaySchedule() {
  const [date, setDate] = useState<Date | null>(null);
  const [primaryYear, setPrimaryYear] = useState(new Date().getFullYear());
  const [channels, setChannels] = useState<AnalogChannel[]>([]);
  const [entries, setEntries] = useState<AnalogScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const config: AnalogScheduleConfig | null = await window.tools.analogScheduleConfig();
        const resolved =
          config && config.primaryYear > 0 ? config.primaryYear : new Date().getFullYear();
        setPrimaryYear(resolved);
        const now = new Date();
        setDate(new Date(resolved, now.getMonth(), now.getDate()));
      } catch (failure) {
        setError(String(failure));
      }
    })();
  }, []);
  useEffect(() => {
    if (!date) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [channelsConfig, month]: [AnalogChannel[], AnalogMonthSchedule | null] =
          await Promise.all([
            window.tools.analogListChannels(),
            window.tools.analogScheduleMonth(date.getFullYear(), date.getMonth() + 1),
          ]);
        setChannels(channelsConfig);
        setEntries(Array.isArray(month?.entries) ? month.entries : []);
      } catch (failure) {
        setError(String(failure));
      } finally {
        setLoading(false);
      }
    })();
  }, [date]);

  const dayStart = date
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime()
    : 0;
  const dayEnd = dayStart + 86400000;
  const rows = useMemo(() => {
    if (!date) return [];
    const enabled = [...channels]
      .filter((channel) => channel.isEnabled !== false)
      .sort((a, b) => a.number - b.number);
    const list = enabled
      .map((channel) => ({
        id: channel.uuid || String(channel.id),
        number: channel.number,
        name: channel.name,
        entries: entries
          .filter(
            (entry) =>
              matchesAnalogChannel(entry.channelId, channel) &&
              new Date(entry.startTime).getTime() < dayEnd &&
              new Date(entry.endTime).getTime() > dayStart,
          )
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
      }))
      .filter((row) => row.entries.length > 0);
    return list;
  }, [channels, entries, date, dayStart, dayEnd]);

  const entryForSlot = (channelEntries: AnalogScheduleEntry[], slotIndex: number) => {
    const slotStart = dayStart + slotIndex * SLOT_MINUTES * 60000;
    const slotEnd = slotStart + SLOT_MINUTES * 60000;
    return (
      channelEntries.find((entry) => {
        const start = new Date(entry.startTime).getTime();
        const end = new Date(entry.endTime).getTime();
        return start < slotEnd && end > slotStart;
      }) || null
    );
  };
  const goToDate = (nextYear: number, month: number, day: number) =>
    setDate(new Date(nextYear, month - 1, day));

  return (
    <div className="analog-panel">
      <h3>Programación del día</h3>
      <p>
        Muestra, por canal, lo que se transmite hoy cruzando la hora del dispositivo con la
        programación generada.
      </p>
      <div className="analog-day-controls">
        <button
          disabled={!date}
          onClick={() =>
            date && goToDate(date.getFullYear(), date.getMonth() + 1, date.getDate() - 1)
          }
        >
          ← Día anterior
        </button>
        <label>
          Año
          <select
            value={date ? date.getFullYear() : ''}
            onChange={(event) =>
              date && goToDate(Number(event.target.value), date.getMonth() + 1, date.getDate())
            }
          >
            {Array.from(
              { length: new Date().getFullYear() - 1950 + 1 },
              (_, index) => 1950 + index,
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mes
          <select
            value={date ? date.getMonth() + 1 : ''}
            onChange={(event) =>
              date && goToDate(date.getFullYear(), Number(event.target.value), date.getDate())
            }
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {String(value).padStart(2, '0')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Día
          <select
            value={date ? date.getDate() : ''}
            onChange={(event) =>
              date && goToDate(date.getFullYear(), date.getMonth() + 1, Number(event.target.value))
            }
          >
            {date &&
              Array.from(
                { length: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() },
                (_, index) => index + 1,
              ).map((value) => (
                <option key={value} value={value}>
                  {String(value).padStart(2, '0')}
                </option>
              ))}
          </select>
        </label>
        <button
          className="analog-primary"
          onClick={() => {
            const now = new Date();
            goToDate(primaryYear, now.getMonth() + 1, now.getDate());
          }}
        >
          Hoy
        </button>
        <button
          disabled={!date}
          onClick={() =>
            date && goToDate(date.getFullYear(), date.getMonth() + 1, date.getDate() + 1)
          }
        >
          Día siguiente →
        </button>
      </div>
      {date && (
        <p className="analog-day-title">
          {date.toLocaleDateString('es', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      )}
      {loading && <p className="analog-message">Cargando programación del día...</p>}
      {error && !loading && <p className="analog-message analog-error">{error}</p>}
      {!loading && !error && !rows.length && (
        <p>
          No hay programación generada para este día. Verifica que exista una programación activa.
        </p>
      )}
      {!loading && !error && !!rows.length && (
        <div className="analog-day-wrap">
          <div
            className="analog-day-grid"
            style={{ gridTemplateColumns: `150px repeat(${SLOTS_PER_DAY}, 110px)` }}
          >
            <div className="analog-day-head">CANAL</div>
            {Array.from({ length: SLOTS_PER_DAY }, (_, index) => (
              <div key={index} className="analog-day-head">
                {formatSlotLabel(index * SLOT_MINUTES)}
              </div>
            ))}
            {rows.map((row) => (
              <DayRow key={row.id} row={row} entryForSlot={entryForSlot} />
            ))}
          </div>
        </div>
      )}
      <div className="analog-legend">
        <span>
          <i className="show" /> Show real
        </span>
        <span>
          <i className="filler" /> Relleno (AnalogReplayTV)
        </span>
        <span>
          <i className="empty" /> Sin programación
        </span>
      </div>
    </div>
  );
}

function DayRow({
  row,
  entryForSlot,
}: {
  row: { id: string; number: number; name: string; entries: AnalogScheduleEntry[] };
  entryForSlot: (entries: AnalogScheduleEntry[], slotIndex: number) => AnalogScheduleEntry | null;
}) {
  return (
    <>
      <div className="analog-day-channel">
        <b>{row.number}</b>
        <span>{row.name}</span>
      </div>
      {Array.from({ length: SLOTS_PER_DAY }, (_, slotIndex) => {
        const entry = entryForSlot(row.entries, slotIndex);
        const isFiller = entry?.type === 'filler' || entry?.showId === 'analog-replay-tv-filler';
        return (
          <div
            key={slotIndex}
            className={`analog-day-slot ${isFiller ? 'filler' : entry ? 'show' : 'empty'}`}
            title={
              entry
                ? `${entry.showName} · T${entry.season}E${entry.episode} · ${formatSlotTime(entry.startTime)} – ${formatSlotTime(entry.endTime)}`
                : 'Sin programación'
            }
          >
            {entry ? (isFiller ? 'AnalogReplayTV' : entry.showName) : '---'}
          </div>
        );
      })}
    </>
  );
}

function matchesAnalogChannel(entryChannelId: string, channel: AnalogChannel) {
  return (
    entryChannelId === channel.uuid ||
    entryChannelId === String(channel.id) ||
    entryChannelId.toLowerCase() === String(channel.name).toLowerCase()
  );
}

function episodeFileNames(episode: { fileName?: string; fileNames?: string[] }) {
  const names: string[] = [];
  if (episode.fileNames && episode.fileNames.length > 0) names.push(...episode.fileNames);
  if (episode.fileName && !names.includes(episode.fileName)) names.push(episode.fileName);
  return names;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSlotLabel(minuteOfDay: number) {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatSlotTime(value: string) {
  return new Date(value).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}
