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
  const code = text.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|MXN|BRL|CLP|ARS|COP|PEN)\b/)?.[1];
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
  const fallback = $('[class*="price"], [id*="price"]')
    .toArray()
    .map((element) => $(element).text().trim())
    .find((text) => /[$€£¥]\s*\d|\d[\d.,]*\s*(USD|EUR|GBP|JPY|MXN)/i.test(text));
  const price = numberFromPrice(fallback);
  return price === null ? null : { price, currency: currencyFromText(fallback) };
}

async function scrapePrice(value) {
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
    const result = extractPrice(response.body);
    if (!result) throw new Error('No se encontró un precio reconocible en la página.');
    return result;
  }
  throw new Error('La página superó el máximo de redirecciones.');
}

module.exports = { scrapePrice, extractPrice, numberFromPrice };
