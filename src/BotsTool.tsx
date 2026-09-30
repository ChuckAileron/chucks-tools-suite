import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AmazonPrice,
  BotRecipe,
  BotSession,
  BotState,
  DownloadLink,
  SteamDeal,
} from './types';

const TABS = [
  { id: 'steam', title: 'Steam', subtitle: 'ofertas de juegos' },
  { id: 'amazon', title: 'Amazon', subtitle: 'precios a demanda' },
  { id: 'links', title: 'Enlaces', subtitle: 'descargas por pasos' },
  { id: 'sessions', title: 'Sesiones', subtitle: 'autenticación en portales' },
] as const;

type Hop = {
  enabled: boolean;
  url: string;
  clickSelector: string;
  clickText: string;
  typeSelector: string;
  typeText: string;
  submitSelector: string;
  submitText: string;
  waitMs: string;
  holdMs: string;
};

const EMPTY_HOP: Hop = {
  enabled:        true,
  url:            '',
  clickSelector:  '',
  clickText:      '',
  typeSelector:   '',
  typeText:       '',
  submitSelector: '',
  submitText:     '',
  waitMs:         '0',
  holdMs:         '0',
};

const EMPTY_SESSION = {
  portal:          '',
  url:             '',
  username:        '',
  password:        '',
  userField:       '#username',
  passField:       '#password',
  submitSelector:  'button[type="submit"]',
  successSelector: '',
};

function formatDate(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function RobotsIcon({ size = 22 }: { size?: number }) {
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
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3" r="1" />
      <path d="M8 13h.01M16 13h.01" />
      <path d="M8 17h8" />
    </svg>
  );
}

