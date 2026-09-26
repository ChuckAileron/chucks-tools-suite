const { load } = require('cheerio');
const { requestPage, validatePublicUrl } = require('./urlResolver.cjs');

const PRICE_META = [
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[itemprop="price"]',
  '[itemprop="price"][content]',
];
const CURRENCY_META = [
  'meta[property="product:price:currency"]',
  'meta[property="og:price:currency"]',
  'meta[itemprop="priceCurrency"]',
  '[itemprop="priceCurrency"][content]',
];
// Monedas sin fracciones decimales: los separadores intermedios del número
// (comas o puntos) son siempre separadores de miles (p. ej. "CLP 189,018").
const NO_DECIMAL_CURRENCIES = new Set([
  'ARS',
  'BRL',
  'CLP',
  'COP',
  'HUF',
  'IDR',
  'JPY',
  'KRW',
  'VND',
]);

function numberFromPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value || '').match(/\d[\d.,\s]*/);
  if (!match) return null;
  let normalized = match[0].replace(/\s/g, '');
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma > dot) normalized = normalized.replace(/\./g, '').replace(',', '.');
  else normalized = normalized.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function currencyFromText(value) {
  const text = String(value || '').toUpperCase();
  // El código puede ir pegado a la cifra (p. ej. "CLP189,018" en Amazon).
  const code =
    text.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|MXN|BRL|CLP|ARS|COP|PEN)\b/)?.[1] ||
    text.match(/(?:^|[^A-Z])(USD|EUR|GBP|JPY|CAD|AUD|MXN|BRL|CLP|ARS|COP|PEN)(?=\d)/)?.[1];
  if (code) return code;
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (text.includes('¥')) return 'JPY';
  if (text.includes('$')) return 'USD';
  return null;
}

function findOffer(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const offer = findOffer(entry);
      if (offer) return offer;
    }
    return null;
  }
  if (value.price !== undefined || value.lowPrice !== undefined) {
    const rawPrice = value.price ?? value.lowPrice;
    const price = numberFromPrice(rawPrice);
    if (price !== null)
      return {
        price,
        currency: value.priceCurrency || currencyFromText(rawPrice),
      };
  }
  for (const entry of Object.values(value)) {
    const offer = findOffer(entry);
    if (offer) return offer;
  }
  return null;
}

// Recorre textos de elementos con apariencia de precio. Primero busca un
// candidato con moneda explícita (símbolo o código) cuya cifra sea parseable
// y, si no hay ninguno, cualquier cifra reconocible. Esto evita que un
// contenedor padre con texto agregado (p. ej. el "a-price" de Amazon) anule
// el precio real de su "a-offscreen".
function parsePriceFromTexts(texts) {
  for (const text of texts) {
    const currency = currencyFromText(text);
    if (!currency) continue;
    const price = priceNumberFromText(text, currency);
    if (price !== null) return { price, currency };
  }
  for (const text of texts) {
    const price = numberFromPrice(text);
    if (price !== null) return { price, currency: null };
  }
  return null;
}

function priceNumberFromText(text, currency) {
  const numericTokens = String(text || '')
    .split(/\s+/)
    .filter((token) => /\d/.test(token));
  // Con más de una cifra el texto es agregado (p. ej. contenedor "a-price"
  // de Amazon con "189,018 189,018") y no es un precio fiable.
  if (numericTokens.length !== 1) return null;
  const raw = numericTokens[0].match(/\d[\d.,\u202f]*/);
  if (!raw) return null;
  if (NO_DECIMAL_CURRENCIES.has(currency)) {
    // CLP, JPY, etc. no usan decimales: los separadores son de miles. La
    // concatenación de varios grupos (p. ej. "189,018189,018") se rechaza.
    if ((raw[0].match(/[.,\u202f]/g) || []).length > 1) return null;
    const value = Number(raw[0].replace(/[\s.,\u202f]/g, ''));
    return Number.isFinite(value) ? value : null;
  }
  return numberFromPrice(raw[0]);
}

