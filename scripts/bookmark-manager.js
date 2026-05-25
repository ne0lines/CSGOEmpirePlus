// Bookmark storage and state helpers

(function () {
  'use strict';

  const BOOKMARKS_KEY = 'ce_bookmarks_v1';
  const BOOKMARKS_CHANGED_EVENT = 'ce:bookmarks-changed';
  const WEBSOCKET_FEATURE_KEY = 'ce_websocket_likes_enabled';

  function parseNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function parseTimestamp(value) {
    if (value == null || value === '') return null;
    const numeric = parseNumber(value);
    if (numeric != null) return numeric > 9999999999 ? numeric : numeric * 1000;
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function isWebSocketFeatureEnabled() {
    try {
      return localStorage.getItem(WEBSOCKET_FEATURE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function firstString(...values) {
    for (const value of values) {
      if (value == null) continue;
      const text = String(value).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }

  function buildPreviewImageUrl(previewId) {
    const id = firstString(previewId);
    return id ? `https://inspect.csgoempire2.com/${encodeURIComponent(id)}.jpg` : '';
  }

  function buildSteamImageUrl(iconUrl) {
    const icon = firstString(iconUrl);
    if (!icon) return '';
    if (/^https?:\/\//i.test(icon)) return icon;
    return `https://community.steamstatic.com/economy/image/${icon.replace(/^\/+/, '')}/214x368`;
  }

  function cleanMarketName(value) {
    return firstString(value)
      .replace(/^★\s*/, '')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseBookmarkPrice(entry, existing) {
    return parseNumber(
      entry.price ??
      entry.purchase_price ??
      entry.total_value ??
      (existing && existing.price)
    );
  }

  function parseBookmarkMarketValue(entry, existing) {
    return parseNumber(
      entry.marketValue ??
      entry.market_value ??
      (entry.item && entry.item.market_value) ??
      (existing && existing.marketValue)
    );
  }

  function normalizeBookmark(entry, existing) {
    if (!entry || typeof entry !== 'object') return null;
    const id = firstString(entry.id, entry.item_id, entry.itemId);
    if (!id) return null;

    const marketName = cleanMarketName(firstString(
      entry.marketName,
      entry.market_name,
      entry.name,
      entry.item && entry.item.market_name,
      existing && existing.marketName,
      `Item ${id}`
    ));
    const previewId = firstString(entry.previewId, entry.preview_id, entry.item && entry.item.preview_id, existing && existing.previewId) || null;
    const iconUrl = firstString(
      buildSteamImageUrl(entry.iconUrl),
      buildSteamImageUrl(entry.icon_url),
      buildSteamImageUrl(entry.icon),
      buildSteamImageUrl(entry.item && entry.item.icon_url),
      existing && existing.iconUrl,
      buildPreviewImageUrl(previewId)
    );
    const price = parseBookmarkPrice(entry, existing);
    const marketValue = parseBookmarkMarketValue(entry, existing);
    const wear = parseNumber(
      entry.wear ??
      entry.float ??
      entry.float_value ??
      entry.item_float ??
      (entry.item && entry.item.wear) ??
      (existing && existing.wear)
    );
    const addedAt = parseNumber(entry.addedAt) || (existing && existing.addedAt) || Date.now();
    const sold = Object.prototype.hasOwnProperty.call(entry, 'sold')
      ? Boolean(entry.sold)
      : Boolean(existing && existing.sold);
    const soldAt = sold
      ? parseTimestamp(entry.soldAt ?? entry.sold_at ?? entry.created_at ?? entry.createdAt ?? entry.published_at) ||
        parseTimestamp(existing && existing.soldAt) ||
        Date.now()
      : null;
    const priceDeltaMarketValue = parseNumber(
      entry.priceDeltaMarketValue ??
      entry.price_delta_market_value ??
      (existing && existing.priceDeltaMarketValue)
    );
    const previousMarketValue = parseNumber(
      entry.previousMarketValue ??
      entry.previous_market_value ??
      (existing && existing.previousMarketValue)
    );
    const priceChangedAt = priceDeltaMarketValue
      ? parseTimestamp(entry.priceChangedAt ?? entry.price_changed_at) ||
        parseTimestamp(existing && existing.priceChangedAt) ||
        Date.now()
      : null;

    return {
      id,
      marketName,
      iconUrl,
      price,
      ...(marketValue == null ? {} : { marketValue }),
      wear,
      previewId,
      addedAt,
      ...(sold ? { sold: true, soldAt } : {}),
      ...(priceDeltaMarketValue ? { previousMarketValue, priceDeltaMarketValue, priceChangedAt } : {}),
    };
  }

  function readRawBookmarks() {
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function loadBookmarks() {
    const byId = new Map();
    for (const raw of readRawBookmarks()) {
      const normalized = normalizeBookmark(raw, byId.get(String(raw && raw.id)));
      if (!normalized) continue;
      byId.set(normalized.id, normalized);
    }
    return Array.from(byId.values());
  }

  function saveBookmarks(list) {
    const byId = new Map();
    for (const entry of Array.isArray(list) ? list : []) {
      const normalized = normalizeBookmark(entry, byId.get(String(entry && entry.id)));
      if (!normalized) continue;
      byId.set(normalized.id, normalized);
    }
    const bookmarks = Array.from(byId.values());
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    return bookmarks;
  }

  function dispatchChanged() {
    try {
      window.dispatchEvent(new Event(BOOKMARKS_CHANGED_EVENT));
    } catch (e) {
      // ignored in minimal test/browser contexts
    }
  }

  function buildEmpireItemUrl(id) {
    const origin = firstString(window.location && window.location.origin, 'https://csgoempire.com').replace(/\/$/, '');
    return `${origin}/api/v2/trading/item/${encodeURIComponent(id)}`;
  }

  function normalizeEmpireItemResponse(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const item = (payload.data && payload.data.item) ||
      payload.item ||
      payload.data ||
      payload;
    return item && typeof item === 'object' ? item : null;
  }

  async function fetchEmpireItem(id) {
    const fetcher = window.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetcher) return null;

    const response = await fetcher(buildEmpireItemUrl(id), {
      credentials: 'include',
    });
    if (!response || response.ok === false) {
      throw new Error(`CSGOEmpire item request failed for ${id}`);
    }
    return normalizeEmpireItemResponse(await response.json());
  }

  function hasBookmark(id) {
    return loadBookmarks().some(bookmark => bookmark.id === String(id));
  }

  function addBookmark(entry) {
    const list = loadBookmarks();
    const id = firstString(entry && entry.id, entry && entry.item_id, entry && entry.itemId);
    if (!id) return null;

    const existingIndex = list.findIndex(bookmark => bookmark.id === id);
    const existing = existingIndex >= 0 ? list[existingIndex] : null;
    const normalized = normalizeBookmark(entry, existing);
    if (!normalized) return null;

    if (existingIndex >= 0) list[existingIndex] = normalized;
    else list.push(normalized);

    saveBookmarks(list);
    dispatchChanged();
    return normalized;
  }

  function removeBookmark(id) {
    const next = loadBookmarks().filter(bookmark => bookmark.id !== String(id));
    saveBookmarks(next);
    dispatchChanged();
  }

  function markBookmarkSold(entry) {
    const list = loadBookmarks();
    const id = firstString(entry && entry.id, entry && entry.item_id, entry && entry.itemId);
    if (!id) return null;

    const existingIndex = list.findIndex(bookmark => bookmark.id === id);
    if (existingIndex < 0) return null;

    const existing = list[existingIndex];
    const normalized = normalizeBookmark({
      ...existing,
      ...entry,
      id,
      price: entry.price ?? entry.purchase_price ?? entry.total_value ?? existing.price,
      marketValue: entry.market_value ?? entry.marketValue ?? existing.marketValue,
      marketName: entry.market_name ?? entry.marketName ?? entry.name ?? existing.marketName,
      iconUrl: entry.icon_url ?? entry.iconUrl ?? entry.icon ?? existing.iconUrl,
      previewId: entry.preview_id ?? entry.previewId ?? existing.previewId,
      sold: true,
      soldAt: entry.soldAt ?? entry.sold_at ?? entry.created_at ?? entry.createdAt ?? entry.published_at ?? Date.now(),
    }, existing);
    if (!normalized) return null;

    list[existingIndex] = normalized;
    saveBookmarks(list);
    dispatchChanged();
    return normalized;
  }

  function toggleBookmark(entry) {
    const id = firstString(entry && entry.id, entry && entry.item_id, entry && entry.itemId);
    if (!id) return { saved: false, bookmark: null };
    if (hasBookmark(id)) {
      removeBookmark(id);
      return { saved: false, bookmark: null };
    }
    return { saved: true, bookmark: addBookmark(entry) };
  }

  async function addBookmarkWithItemData(entry) {
    const id = firstString(entry && entry.id, entry && entry.item_id, entry && entry.itemId);
    if (!id) return null;

    const fallback = addBookmark(entry);
    try {
      const item = await fetchEmpireItem(id);
      if (!item || !hasBookmark(id)) return fallback;
      return addBookmark({
        ...entry,
        ...item,
        id,
        marketName: firstString(item.marketName, item.market_name, entry && entry.marketName, entry && entry.name),
        iconUrl: firstString(item.iconUrl, item.icon_url, item.icon, entry && entry.iconUrl, entry && entry.icon),
        price: item.price ?? (entry && entry.price),
        marketValue: item.market_value ?? item.marketValue ?? (entry && entry.marketValue) ?? (entry && entry.market_value),
        wear: item.wear ?? item.float ?? item.float_value ?? (entry && entry.wear) ?? (entry && entry.float),
        previewId: firstString(item.previewId, item.preview_id, entry && entry.previewId, entry && entry.preview_id) || null,
        addedAt: fallback && fallback.addedAt,
      });
    } catch (e) {
      return fallback;
    }
  }

  async function toggleBookmarkWithItemData(entry) {
    const id = firstString(entry && entry.id, entry && entry.item_id, entry && entry.itemId);
    if (!id) return { saved: false, bookmark: null };
    if (hasBookmark(id)) {
      removeBookmark(id);
      return { saved: false, bookmark: null };
    }
    return { saved: true, bookmark: await addBookmarkWithItemData(entry) };
  }

  function clearAllBookmarks() {
    saveBookmarks([]);
    dispatchChanged();
  }

  function normalizeSocketEventName(event) {
    if (Array.isArray(event)) return firstString(event[0]).toLowerCase();
    if (!event || typeof event !== 'object') return '';
    return firstString(event.event, event.type, event.name).toLowerCase();
  }

  function socketEventPayload(event) {
    if (Array.isArray(event)) return event[1];
    if (!event || typeof event !== 'object') return null;
    return event.data ?? event.items ?? event.item ?? event.payload ?? null;
  }

  function collectSocketItems(payload, items) {
    if (!payload) return items;
    if (Array.isArray(payload)) {
      payload.forEach(item => collectSocketItems(item, items));
      return items;
    }
    if (typeof payload !== 'object') return items;

    if (payload.id != null || payload.item_id != null || payload.itemId != null) {
      items.push(payload);
      return items;
    }

    collectSocketItems(payload.data, items);
    collectSocketItems(payload.items, items);
    collectSocketItems(payload.item, items);
    collectSocketItems(payload.payload, items);
    return items;
  }

  function collectSocketIds(payload, ids) {
    if (payload == null) return ids;
    if (Array.isArray(payload)) {
      payload.forEach(item => collectSocketIds(item, ids));
      return ids;
    }
    if (typeof payload === 'number' || typeof payload === 'string') {
      const id = firstString(payload);
      if (id) ids.push(id);
      return ids;
    }
    if (typeof payload !== 'object') return ids;

    const id = firstString(payload.id, payload.item_id, payload.itemId);
    if (id) ids.push(id);
    collectSocketIds(payload.data, ids);
    collectSocketIds(payload.items, ids);
    collectSocketIds(payload.item, ids);
    collectSocketIds(payload.payload, ids);
    return ids;
  }

  function isSocketUpdateEvent(name) {
    return ['updated_item', 'item_update', 'item_updated', 'new_item', 'listed_item', 'price_update', 'price_updated'].includes(name);
  }

  function isSocketRemoveEvent(name) {
    return ['deleted_item', 'removed_item', 'sold_item', 'item_deleted', 'item_removed', 'item_sold'].includes(name);
  }

  function applyWebSocketBookmarkEvent(event) {
    const name = normalizeSocketEventName(event);
    const payload = socketEventPayload(event);
    const bookmarksById = new Map(loadBookmarks().map(bookmark => [bookmark.id, bookmark]));
    const likedIds = new Set(bookmarksById.keys());
    let updated = 0;
    let sold = 0;

    if (isSocketUpdateEvent(name)) {
      for (const item of collectSocketItems(payload, [])) {
        const id = firstString(item.id, item.item_id, item.itemId);
        if (!likedIds.has(id)) continue;
        const existing = bookmarksById.get(id);
        const nextMarketValue = parseNumber(item.market_value ?? item.marketValue);
        const previousMarketValue = parseNumber(existing && existing.marketValue);
        const priceChange = nextMarketValue != null && previousMarketValue != null && nextMarketValue !== previousMarketValue
          ? {
              previousMarketValue,
              priceDeltaMarketValue: nextMarketValue - previousMarketValue,
              priceChangedAt: Date.now(),
            }
          : {};
        addBookmark({
          ...item,
          id,
          price: item.price ?? item.purchase_price ?? item.total_value,
          marketValue: item.market_value ?? item.marketValue,
          marketName: item.market_name ?? item.marketName ?? item.name,
          iconUrl: item.icon_url ?? item.iconUrl ?? item.icon,
          previewId: item.preview_id ?? item.previewId,
          sold: false,
          ...priceChange,
        });
        updated += 1;
      }
    }

    if (isSocketRemoveEvent(name)) {
      const items = collectSocketItems(payload, []);
      if (!items.length) collectSocketIds(payload, []).forEach(id => items.push({ id }));

      for (const item of items) {
        const id = firstString(item.id, item.item_id, item.itemId);
        if (!likedIds.has(id)) continue;
        if (markBookmarkSold(item)) sold += 1;
      }
    }

    return { event: name, updated, sold };
  }

  function handleWebSocketBookmarkMessage(event) {
    if (!isWebSocketFeatureEnabled()) return;
    if (!event || event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'csgoempire-plus' || data.type !== 'CE_WEBSOCKET_EVENT') return;
    applyWebSocketBookmarkEvent(data.payload);
  }

  window.addEventListener('message', handleWebSocketBookmarkMessage);

  const api = {
    BOOKMARKS_KEY,
    BOOKMARKS_CHANGED_EVENT,
    normalizeBookmark,
    loadBookmarks,
    saveBookmarks,
    hasBookmark,
    addBookmark,
    removeBookmark,
    markBookmarkSold,
    toggleBookmark,
    buildPreviewImageUrl,
    buildSteamImageUrl,
    buildEmpireItemUrl,
    normalizeEmpireItemResponse,
    fetchEmpireItem,
    addBookmarkWithItemData,
    toggleBookmarkWithItemData,
    clearAllBookmarks,
    applyWebSocketBookmarkEvent,
  };

  window.ceBookmarks = api;
  window.loadBookmarks = loadBookmarks;
  window.saveBookmarks = saveBookmarks;
  window.hasBookmark = hasBookmark;
  window.addBookmark = addBookmark;
  window.removeBookmark = removeBookmark;
  window.markBookmarkSold = markBookmarkSold;
  window.toggleBookmark = toggleBookmark;
  window.addBookmarkWithItemData = addBookmarkWithItemData;
  window.toggleBookmarkWithItemData = toggleBookmarkWithItemData;
  window.clearAllBookmarks = clearAllBookmarks;
})();