export default function BotsTool() {
  const [state, setState]     = useState<BotState | null>(null);
  const [recipes, setRecipes] = useState<BotRecipe[]>([]);
  const [tab, setTab]         = useState<string>('steam');

  const [deals, setDeals]       = useState<SteamDeal[]>([]);
  const [prices, setPrices]     = useState<AmazonPrice[]>([]);
  const [links, setLinks]       = useState<DownloadLink[]>([]);
  const [sessions, setSessions] = useState<BotSession[]>([]);

  const [steamQuery, setSteamQuery]               = useState('');
  const [steamSpecials, setSteamSpecials]         = useState(true);
  const [steamTopsellers, setSteamTopsellers]     = useState(false);
  const [steamLimit, setSteamLimit]               = useState<string>('50');
  const [steamRefresh, setSteamRefresh]           = useState(false);
  const [steamFilter, setSteamFilter]             = useState('');
  const [steamMinDiscount, setSteamMinDiscount]   = useState<string>('0');
  const [steamSort, setSteamSort]                 = useState<'discount' | 'price' | 'original' | 'title'>('discount');
  const [steamDir, setSteamDir]                   = useState<'-1' | '1'>('-1');
  const [amazonUrls, setAmazonUrls]               = useState('');
  const [amazonRefresh, setAmazonRefresh]         = useState(false);
  const [linksName, setLinksName]                 = useState('');
  const [linksSource, setLinksSource]             = useState('');
  const [linksDownloadOnly, setLinksDownloadOnly] = useState(true);
  const [hops, setHops]                           = useState<Hop[]>([{ ...EMPTY_HOP }]);

  const [sessionForm, setSessionForm]             = useState({ ...EMPTY_SESSION });
  const [sessionNotice, setSessionNotice]         = useState('');
  const [sessionRunMsg, setSessionRunMsg]         = useState('');
  const [sessionRunId, setSessionRunId]           = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const [cacheHint, setCacheHint] = useState<string | null>(null);
  const [message, setMessage]     = useState('');
  const logRef                    = useRef<HTMLDivElement>(null);

  const running = state?.running ?? false;
  const recipe  = recipes.find((item) => item.id === tab);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [state?.log]);

  useEffect(() => {
    window.tools
      .getBotsState()
      .then(setState)
      .catch(() => setState(null));
    const stopState = window.tools.onBotsState(setState);
    window.tools.botsRecipes().then(setRecipes).catch(() => {});
    let alive = true;
    window.tools
      .botsData('steam')
      .then((data) => void (alive && setDeals(data as SteamDeal[])))
      .catch(() => {});
    window.tools
      .botsData('amazon')
      .then((data) => void (alive && setPrices(data as AmazonPrice[])))
      .catch(() => {});
    window.tools
      .botsData('links')
      .then((data) => void (alive && setLinks(data as DownloadLink[])))
      .catch(() => {});
    window.tools
      .botsSessions()
      .then((data) => void (alive && setSessions(data)))
      .catch(() => {});
    return () => {
      stopState();
      alive = false;
    };
  }, []);

  const refreshSteam = async () => {
    const data = await window.tools.botsData('steam');
    setDeals(data as SteamDeal[]);
  };
  const refreshPrices = async () => {
    const data = await window.tools.botsData('amazon');
    setPrices(data as AmazonPrice[]);
  };
  const refreshLinks = async () => {
    const data = await window.tools.botsData('links');
    setLinks(data as DownloadLink[]);
  };
  const refreshSessions = async () => {
    const list = await window.tools.botsSessions();
    setSessions(list);
    setSelectedSessionId((current) =>
      current != null && list.some((item) => item.id === current)
        ? current
        : (list[0]?.id ?? null),
    );
  };

  const steamUrlForRun = () => {
    const params = new URLSearchParams();
    if (steamSpecials) params.set('specials', '1');
    if (steamTopsellers) params.set('filter', 'topsellers');
    if (steamQuery.trim()) params.set('q', steamQuery.trim());
    const query = params.toString();
    return 'https://store.steampowered.com/search/' + (query ? `?${query}` : '');
  };

  const steamDiscountOf = (deal: SteamDeal) =>
    Number((deal.discount || '').replace(/[^\d]/g, '')) || 0;

  const visibleDeals = useMemo(() => {
    const term        = steamFilter.trim().toLowerCase();
    const minDiscount = Number(steamMinDiscount) || 0;
    const filtered    = deals.filter((deal) => {
      const matchesTerm =
        !term ||
        deal.title.toLowerCase().includes(term) ||
        (deal.tag || '').toLowerCase().includes(term);
      return matchesTerm && steamDiscountOf(deal) >= minDiscount;
    });
    const factor  = steamDir === '-1' ? -1 : 1;
    const labelOf = (deal: SteamDeal) => (deal.title || '').toLowerCase();
    return filtered.sort((a, b) => {
      if (steamSort === 'price') {
        return (
          factor *
          ((a.priceFinal ?? Number.POSITIVE_INFINITY) - (b.priceFinal ?? Number.POSITIVE_INFINITY))
        );
      }
      if (steamSort === 'original') {
        return (
          factor *
          ((a.priceInitial ?? Number.POSITIVE_INFINITY) - (b.priceInitial ?? Number.POSITIVE_INFINITY))
        );
      }
      if (steamSort === 'title') {
        const order = labelOf(a).localeCompare(labelOf(b));
        return factor * order;
      }
      return factor * (steamDiscountOf(a) - steamDiscountOf(b));
    });
  }, [deals, steamFilter, steamMinDiscount, steamSort, steamDir]);

  const runSteam = async () => {
    if (running) return;
    setMessage('');
    setCacheHint(null);
    try {
      const result = await window.tools.botsRun('steam', {
        url:     steamUrlForRun(),
        refresh: steamRefresh,
        limit:   Number(steamLimit) || 50,
      });
      setCacheHint(result.fromCache ? 'Se mostró la copia guardada (menos de 24 h).' : null);
      await refreshSteam();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const runAmazon = async () => {
    if (running) return;
    setMessage('');
    setCacheHint(null);
    const urls = amazonUrls
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (!urls.length) {
      setMessage('Agrega al menos un enlace de Amazon.');
      return;
    }
    try {
      const result = await window.tools.botsRun('amazon', { urls, refresh: amazonRefresh });
      setCacheHint(result.fromCache ? 'Todos los precios estaban frescos; se usó la copia local.' : null);
      await refreshPrices();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const activeHopList = () => hops.filter((hop) => hop.enabled && hop.url.trim().length > 0);

  const runLinks = async () => {
    if (running) return;
    setMessage('');
    setCacheHint(null);
    const flow = activeHopList();
    if (!flow.length) {
      setMessage('Configura al menos un paso con URL de inicio.');
      return;
    }
    try {
      await window.tools.botsRun('links', {
        hops:      flow,
        pattern:   linksDownloadOnly ? undefined : '',
        title:     linksName,
        sourceUrl: linksSource,
        refresh:   false,
      });
      await refreshLinks();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const setHop    = (index: number, key: keyof Hop, value: string | boolean) => {
    setHops((current) => current.map((hop, at) => (at === index ? { ...hop, [key]: value } : hop)));
  };
  const addHop    = () => {
    setHops((current) => [...current, { ...EMPTY_HOP }]);
  };
  const removeHop = (index: number) => {
    setHops((current) =>
      current.length === 1 ? [{ ...EMPTY_HOP }] : current.filter((_, at) => at !== index),
    );
  };

  const saveSession = async () => {
    setMessage('');
    setSessionNotice('');
    try {
      await window.tools.botsSessionSave(sessionForm);
      setSessionForm({ ...EMPTY_SESSION });
      setSessionNotice('Sesión guardada; la contraseña queda almacenada localmente.');
      await refreshSessions();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const deleteSession = async (id: number) => {
    await window.tools.botsSessionDelete(id);
    setSessionNotice('');
    await refreshSessions();
  };

  const runSession = async (id: number) => {
    if (running) return;
    setMessage('');
    setSessionRunMsg('');
    setSessionRunId(id);
    try {
      const result = await window.tools.botsSessionRun(id);
      setSessionRunMsg(
        result.authed.ok
          ? 'La sesión quedó autenticada y se conservan sus cookies.'
          : 'La página cargó, pero no se pudo confirmar el acceso.',
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSessionRunId(null);
    }
  };

  const cancel = () => {
    window.tools
      .botsCancel()
      .then(() => setMessage('Bot cancelado por el usuario.'))
      .catch(() => {});
  };

  const stepPercent  = state && state.stepTotal > 0 ? (state.stepIndex * 100) / state.stepTotal : 0;
  const canRunFooter =
    tab === 'steam'
      ? true
      : tab === 'amazon'
        ? amazonUrls.trim().length > 0
        : tab === 'links'
          ? activeHopList().length > 0
          : false;

  return (
    <section className="tool bots-tool">
      <header>
        <span>
          <RobotsIcon />
        </span>
        <div>
          <h1>Bots de navegación</h1>
          <p>Automatiza tareas web con sesiones ocultas y guarda los resultados localmente.</p>
        </div>
        <b>● Chromium oculto</b>
      </header>
      <div className="bots-tabs">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => {
              setTab(item.id);
              setMessage('');
              setCacheHint(null);
              setSessionRunMsg('');
            }}
          >
            <strong>{item.title}</strong>
            <small>{item.subtitle}</small>
          </button>
        ))}
      </div>
      <div className="workspace">
        {tab === 'steam' && (
          <>
            <div className="step">
              <span>1</span>
              <div>
                <h2>Búsqueda de ofertas</h2>
                <p>
                  Consulta la tienda en segundo plano (por término, ofertas o más vendidos) y trae
                  hasta 150 resultados con precio actual, descuento y etiquetas.
                </p>
              </div>
            </div>
            <div className="bots-config">
              <input
                type="text"
                placeholder="Buscar por nombre del juego…"
                value={steamQuery}
                onChange={(event) => setSteamQuery(event.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={steamSpecials}
                  onChange={(event) => setSteamSpecials(event.target.checked)}
                />
                Solo ofertas
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={steamTopsellers}
                  onChange={(event) => setSteamTopsellers(event.target.checked)}
                />
                Más vendidos
              </label>
              <select
                value={steamLimit}
                onChange={(event) => setSteamLimit(event.target.value)}
                title="Cantidad máxima de resultados"
              >
                <option value="25">25 resultados</option>
                <option value="50">50 resultados</option>
                <option value="100">100 resultados</option>
                <option value="150">150 resultados</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={steamRefresh}
                  onChange={(event) => setSteamRefresh(event.target.checked)}
                />
                Ignorar caché y volver a consultar
              </label>
            </div>
            {deals.length ? (
              <div className="results bots-results">
                <div>
                  <label>
                    {visibleDeals.length} de {deals.length} oferta
                    {deals.length === 1 ? '' : 's'} guardada
                    {deals.length === 1 ? '' : 's'}
                  </label>
                  <span>Vigencia: 24 h desde su consulta.</span>
                </div>
                <div className="bots-filterbar">
                  <input
                    type="text"
                    placeholder="Filtrar por título o etiqueta…"
                    value={steamFilter}
                    onChange={(event) => setSteamFilter(event.target.value)}
                  />
                  <select
                    value={steamMinDiscount}
                    onChange={(event) => setSteamMinDiscount(event.target.value)}
                    title="Descuento mínimo"
                  >
                    <option value="0">Cualquier descuento</option>
                    <option value="25">25 % o más</option>
                    <option value="50">50 % o más</option>
                    <option value="75">75 % o más</option>
                    <option value="90">90 % o más</option>
                  </select>
                  <select
                    value={steamSort}
                    onChange={(event) => setSteamSort(event.target.value as typeof steamSort)}
                    title="Ordenar por"
                  >
                    <option value="discount">Descuento</option>
                    <option value="price">Precio actual</option>
                    <option value="original">Precio original</option>
                    <option value="title">Nombre</option>
                  </select>
                  <button
                    type="button"
                    className="bots-dir"
                    title={steamDir === '-1' ? 'Descendente' : 'Ascendente'}
                    onClick={() => setSteamDir((current) => (current === '-1' ? '1' : '-1'))}
                  >
                    {steamDir === '-1' ? '↓' : '↑'}
                  </button>
                </div>
                <div className="bots-table table-steam">
                  <section>
                    <label>
                      <span>
                        <strong>Juego</strong>
                      </span>
                      <b>Dcto.</b>
                      <b>Precio actual</b>
                      <b>Antes</b>
                      <b>Guardado</b>
                    </label>
                    {visibleDeals.map((deal) => (
                      <button
                        type="button"
                        key={deal.id}
                        disabled={!deal.url}
                        onClick={() => {
                          if (deal.url) window.tools.openUrl(deal.url);
                        }}
                      >
                        <span>
                          <strong>{deal.title}</strong>
                          {deal.tag ? <small>{deal.tag}</small> : null}
                        </span>
                        <b>{deal.discount}</b>
                        <b className="bots-price-now">{deal.price}</b>
                        <b className="bots-price-original">{deal.original}</b>
                        <b>{formatDate(deal.fetched)}</b>
                      </button>
                    ))}
                  </section>
                </div>
              </div>
            ) : (
              <div className="video-empty">
                Todavía no hay ofertas guardadas. Ejecuta el bot para consultar la tienda.
              </div>
            )}
          </>
        )}
        {tab === 'amazon' && (
          <>
            <div className="step">
              <span>1</span>
              <div>
                <h2>Precios de Amazon</h2>
                <p>
                  Cada producto se consulta a pedido y se guarda con vigencia de 24 h. Si un precio
                  ya es fresco, se reutiliza sin volver a navegar.
                </p>
              </div>
            </div>
            <div className="bots-config">
              <textarea
                className="bots-urls"
                placeholder={'Un enlace de producto por línea (hasta 50).'}
                value={amazonUrls}
                onChange={(event) => setAmazonUrls(event.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={amazonRefresh}
                  onChange={(event) => setAmazonRefresh(event.target.checked)}
                />
                Re-consultar todos (ignorar precios frescos)
              </label>
            </div>
            {prices.length ? (
              <div className="results bots-results">
                <div>
                  <label>
                    {prices.length} precio{prices.length === 1 ? '' : 's'} guardado
                    {prices.length === 1 ? '' : 's'}
                  </label>
                  <span>Los precios estancados se vuelven a consultar al expirar.</span>
                </div>
                <div className="bots-table table-prices">
                  <section>
                    <label>
                      <span>
                        <strong>Producto</strong>
                      </span>
                      <b>Precio</b>
                      <b>Guardado</b>
                    </label>
                    {prices.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          window.tools.openUrl(item.url);
                        }}
                      >
                        <span>
                          {item.image ? <img src={item.image} alt="" /> : null}
                          <strong>{item.title || item.url}</strong>
                        </span>
                        <b className="bots-price-now">
                          {item.price != null ? `${item.currency ?? ''} ${item.price}` : '—'}
                        </b>
                        <b>{formatDate(item.fetched)}</b>
                      </button>
                    ))}
                  </section>
                </div>
              </div>
            ) : (
              <div className="video-empty">
                Todavía no hay precios guardados. Agrega productos y ejecuta el bot.
              </div>
            )}
          </>
        )}
        {tab === 'links' && (
          <>
            <div className="step">
              <span>1</span>
              <div>
                <h2>Flujo de pasos</h2>
                <p>
                  El motor universal navega, hace clic, rellena formularios y recoge los enlaces
                  de descarga de la última página visitada.
                </p>
              </div>
            </div>
            {hops.map((hop, index) => (
              <div className="bots-hop" key={index}>
                <label className="bots-hop-head">
                  <strong>Paso {index + 1}</strong>
                  <span>
                    <input
                      type="checkbox"
                      checked={hop.enabled}
                      onChange={(event) => setHop(index, 'enabled', event.target.checked)}
                    />
                    Usar este paso
                  </span>
                  <button type="button" onClick={() => removeHop(index)}>
                    Quitar
                  </button>
                </label>
                <div className="bots-hop-fields">
                  <input
                    type="text"
                    placeholder="URL del sitio (ej. https://ejemplo.com/descargar)"
                    value={hop.url}
                    onChange={(event) => setHop(index, 'url', event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Selector para hacer clic (ej. #descarga)"
                    value={hop.clickSelector}
                    onChange={(event) => setHop(index, 'clickSelector', event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="O bien texto del botón para hacer clic (ej. «Descargar»)"
                    value={hop.clickText}
                    onChange={(event) => setHop(index, 'clickText', event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder={'Selector del campo de texto (ej. input[name="email"])'}
                    value={hop.typeSelector}
                    onChange={(event) => setHop(index, 'typeSelector', event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Texto para escribir en el campo"
                    value={hop.typeText}
                    onChange={(event) => setHop(index, 'typeText', event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Selector del botón Enviar (opcional)"
                    value={hop.submitSelector}
                    onChange={(event) => setHop(index, 'submitSelector', event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="O bien texto del botón Enviar"
                    value={hop.submitText}
                    onChange={(event) => setHop(index, 'submitText', event.target.value)}
                  />
                  <label>
                    Espera tras abrir (ms)
                    <input
                      type="number"
                      min="0"
                      value={hop.waitMs}
                      onChange={(event) => setHop(index, 'waitMs', event.target.value)}
                    />
                  </label>
                  <label>
                    Espera tras el clic (ms)
                    <input
                      type="number"
                      min="0"
                      value={hop.holdMs}
                      onChange={(event) => setHop(index, 'holdMs', event.target.value)}
                    />
                  </label>
                </div>
              </div>
            ))}
            <div className="bots-config">
              <button type="button" onClick={addHop} disabled={running}>
                + Agregar paso
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={linksDownloadOnly}
                  onChange={(event) => setLinksDownloadOnly(event.target.checked)}
                />
                Solo enlaces con pinta de descarga
              </label>
            </div>
            <div className="bots-config">
              <input
                type="text"
                placeholder="Nombre de la fuente (opcional; se guarda con los enlaces)"
                value={linksName}
                onChange={(event) => setLinksName(event.target.value)}
              />
              <input
                type="text"
                placeholder="URL de la fuente/página de origen (opcional)"
                value={linksSource}
                onChange={(event) => setLinksSource(event.target.value)}
              />
            </div>
            {links.length ? (
              <div className="results bots-results">
                <div>
                  <label>
                    {links.length} enlace{links.length === 1 ? '' : 's'} recogido
                    {links.length === 1 ? '' : 's'}
                  </label>
                  <span>Vigencia: 24 h desde su consulta.</span>
                </div>
                <div className="bots-table table-links">
                  <section>
                    <label>
                      <span>
                        <strong>Enlace</strong>
                      </span>
                      <b>Fuente</b>
                      <b>Guardado</b>
                    </label>
                    {links.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          window.tools.openUrl(item.url);
                        }}
                      >
                        <span>
                          <strong>{item.url}</strong>
                        </span>
                        <b>{item.sourceTitle || (item.sourceUrl ? 'Página de origen' : '—')}</b>
                        <b>{formatDate(item.fetched)}</b>
                      </button>
                    ))}
                  </section>
                </div>
              </div>
            ) : (
              <div className="video-empty">
                Todavía no hay enlaces guardados. Ejecuta el flujo para recogerlos.
              </div>
            )}
          </>
        )}
        {tab === 'sessions' && (
          <>
            <div className="step">
              <span>1</span>
              <div>
                <h2>Nueva sesión de portal</h2>
                <p>
                  Configura los selectores del formulario de acceso. El bot abre el portal en una
                  sesión persistente y deja las cookies guardadas para próximos usos.
                </p>
              </div>
            </div>
            <div className="bots-session-form">
              <input
                type="text"
                placeholder="Nombre del portal (ej. Mi biblioteca)"
                value={sessionForm.portal}
                onChange={(event) => setSessionForm({ ...sessionForm, portal: event.target.value })}
              />
              <input
                type="text"
                placeholder="URL de inicio de sesión"
                value={sessionForm.url}
                onChange={(event) => setSessionForm({ ...sessionForm, url: event.target.value })}
              />
              <input
                type="text"
                placeholder="Usuario"
                value={sessionForm.username}
                onChange={(event) => setSessionForm({ ...sessionForm, username: event.target.value })}
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={sessionForm.password}
                onChange={(event) => setSessionForm({ ...sessionForm, password: event.target.value })}
              />
              <input
                type="text"
                placeholder="Selector del campo usuario (id. #username)"
                value={sessionForm.userField}
                onChange={(event) => setSessionForm({ ...sessionForm, userField: event.target.value })}
              />
              <input
                type="text"
                placeholder="Selector del campo contraseña (id. #password)"
                value={sessionForm.passField}
                onChange={(event) => setSessionForm({ ...sessionForm, passField: event.target.value })}
              />
              <input
                type="text"
                placeholder={'Selector del botón Entrar (id. button[type="submit"])'}
                value={sessionForm.submitSelector}
                onChange={(event) =>
                  setSessionForm({ ...sessionForm, submitSelector: event.target.value })
                }
              />
              <input
                type="text"
                placeholder="Selector para confirmar el acceso (ej. .header-user; opcional)"
                value={sessionForm.successSelector}
                onChange={(event) =>
                  setSessionForm({ ...sessionForm, successSelector: event.target.value })
                }
              />
            </div>
            <div className="bots-config">
              <button type="button" onClick={saveSession} disabled={running}>
                + Guardar sesión
              </button>
              {sessionNotice && <span className="bots-notice">{sessionNotice}</span>}
            </div>
            {sessions.length ? (
              <div className="results bots-results">
                <div>
                  <label>
                    {sessions.length} sesión{sessions.length === 1 ? '' : 'es'} guardada
                    {sessions.length === 1 ? '' : 's'}
                  </label>
                  <span>Las cookies persisten entre ejecuciones.</span>
                </div>
                <div className="bots-table table-sessions">
                  <section>
                    <label>
                      <span>
                        <strong>Portal</strong>
                      </span>
                      <b>Usuario</b>
                      <b>Guardada</b>
                      <b />
                    </label>
                    {sessions.map((item) => (
                        <div
                          className={`bots-session-row${item.id === selectedSessionId ? ' selected' : ''}`}
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedSessionId(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedSessionId(item.id);
                            }
                          }}
                        >
                          <span>
                            <strong>{item.portal}</strong>
                            <small>{item.url}</small>
                          </span>
                          <b>{item.username}</b>
                          <b>{formatDate(item.updatedAt)}</b>
                          <span className="bots-session-actions">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void runSession(item.id);
                              }}
                              disabled={running || sessionRunId === item.id}
                            >
                              {sessionRunId === item.id ? 'Autenticando…' : 'Ejecutar'}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteSession(item.id);
                              }}
                              disabled={running}
                            >
                              Borrar
                            </button>
                          </span>
                        </div>
                      ))}
                  </section>
                </div>
                {sessionRunMsg && <p className="bots-notice">{sessionRunMsg}</p>}
              </div>
            ) : (
              <div className="video-empty">
                Todavía no hay sesiones guardadas. Crea una para autenticarte en tu portal.
              </div>
            )}
          </>
        )}
        <div className="divider" />
        <aside className="sd-disclaimer">
          <strong>{recipe?.title ?? 'Qué hace el bot'}</strong>
          <span>
            {recipe?.blurb ?? ''} {recipe?.cacheLabel ?? ''}. Las ventanas se abren ocultas y no
            interfieren con tu trabajo; puedes pasar a otra sección mientras se ejecutan.
          </span>
        </aside>
        {cacheHint && <p className="bots-notice">{cacheHint}</p>}
        {message && <p className="image-message error">{message}</p>}
        {running && (
          <div className="normalize-progress">
            <span>
              <strong>{state?.message ?? 'Trabajando…'}</strong>
              <b>{state?.stepIndex ?? 0} / {state?.stepTotal ?? 0}</b>
            </span>
            <i>
              <b style={{ width: `${stepPercent}%` }} />
            </i>
          </div>
        )}
        {state && state.log.length > 0 && (
          <div className="bots-log" ref={logRef}>
            <h3>Registro de la ejecución</h3>
            {state.log.map((entry, index) => (
              <p className={`log-${entry.tone ?? 'info'}`} key={index}>
                {entry.text}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="tool-action simple">
        <span>
          {running
            ? 'El bot continúa aunque cambies de sección'
            : tab === 'steam' && (deals.length || steamQuery.trim() || steamRefresh)
              ? `${deals.length} ofertas en la tabla local (24 h)`
              : tab === 'amazon' && (prices.length || amazonUrls.trim())
                ? `${prices.length} precios en la tabla local (24 h)`
                : tab === 'links' && (links.length || activeHopList().length)
                  ? `${links.length} enlaces en la tabla local (24 h)`
                  : tab === 'sessions'
                    ? `${sessions.length} sesión${sessions.length === 1 ? '' : 'es'} configurada${sessions.length === 1 ? '' : 's'}`
                    : 'Elige un bot y ejecútalo desde esta sección'}
        </span>
        {running ? (
          <button className="cancel-button" onClick={cancel}>
            Cancelar bot
          </button>
        ) : tab === 'sessions' ? (
          <button
            disabled={selectedSessionId == null}
            onClick={() => {
              if (selectedSessionId != null) void runSession(selectedSessionId);
            }}
          >
            Iniciar sesión de acceso →
          </button>
        ) : (
          <button
            disabled={!canRunFooter}
            onClick={() => {
              if (tab === 'steam') void runSteam();
              else if (tab === 'amazon') void runAmazon();
              else if (tab === 'links') void runLinks();
            }}
          >
            Ejecutar bot →
          </button>
        )}
      </div>
    </section>
  );
}