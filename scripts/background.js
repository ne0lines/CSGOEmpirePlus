try {
  importScripts('pricempire-utils.js');
} catch (e) {
  // Node syntax checks do not provide importScripts.
}

// Lightweight debugUtils for background context (service worker)
const _bgDebug = (() => {
  const styles = {
    default: 'font: 1em sans-serif; color: #fff; background-color: #444; padding:2px 6px; border-radius:2px;',
    background: 'font: 1em sans-serif; color: yellow; background-color: red; padding:2px 6px; border-radius:2px;',
    pricempire: 'font: 1em sans-serif; color: #fff; background-color: #7c3aed; padding:2px 6px; border-radius:2px;'
  };
  const focusTags = new Set();

  try {
    chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get('debugFocus', res => {
      (res && res.debugFocus || []).forEach(t => focusTags.add(String(t)));
    });
  } catch (e) { /* ignore */ }

  function dbg(tag, ...args) {
    const label = `[${tag}]`;
    if (focusTags.has(tag)) {
      const style = styles[tag] || styles.default;
      console.log(`%c${label}`, style, ...args);
    } else {
      console.log(label, ...args);
    }
  }

  function setFocus(tags) {
    focusTags.clear();
    (Array.isArray(tags) ? tags : [tags]).forEach(t => { if (t) focusTags.add(String(t)); });
    try { chrome && chrome.storage && chrome.storage.local && chrome.storage.local.set({ debugFocus: Array.from(focusTags) }); } catch (e) {}
  }

  return { dbg, setFocus };
})();

const PE_STORAGE = {
  apiKey: 'ce_pricempire_api_key',
  settings: 'ce_pricempire_settings',
  cache: 'ce_pricempire_cache',
  slugCache: 'ce_pricempire_slug_cache',
  itemCache: 'ce_pricempire_item_cache',
};

const PE_API_BASE = 'https://api.pricempire.com';
const PE_PUBLIC_BASE = 'https://pricempire.com';
const PE_CACHE_TTL_MS = 5 * 60 * 1000;
const PE_SLUG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PE_ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function storageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

function readUtils() {
  return self.cePricempire || {};
}

function makeError(code, message, details) {
  return { code, message, details: details || null };
}

async function getStoredConfig() {
  const utils = readUtils();
  const data = await storageGet([PE_STORAGE.apiKey, PE_STORAGE.settings]);
  return {
    apiKey: String(data[PE_STORAGE.apiKey] || '').trim(),
    settings: utils.normalizeSettings ? utils.normalizeSettings(data[PE_STORAGE.settings]) : data[PE_STORAGE.settings],
  };
}

async function getCacheEntry(key) {
  const data = await storageGet(PE_STORAGE.cache);
  const cache = data[PE_STORAGE.cache] || {};
  const entry = cache[key];
  if (!entry || !entry.expiresAt || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

async function setCacheEntry(key, value, ttlMs) {
  const data = await storageGet(PE_STORAGE.cache);
  const cache = data[PE_STORAGE.cache] || {};
  cache[key] = { value, expiresAt: Date.now() + ttlMs };
  await storageSet({ [PE_STORAGE.cache]: cache });
}

async function getSlugCache(marketName) {
  if (!marketName) return null;
  const data = await storageGet(PE_STORAGE.slugCache);
  const cache = data[PE_STORAGE.slugCache] || {};
  const entry = cache[marketName];
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

async function setSlugCache(marketName, value) {
  if (!marketName || !value) return;
  const data = await storageGet(PE_STORAGE.slugCache);
  const cache = data[PE_STORAGE.slugCache] || {};
  cache[marketName] = { value, expiresAt: Date.now() + PE_SLUG_TTL_MS };
  await storageSet({ [PE_STORAGE.slugCache]: cache });
}

async function getItemCache(marketName) {
  if (!marketName) return null;
  const data = await storageGet(PE_STORAGE.itemCache);
  const cache = data[PE_STORAGE.itemCache] || {};
  const entry = cache[marketName];
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

async function setItemCache(marketName, value) {
  if (!marketName || !value || !value.id) return;
  const data = await storageGet(PE_STORAGE.itemCache);
  const cache = data[PE_STORAGE.itemCache] || {};
  cache[marketName] = { value, expiresAt: Date.now() + PE_ITEM_TTL_MS };
  await storageSet({ [PE_STORAGE.itemCache]: cache });
}

async function fetchPricempireJson(url, apiKey) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }

  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message ? body.message : `Pricempire HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

async function fetchPricempirePublic(url, accept) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      'Accept': accept || 'application/json, text/plain, */*',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`Pricempire HTTP ${response.status}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }
  return text;
}

async function fetchPricempirePublicJson(url) {
  const text = await fetchPricempirePublic(url, 'application/json');
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    const err = new Error('Pricempire returned invalid JSON.');
    err.body = text;
    throw err;
  }
}

