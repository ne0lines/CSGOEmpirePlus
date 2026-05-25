(function (root) {
  'use strict';

  const DEFAULT_COIN_USD_RATE = 0.6142808;
  const DEFAULT_SETTINGS = {
    currency: 'USD',
    chartRange: 'all',
    showSummary: false,
    showChart: true,
    showDetails: false,
  };
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_CHART_PRESET = '30d';
  const CHART_PRESETS = [
    { value: '24h', label: '24h', durationMs: DAY_MS },
    { value: '7d', label: '7d', durationMs: 7 * DAY_MS },
    { value: '30d', label: '30d', durationMs: 30 * DAY_MS },
    { value: '90d', label: '90d', durationMs: 90 * DAY_MS },
    { value: '180d', label: '180d', durationMs: 180 * DAY_MS },
    { value: '1y', label: '1y', durationMs: 365 * DAY_MS },
    { value: 'all', label: 'All', durationMs: null },
  ];
  const CHART_PRESET_MAP = new Map(CHART_PRESETS.map(preset => [preset.value, preset]));

  const WEAR_VARIANTS = new Map([
    ['factory new', 'factory-new'],
    ['minimal wear', 'minimal-wear'],
    ['field-tested', 'field-tested'],
    ['field tested', 'field-tested'],
    ['well-worn', 'well-worn'],
    ['well worn', 'well-worn'],
    ['battle-scarred', 'battle-scarred'],
    ['battle scarred', 'battle-scarred'],
  ]);

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u2122/g, '')
      .replace(/[★☆✦✶]/g, '')
      .toLowerCase()
      .replace(/\|/g, ' ')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');
  }

  function buildPricempireSlug(marketName) {
    const raw = String(marketName || '').trim();
    const wearMatch = raw.match(/\((Factory\s*New|Minimal\s*Wear|Field[-\s]*Tested|Well[-\s]*Worn|Battle[-\s]*Scarred)\)/i);
    const wear = wearMatch ? WEAR_VARIANTS.get(wearMatch[1].toLowerCase().replace(/\s+/g, ' ').replace(/ - /g, '-')) || slugify(wearMatch[1]) : null;
    const isStatTrak = /(?:stat\s*trak|stattrak|\bST\b)/i.test(raw);

    let base = raw
      .replace(/^\s*[★☆✦✶]\s*/, '')
      .replace(/\((Factory\s*New|Minimal\s*Wear|Field[-\s]*Tested|Well[-\s]*Worn|Battle[-\s]*Scarred)\)/ig, '')
      .replace(/(?:stat\s*trak|stattrak)\u2122?/ig, '')
      .replace(/\u2122/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const slug = slugify(base);
    let variant = null;
    if (isStatTrak && wear && wear !== 'factory-new') variant = `stattrak-${wear}`;
    else if (isStatTrak) variant = 'stattrak';
    else if (wear && wear !== 'factory-new') variant = wear;

    return { slug, variant, isStatTrak, wear };
  }

  function buildPricempireSlugCandidates(marketName) {
    const primary = buildPricempireSlug(marketName);
    const candidates = [];
    const seen = new Set();

    function push(info) {
      if (!info || !info.slug) return;
      const candidate = Object.assign({ variant: null, format: 'base-slug' }, info);
      const key = `${candidate.slug}|${candidate.variant || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(candidate);
    }

    push(Object.assign({}, primary, { format: primary.variant ? 'query-variant' : 'base-slug' }));

    const hasNonDefaultWear = primary.wear && primary.wear !== 'factory-new';

    if (primary.isStatTrak) {
      push({
        slug: hasNonDefaultWear ? `stattrak-${primary.slug}-${primary.wear}` : `stattrak-${primary.slug}`,
        variant: null,
        isStatTrak: true,
        wear: primary.wear,
        format: 'full-slug',
      });
    }

    if (hasNonDefaultWear) {
      push({
        slug: `${primary.slug}-${primary.wear}`,
        variant: null,
        isStatTrak: primary.isStatTrak,
        wear: primary.wear,
        format: 'full-slug',
      });
    }

    if (primary.variant) {
      push(Object.assign({}, primary, { variant: null, format: 'base-slug' }));
    }

    return candidates;
  }

  function buildPricempireFullItemSlug(marketName) {
    const primary = buildPricempireSlug(marketName);
    if (!primary.slug) return '';
    let slug = primary.slug;
    if (primary.wear) {
      const phaseMatch = slug.match(/^(.*)-(phase-\d+)$/);
      slug = phaseMatch ? `${phaseMatch[1]}-${primary.wear}-${phaseMatch[2]}` : `${slug}-${primary.wear}`;
    }
    if (primary.isStatTrak) slug = `stattrak-${slug}`;
    return slug;
  }

  function buildPricempireItemPageCandidates(marketName) {
    const primary = buildPricempireSlug(marketName);
    const fullSlug = buildPricempireFullItemSlug(marketName);
    const candidates = [];
    const seen = new Set();

    function push(path, format) {
      if (!path || seen.has(path)) return;
      seen.add(path);
      candidates.push({ path, format });
    }

    if (primary.slug && primary.variant) {
      push(`/cs2-items/skin/${primary.slug}?variant=${encodeURIComponent(primary.variant)}`, 'query-variant');
      push(`/cs2-items/skin/${primary.slug}/${encodeURIComponent(primary.variant)}`, 'path-variant');
    } else if (primary.slug) {
      push(`/cs2-items/skin/${primary.slug}`, 'base-slug');
    }

    if (fullSlug) push(`/item/${fullSlug}`, 'legacy-item');
    if (primary.slug && primary.variant) push(`/cs2-items/skin/${primary.slug}`, 'base-slug');

    return candidates;
  }

  function normalizeSettings(input) {
    const source = input && typeof input === 'object' ? input : {};
    const currency = String(source.currency || DEFAULT_SETTINGS.currency).toUpperCase();
    return {
      currency,
      chartRange: DEFAULT_SETTINGS.chartRange,
      showSummary: DEFAULT_SETTINGS.showSummary,
      showChart: DEFAULT_SETTINGS.showChart,
      showDetails: DEFAULT_SETTINGS.showDetails,
    };
  }

  function normalizeChartPreset(value) {
    const preset = String(value || '').toLowerCase();
    return CHART_PRESET_MAP.has(preset) ? preset : DEFAULT_CHART_PRESET;
  }

  function pointTimestamp(point) {
    if (typeof point === 'number') return Number.isFinite(point) ? point : null;
    if (!point || typeof point !== 'object') return null;
    const value = point.ts ?? point.x ?? point.timestamp ?? point.time ?? point.date ?? point.t;
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? (value < 1000000000000 ? value * 1000 : value) : null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function getChartPresetWindow(points, preset, nowTs) {
    const timestamps = (Array.isArray(points) ? points : [])
      .map(pointTimestamp)
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (!timestamps.length) return null;

    const min = timestamps[0];
    const max = timestamps[timestamps.length - 1];
    const selected = CHART_PRESET_MAP.get(normalizeChartPreset(preset));
    if (!selected || selected.durationMs == null) return { min, max };

    const end = Number.isFinite(nowTs) ? nowTs : max;
    return { min: end - selected.durationMs, max: end };
  }

  function normalizeExchangeRates(input) {
    const source = input && typeof input === 'object' && input.rates ? input.rates : input;
    const rates = { USD: 1 };
    if (source && typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        const parsed = parseNumber(value);
        if (parsed != null) rates[String(key).toUpperCase()] = parsed;
      }
    }
    return rates;
  }

  function convertEmpireCoins(coins, currency, rates, coinUsdRate) {
    const amount = parseNumber(coins);
    if (amount == null) return null;
    const normalizedRates = normalizeExchangeRates(rates || {});
    const selected = normalizedRates[String(currency || 'USD').toUpperCase()] || normalizedRates.USD || 1;
    return Number((amount * (coinUsdRate || DEFAULT_COIN_USD_RATE) * selected).toFixed(6));
  }

  function pickArray(input) {
    if (Array.isArray(input)) return input;
    if (!input || typeof input !== 'object') return [];
    if (Array.isArray(input.data)) return input.data;
    if (input.data && typeof input.data === 'object') return pickArray(input.data);
    if (input.similar_listings && Array.isArray(input.similar_listings.historic)) return input.similar_listings.historic;
    if (Array.isArray(input.items)) return input.items;
    if (Array.isArray(input.sales)) return input.sales;
    if (Array.isArray(input.history)) return input.history;
    if (Array.isArray(input.chart)) return input.chart;
    if (Array.isArray(input.prices)) return input.prices;
    return [];
  }

  function pickDate(raw) {
    const value = raw && (raw.timestamp ?? raw.time ?? raw.date ?? raw.t ?? raw.x ?? raw.sold_at ?? raw.soldAt ?? raw.created_at ?? raw.createdAt);
    if (value == null) return null;
    const date = typeof value === 'number'
      ? new Date(value < 1000000000000 ? value * 1000 : value)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function normalizeChartPoints(input) {
    return pickArray(input)
      .map((raw) => {
        const date = pickDate(raw);
        const value = parseNumber(raw && (raw.price ?? raw.value ?? raw.y ?? raw.avg ?? raw.average ?? raw.median ?? raw.close));
        if (!date || value == null) return null;
        return { date: date.toISOString(), ts: date.getTime(), value, raw };
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }

  function normalizeSalesEvents(input) {
    return pickArray(input)
      .map((raw) => {
        const date = pickDate(raw);
        const totalValue = parseNumber(raw && raw.total_value);
        const value = totalValue == null
          ? parseNumber(raw && (raw.sale_price ?? raw.sold_price ?? raw.purchase_price ?? raw.price ?? raw.market_value ?? raw.value))
          : Number((totalValue / 100).toFixed(6));
        if (!date || value == null) return null;
        const item = raw.item && typeof raw.item === 'object' ? raw.item : raw;
        const float = parseNumber(item.float_value ?? item.float ?? item.paint_wear ?? item.wear);
        return {
          date: date.toISOString(),
          ts: date.getTime(),
          value,
          float,
          raw,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }

  function normalizePricempireLimits(input) {
    const raw = input && typeof input === 'object' && input.data && typeof input.data === 'object'
      ? input.data
      : (input && typeof input === 'object' ? input : {});
    const flat = flattenObject(raw);
    const rows = Object.entries(flat)
      .filter(([, value]) => value != null && value !== '' && typeof value !== 'object')
      .slice(0, 16);
    return { raw, rows };
  }

  function normalizePricempirePublicChart(input) {
    return pickArray(input)
      .map((raw) => {
        if (!Array.isArray(raw)) return null;
        const tsRaw = parseNumber(raw[0]);
        const cents = parseNumber(raw[1]);
        const count = parseNumber(raw[2]);
        if (tsRaw == null || cents == null) return null;
        const date = new Date(tsRaw < 1000000000000 ? tsRaw * 1000 : tsRaw);
        if (Number.isNaN(date.getTime())) return null;
        return {
          date: date.toISOString(),
          ts: date.getTime(),
          value: Number((cents / 100).toFixed(6)),
          count,
          raw,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }

  function normalizeMarketName(value) {
    return String(value || '')
      .replace(/\u2122/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function scriptBodiesFromHtml(html) {
    const bodies = [];
    const source = String(html || '');
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match = null;
    while ((match = re.exec(source))) bodies.push(match[1].trim());
    return bodies;
  }

  function resolvePayloadValue(payload, value) {
    if (Number.isInteger(value) && value >= 0 && value < payload.length) return payload[value];
    return value;
  }

  function extractPricempireItemFromNuxtPayload(html, marketName) {
    const wanted = normalizeMarketName(marketName);
    if (!wanted) return null;

    for (const body of scriptBodiesFromHtml(html)) {
      if (!body || body[0] !== '[' || !body.includes('market_hash_name')) continue;
      let payload = null;
      try { payload = JSON.parse(body); } catch (e) { continue; }
      if (!Array.isArray(payload)) continue;

      for (const entry of payload) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        if (!Object.prototype.hasOwnProperty.call(entry, 'market_hash_name') || !Object.prototype.hasOwnProperty.call(entry, 'id')) continue;

        const marketHashName = resolvePayloadValue(payload, entry.market_hash_name);
        if (normalizeMarketName(marketHashName) !== wanted) continue;

        const id = parseNumber(resolvePayloadValue(payload, entry.id));
        if (id == null) continue;

        const priceHistory = entry.price_history != null ? resolvePayloadValue(payload, entry.price_history) : null;
        return {
          id,
          marketHashName: String(marketHashName),
          slug: entry.slug != null ? String(resolvePayloadValue(payload, entry.slug)) : null,
          discriminator: entry.discriminator != null ? String(resolvePayloadValue(payload, entry.discriminator)) : null,
          discriminatorSlug: entry.discriminator_slug != null ? String(resolvePayloadValue(payload, entry.discriminator_slug)) : null,
          liquidity: entry.liquidity != null ? resolvePayloadValue(payload, entry.liquidity) : null,
          priceHistory: priceHistory && typeof priceHistory === 'object' && !Array.isArray(priceHistory) ? priceHistory : null,
        };
      }
    }

    return null;
  }

  function filterPointsByRange(points, range, nowTs) {
    const list = Array.isArray(points) ? points : [];
    if (range === 'all') return list.slice();
    const days = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '180d': 180,
      '365d': 365,
    }[range] || 30;
    const cutoff = (nowTs || Date.now()) - days * 24 * 60 * 60 * 1000;
    return list.filter(point => Number(point.ts) >= cutoff);
  }

  function buildPricempireUrls(apiBase, slugInfo) {
    const base = String(apiBase || 'https://api.pricempire.com').replace(/\/+$/g, '');
    const slug = encodeURIComponent(slugInfo && slugInfo.slug ? slugInfo.slug : '');
    const variant = slugInfo && slugInfo.variant ? String(slugInfo.variant) : '';
    const qs = variant ? `?variant=${encodeURIComponent(variant)}` : '';
    return {
      insights: `${base}/v4/trader/insights/${slug}${qs}`,
      chart: `${base}/v4/trader/insights/${slug}/chart${qs}`,
    };
  }

  function buildPricempirePublicChartUrl(publicBase, itemId, days) {
    const base = String(publicBase || 'https://pricempire.com').replace(/\/+$/g, '');
    return `${base}/api-data/v1/item/chart?id=${encodeURIComponent(itemId)}&days=${encodeURIComponent(days || 30)}`;
  }

  function flattenObject(input, prefix, output) {
    const out = output || {};
    if (!input || typeof input !== 'object') return out;
    for (const [key, value] of Object.entries(input)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        flattenObject(value, path, out);
      } else if (!Array.isArray(value)) {
        out[path] = value;
      }
    }
    return out;
  }

  const api = {
    DEFAULT_COIN_USD_RATE,
    DEFAULT_SETTINGS,
    DEFAULT_CHART_PRESET,
    CHART_PRESETS,
    buildPricempireSlug,
    buildPricempireSlugCandidates,
    buildPricempireItemPageCandidates,
    buildPricempirePublicChartUrl,
    extractPricempireItemFromNuxtPayload,
    normalizeSettings,
    normalizeChartPreset,
    getChartPresetWindow,
    normalizeExchangeRates,
    convertEmpireCoins,
    normalizeChartPoints,
    normalizeSalesEvents,
    normalizePricempireLimits,
    normalizePricempirePublicChart,
    filterPointsByRange,
    buildPricempireUrls,
    flattenObject,
    parseNumber,
    slugify,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.cePricempire = Object.assign(root.cePricempire || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : window);