function extractPrice(html) {
  const $ = load(html);
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const offer = findOffer(JSON.parse($(script).text()));
      if (offer) return offer;
    } catch {
      // Some stores emit malformed JSON-LD; continue with metadata fallbacks.
    }
  }
  for (const selector of PRICE_META) {
    const element = $(selector).first();
    const rawPrice = element.attr('content') || element.attr('value') || element.text();
    const price = numberFromPrice(rawPrice);
    if (price !== null) {
      let currency = null;
      for (const currencySelector of CURRENCY_META) {
        const currencyElement = $(currencySelector).first();
        const rawCurrency = currencyElement.attr('content') || currencyElement.text();
        if (rawCurrency) {
          currency = rawCurrency.trim().toUpperCase();
          break;
        }
      }
      return { price, currency: currency || currencyFromText(rawPrice) };
    }
  }
  // Amazon esconde el precio del buybox en un "a-offscreen" que no matchea
  // por clase "price"; su contenedor "a-price" sí, pero con texto duplicado.
  const offscreen = $('.a-price .a-offscreen').first().text().replace(/\s+/g, ' ').trim();
  if (offscreen) {
    const amazon = parsePriceFromTexts([offscreen]);
    if (amazon) return amazon;
  }
  const fallback = parsePriceFromTexts(
    $('[class*="price"], [id*="price"]')
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, ' ').trim()),
  );
  return fallback === null ? null : { price: fallback.price, currency: fallback.currency };
}

function imageValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return imageValue(value[0]);
  if (value && typeof value === 'object') return imageValue(value.url || value.contentUrl);
  return '';
}

function findProductImage(value) {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = findProductImage(entry);
      if (image) return image;
    }
    return '';
  }
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some((type) => String(type).toLowerCase() === 'product')) {
    const image = imageValue(value.image);
    if (image) return image;
  }
  for (const entry of Object.values(value)) {
    const image = findProductImage(entry);
    if (image) return image;
  }
  return '';
}

function amazonProductImage($) {
  const image = $('#landingImage, #imgBlkFront, #ebooksImgBlkFront, .a-dynamic-image').first();
  const highResolution = image.attr('data-old-hires');
  if (highResolution) return highResolution;
  const dynamic = image.attr('data-a-dynamic-image');
  if (dynamic) {
    try {
      const variants = Object.entries(JSON.parse(dynamic));
      variants.sort((a, b) => {
        const [aw = 0, ah = 0] = a[1];
        const [bw = 0, bh = 0] = b[1];
        return bw * bh - aw * ah;
      });
      if (variants[0]?.[0]) return variants[0][0];
    } catch {
      // Continúa con los demás atributos de la imagen de Amazon.
    }
  }
  return image.attr('src') || '';
}

function extractProductImage(html, baseUrl) {
  const $ = load(html);
  let candidate = '';
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      candidate = findProductImage(JSON.parse($(script).text()));
    } catch {
      // Tiendas con JSON-LD inválido pueden publicar la imagen en metadatos HTML.
    }
    if (candidate) break;
  }
  candidate ||= amazonProductImage($);
  candidate ||= $(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"], [itemprop="image"]',
  )
    .toArray()
    .map((element) => $(element).attr('content') || $(element).attr('src') || $(element).attr('href'))
    .find(Boolean);
  if (!candidate) return null;
  try {
    const url = new URL(candidate, baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

async function scrapeProduct(value) {
  let url = await validatePublicUrl(value);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await requestPage(url, 5 * 1024 * 1024);
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = await validatePublicUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 400)
      throw new Error(`La tienda respondió con estado HTTP ${response.status}.`);
    if (!response.contentType.includes('html'))
      throw new Error('La página no devolvió contenido HTML.');
    const price = extractPrice(response.body);
    return {
      price: price?.price ?? null,
      currency: price?.currency ?? null,
      imageUrl: extractProductImage(response.body, url),
      error: price ? null : 'No se encontró un precio reconocible en la página.',
    };
  }
  throw new Error('La página superó el máximo de redirecciones.');
}

async function scrapePrice(value) {
  const result = await scrapeProduct(value);
  if (result.error) throw new Error(result.error);
  return {
    price: result.price,
    currency: result.currency,
    ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
  };
}

module.exports = {
  scrapePrice,
  scrapeProduct,
  extractPrice,
  extractProductImage,
  numberFromPrice,
  // Helpers puros expuestos para pruebas unitarias.
  currencyFromText,
  findOffer,
};