function errorFromPricempire(err) {
  if (err && (err.status === 401 || err.status === 403)) {
    return makeError('invalid_key', 'Pricempire API-key is missing or invalid.');
  }
  if (err && err.status === 404) {
    return makeError('not_found', 'Pricempire did not find this slug or variant.');
  }
  if (err && err.status === 429) {
    return makeError('rate_limited', 'Pricempire rate limit reached.');
  }
  return makeError('network_error', err && err.message ? err.message : 'Pricempire request failed.');
}

async function fetchAnalysisForSlug(slugInfo, apiKey) {
  const utils = readUtils();
  const urls = utils.buildPricempireUrls(PE_API_BASE, slugInfo);
  const cacheKey = `analysis:${slugInfo.slug}:${slugInfo.variant || ''}`;
  const cached = await getCacheEntry(cacheKey);
  if (cached) return Object.assign({ cacheHit: true }, cached);

  const [insightsResult, chartResult] = await Promise.allSettled([
    fetchPricempireJson(urls.insights, apiKey),
    fetchPricempireJson(urls.chart, apiKey),
  ]);
  if (insightsResult.status === 'rejected') throw insightsResult.reason;

  const warnings = [];
  let chart = [];
  if (chartResult.status === 'fulfilled') {
    chart = chartResult.value;
  } else if (chartResult.reason && chartResult.reason.status === 404) {
    warnings.push(makeError('chart_not_found', 'Pricempire chart was not found for this slug.'));
  } else {
    throw chartResult.reason;
  }

  const insights = insightsResult.value;
  const value = { slugInfo, insights, chart, urls, fetchedAt: new Date().toISOString() };
  if (warnings.length) value.warnings = warnings;
  await setCacheEntry(cacheKey, value, PE_CACHE_TTL_MS);
  return Object.assign({ cacheHit: false }, value);
}

function chartDaysForRange(range) {
  return {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
    all: 10000,
  }[range] || 10000;
}

function publicUrl(path) {
  return new URL(path, PE_PUBLIC_BASE).toString();
}

function compactAttempt(candidate, url, status, message) {
  return {
    path: candidate && candidate.path ? candidate.path : '',
    format: candidate && candidate.format ? candidate.format : null,
    url,
    status,
    message: message || null,
  };
}

async function resolvePricempireItem(marketName) {
  const utils = readUtils();
  const cached = await getItemCache(marketName);
  if (cached && cached.id) {
    return { item: cached, cacheHit: true, attemptedPricempireUrls: [] };
  }

  const candidates = utils.buildPricempireItemPageCandidates ? utils.buildPricempireItemPageCandidates(marketName) : [];
  const attemptedPricempireUrls = [];

  for (const candidate of candidates) {
    const url = publicUrl(candidate.path);
    try {
      const html = await fetchPricempirePublic(url, 'text/html,application/xhtml+xml');
      const item = utils.extractPricempireItemFromNuxtPayload
        ? utils.extractPricempireItemFromNuxtPayload(html, marketName)
        : null;
      if (item && item.id) {
        const resolved = Object.assign({}, item, { pageUrl: url });
        await setItemCache(marketName, resolved);
        attemptedPricempireUrls.push(compactAttempt(candidate, url, 'ok'));
        return { item: resolved, cacheHit: false, attemptedPricempireUrls };
      }
      attemptedPricempireUrls.push(compactAttempt(candidate, url, 'no_match', 'No exact market_hash_name match in page payload.'));
    } catch (err) {
      attemptedPricempireUrls.push(compactAttempt(candidate, url, err.status || 'error', err.message));
    }
  }

  const err = new Error('Pricempire item id was not found.');
  err.status = 404;
  err.attemptedPricempireUrls = attemptedPricempireUrls;
  throw err;
}

async function fetchPublicChart(itemId, settings) {
  const utils = readUtils();
  const days = chartDaysForRange(settings && settings.chartRange);
  const url = utils.buildPricempirePublicChartUrl
    ? utils.buildPricempirePublicChartUrl(PE_PUBLIC_BASE, itemId, days)
    : `${PE_PUBLIC_BASE}/api-data/v1/item/chart?id=${encodeURIComponent(itemId)}&days=${encodeURIComponent(days)}`;
  const cacheKey = `public-chart:${itemId}:${days}`;
  const cached = await getCacheEntry(cacheKey);
  if (cached) return Object.assign({ cacheHit: true }, cached);

  const raw = await fetchPricempirePublicJson(url);
  const value = {
    raw,
    chart: utils.normalizePricempirePublicChart ? utils.normalizePricempirePublicChart(raw) : [],
    chartUrl: url,
    days,
    fetchedAt: new Date().toISOString(),
  };
  await setCacheEntry(cacheKey, value, PE_CACHE_TTL_MS);
  return Object.assign({ cacheHit: false }, value);
}

