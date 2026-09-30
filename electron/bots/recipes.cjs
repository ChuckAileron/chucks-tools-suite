const { scrapeProduct } = require('../priceScraper.cjs');
const { DEVICE_LINK_RE } = require('./botEngine.cjs');

const STEAM_DEALS_URL = 'https://store.steampowered.com/search/?specials=1&filter=topsellers';

const steamScript = (limit) => `(() => {
  const LIMIT = ${JSON.stringify(Number(limit) || 150)};
  const rows = [...document.querySelectorAll('.search_result_row')].slice(0, LIMIT);
  const moneyOf = (cents) => {
    const value = Number(cents);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const appIdOf = (row) => (row.getAttribute('data-ds-appid') || '').trim();
  const fallbackTags = (row) => {
    const tagsEl = row.querySelector('.search_tags');
    if (!tagsEl) return '';
    const viaSpans = [...(tagsEl.querySelectorAll('.search_tag') || [])]
      .map((tag) => tag.textContent.trim())
      .filter(Boolean);
    if (viaSpans.length) return viaSpans.slice(0, 3).join(', ');
    return tagsEl.textContent
      .split(/[,/·]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
  };
  const ids = [...new Set(rows.map(appIdOf).filter(Boolean))];
  const categoriesByApp = {};
  return (async () => {
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      try {
        const res = await fetch(
          'https://store.steampowered.com/api/appdetails?filters=genres&l=spanish&appids=' +
            encodeURIComponent(chunk.join(',')),
        );
        const json = await res.json();
        for (const id of chunk) {
          const data = json && json[id] && json[id].data;
          if (data && Array.isArray(data.genres)) {
            const genres = data.genres.map((genre) => genre.description).filter(Boolean);
            if (genres.length) categoriesByApp[id] = genres.slice(0, 3);
          }
        }
      } catch {}
    }
    return rows
      .map((row) => {
        const textOf = (selector) =>
          (row.querySelector(selector) || { textContent: '' }).textContent.trim();
        const title = textOf('.title');
        const priceEl = row.querySelector('.search_price');
        const priceText = (priceEl || { textContent: '' }).textContent.trim();
        const currency = (priceText.match(/[^\\d\\s.,-]+/) || [''])[0];
        const priceFinal = moneyOf(priceEl?.getAttribute('data-price-final'));
        const priceInitial = moneyOf(priceEl?.getAttribute('data-price-initial'));
        const hasDiscount = !!row.querySelector('.discount_pct');
        const groups = [...priceText.matchAll(/(?:[^\\d\\s.,]+\\s*)?(\\d[\\d.,]*)/g)].map(
          (match) => match[0].trim(),
        );
        let now = groups[0] || priceText;
        let original = '';
        if (hasDiscount && groups.length > 1) original = groups[1];
        if (!now) now = 'Gratis';
        const categories = categoriesByApp[appIdOf(row)] || [];
        const tag = categories.length ? categories.join(', ') : fallbackTags(row);
        return {
          title,
          price: now,
          original,
          discount: textOf('.discount_pct'),
          tag,
          currency,
          priceFinal,
          priceInitial,
          url: (row.href || row.querySelector('a')?.href || '').replace(/\\s+$/, ''),
        };
      })
      .filter((item) => item.title);
  })();
})()`;

const buildSteam = (config) => ({
  steps: [
    { type: 'navigate', url: config.url || STEAM_DEALS_URL, waitMs: config.waitMs || 3500 },
    { type: 'collect', key: 'deals', script: steamScript(config.limit) },
  ],
});

const buildAmazon = (config) => {
  const urls = Array.isArray(config.urls)
    ? config.urls.filter((url) => /^https?:\/\//i.test(url)).slice(0, 50)
    : [];
  return {
    steps: urls.map((url, index) => ({
      type: 'task',
      key: `product-${index}`,
      label: `Precio ${index + 1} de ${urls.length}`,
      fn: async () => {
        const product = await scrapeProduct(url);
        return { url, ...product };
      },
    })),
  };
};

const buildLinks = (config) => {
  const hops = Array.isArray(config.hops) ? config.hops.slice(0, 20) : [];
  const pattern = typeof config.pattern === 'string' ? config.pattern : DEVICE_LINK_RE.source;
  const steps = [];
  for (const hop of hops) {
    if (!hop.url) continue;
    const waitMs = Number(hop.waitMs) || 0;
    const holdMs = Number(hop.holdMs) || 0;
    steps.push({ type: 'navigate', url: hop.url, waitMs });
    if (hop.clickSelector || hop.clickText)
      steps.push({
        type:   'click',
        selector: hop.clickSelector,
        text:   hop.clickText,
        waitMs: holdMs,
      });
    if (hop.typeSelector && hop.typeText)
      steps.push({ type: 'type', selector: hop.typeSelector, text: hop.typeText });
    if (hop.submitSelector || hop.submitText)
      steps.push({
        type:   'submit',
        selector: hop.submitSelector,
        text:   hop.submitText,
        waitMs: holdMs,
      });
    else if (!hop.clickSelector && !hop.clickText)
      steps.push({ type: 'wait', ms: waitMs || 1000 });
    else if (holdMs) steps.push({ type: 'wait', ms: holdMs });
  }
  steps.push({ type: 'collect-links', key: 'links', pattern });
  return { steps };
};

const buildSession = (session) => ({
  steps: [
    { type: 'navigate', url: session.url, waitMs: 1800 },
    { type: 'type', selector: session.userField, text: session.username },
    { type: 'type', selector: session.passField, text: session.password },
    { type: 'submit', selector: session.submitSelector, waitMs: 2500 },
    { type: 'authed-check', successSelector: session.successSelector, key: 'authed' },
  ],
});

const RECIPES = {
  steam: {
    id:          'steam',
    title:       'Steam · juegos en oferta',
    blurb:       'Recorre la tienda y guarda los juegos con descuento en una tabla local.',
    cacheLabel:  'Los datos expiran a las 24 h',
    buildFlow:   buildSteam,
  },
  amazon: {
    id:          'amazon',
    title:       'Amazon · precios a demanda',
    blurb:       'Consulta el precio de productos de Amazon y guárdalo con vigencia de 1 día.',
    cacheLabel:  'Cada precio se guarda con expiración de 24 h',
    buildFlow:   buildAmazon,
  },
  links: {
    id:          'links',
    title:       'Enlaces de descarga · flujo de clics',
    blurb:       'Motor universal: navega, haz clic, rellena campos y recoge los enlaces encontrados.',
    cacheLabel:  'Los enlaces recogidos se guardan con vigencia de 24 h',
    buildFlow:   buildLinks,
  },
  sessions: {
    id:          'sessions',
    title:       'Sesiones · autenticación en portales',
    blurb:       'Crea una sesión de navegador persistente y autentica en el portal que configures.',
    cacheLabel:  'La sesión y sus cookies se conservan entre ejecuciones',
    buildFlow:   buildSession,
  },
};

const recipesList = () =>
  Object.values(RECIPES).map(({ id, title, blurb, cacheLabel }) => ({
    id,
    title,
    blurb,
    cacheLabel,
  }));

module.exports = { RECIPES, recipesList, STEAM_DEALS_URL };