async function handlePricempireAnalysis(payload) {
  const utils = readUtils();
  const config = await getStoredConfig();

  const marketName = String(payload && payload.marketName || '').trim();
  if (!marketName) {
    return { success: false, error: makeError('missing_market_name', 'No market_name found for this item.') };
  }

  const fallbackSlug = utils.buildPricempireSlug ? utils.buildPricempireSlug(marketName) : { slug: marketName, variant: null };
  const warnings = [];
  let resolved = null;
  let chart = null;

  try {
    resolved = await resolvePricempireItem(marketName);
  } catch (err) {
    return {
      success: true,
      data: {
        itemId: payload.itemId || null,
        marketName,
        empirePrice: payload.empirePrice ?? null,
        settings: config.settings,
        slugInfo: fallbackSlug,
        pricempireItem: null,
        insights: null,
        chart: [],
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
        pricempireUnavailable: true,
        warnings: [
          makeError('item_id_not_found', 'Pricempire item id was not found. Showing CSGOEmpire data only.'),
        ],
        attemptedPricempireUrls: err.attemptedPricempireUrls || [],
      },
    };
  }

  try {
    chart = await fetchPublicChart(resolved.item.id, config.settings);
  } catch (err) {
    warnings.push(makeError('chart_unavailable', 'Pricempire chart could not be loaded.'));
    chart = { chart: [], chartUrl: null, cacheHit: false, fetchedAt: new Date().toISOString() };
  }

  return {
    success: true,
    data: {
      itemId: payload.itemId || null,
      marketName,
      empirePrice: payload.empirePrice ?? null,
      settings: config.settings,
      slugInfo: { slug: resolved.item.slug || fallbackSlug.slug, variant: null, format: 'public-item' },
      pricempireItem: resolved.item,
      insights: {
        pricempire_id: resolved.item.id,
        market_hash_name: resolved.item.marketHashName,
        slug: resolved.item.slug,
        liquidity: resolved.item.liquidity,
        price_history: resolved.item.priceHistory,
      },
      chart: chart.chart || [],
      chartUrl: chart.chartUrl || null,
      fetchedAt: chart.fetchedAt,
      cacheHit: Boolean(resolved.cacheHit && chart.cacheHit),
      pricempireUnavailable: false,
      warnings,
      attemptedPricempireUrls: resolved.attemptedPricempireUrls || [],
    },
  };
}

async function handlePricempireTestKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { success: false, error: makeError('missing_key', 'Enter a Pricempire API-key first.') };

  const utils = readUtils();
  try {
    await fetchPricempireJson(`${PE_API_BASE}/v4/free/limits`, key);
    return { success: true };
  } catch (err) {
    return { success: false, error: errorFromPricempire(err) };
  }
}

async function handlePricempireLimits() {
  const utils = readUtils();
  const config = await getStoredConfig();
  if (!config.apiKey) {
    return { success: false, error: makeError('missing_key', 'Add your Pricempire API-key in Options.') };
  }

  const raw = await fetchPricempireJson(`${PE_API_BASE}/v4/free/limits`, config.apiKey);
  const data = utils.normalizePricempireLimits ? utils.normalizePricempireLimits(raw) : { raw, rows: [] };
  return {
    success: true,
    data: Object.assign({}, data, {
      fetchedAt: new Date().toISOString(),
    }),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PRICEMPIRE_GET_ANALYSIS') {
    handlePricempireAnalysis(message.payload || {})
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: errorFromPricempire(err) }));
    return true;
  }

  if (message.type === 'PRICEMPIRE_TEST_KEY') {
    handlePricempireTestKey(message.apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: errorFromPricempire(err) }));
    return true;
  }

  if (message.type === 'PRICEMPIRE_GET_LIMITS') {
    handlePricempireLimits()
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: errorFromPricempire(err) }));
    return true;
  }

  if (message.type === 'PRICEMPIRE_CLEAR_CACHE') {
    Promise.all([storageRemove(PE_STORAGE.cache), storageRemove(PE_STORAGE.slugCache), storageRemove(PE_STORAGE.itemCache)])
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: makeError('storage_error', err.message) }));
    return true;
  }
});
