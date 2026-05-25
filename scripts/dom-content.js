// content.js (refactored)
// - Keeps your currency tooltips
// - Adds min/avg/max tablist on item pages
// - Debounces + guards runs to avoid console spam
// - Never removes or interferes with bookmarks.js UI

(function () {
  if (window.__ce_content_initialized__) return;
  window.__ce_content_initialized__ = true;

  var rCoin = 0.6142808;
  var rEur = 0;
  var rSek = 0;
  var rGbp = 0;
  var rBtc = 0;
  var itemsOld = 0;
  var lastReferralCheckTs = 0;
  var lastReferralUsers = [];
  var lastReferralDiffs = [];

  const API_PRICE_FIELDS_CENTS = [
    "purchase_price",
    "market_value",
    "auction_price",
    "auction_highest_bid",
    "total_value",
  ];
  const API_PRICE_FIELDS_RAW = ["price", "value"];
  const REFERRAL_STORAGE_PREFIX = "ce_referral_user_v1:";
  const REFERRAL_CHECK_INTERVAL_MS = 60 * 1000;

  // ------- Currency rates -------
  function readExchangeRatesObject() {
    try {
      const raw = localStorage.getItem("exchangeRates");
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && parsed.currency_exchange_rates && parsed.currency_exchange_rates.rates) ||
        (parsed && parsed.rates) ||
        null;
    } catch (e) {
      return null;
    }
  }

  function saveRates() {
    localStorage.setItem("rEur", rEur);
    localStorage.setItem("rGbp", rGbp);
    localStorage.setItem("rSek", rSek);
    localStorage.setItem("rBtc", rBtc);
  }

  function loadSavedRates() {
    const rates = getTooltipCurrencyRates();
    if (rates) {
      rCoin = rates.usdPerCoin;
      rEur = rates.eurPerUsd;
      rGbp = rates.gbpPerUsd;
      rSek = rates.sekPerUsd;
      rBtc = rates.btcRate || rBtc;
      saveRates();
      return;
    }
    rEur = parseFloat(localStorage.getItem("rEur")) || rEur;
    rGbp = parseFloat(localStorage.getItem("rGbp")) || rGbp;
    rSek = parseFloat(localStorage.getItem("rSek")) || rSek;
    rBtc = parseFloat(localStorage.getItem("rBtc")) || rBtc;
  }

  loadSavedRates();

  function getTooltipCurrencyRates() {
    const rates = readExchangeRatesObject();
    if (!rates) return null;

    const coinRate = Number(rates.CSGOEMPIRE_COIN);
    const usdRate = Number(rates.USD);
    if (!Number.isFinite(coinRate) || coinRate <= 0 || !Number.isFinite(usdRate) || usdRate <= 0) {
      return null;
    }

    return {
      usdPerCoin: usdRate / coinRate,
      eurPerUsd: Number(rates.EUR) / usdRate || 0,
      gbpPerUsd: Number(rates.GBP) / usdRate || 0,
      sekPerUsd: Number(rates.SEK) / usdRate || 0,
      btcRate: Number(rates.BTC) || 0,
    };
  }

  function convertDisplayedCurrencyToCoins(value) {
    const amount = parseNumericPrice(value);
    if (amount == null) return null;

    const currency = readSelectedCurrency();
    if (!currency || /^CSGOEMPIRE_COIN$|^COIN$|^COINS$/i.test(currency)) return amount;

    const rates = readExchangeRatesObject();
    if (!rates) return amount;

    const coinRate = Number(rates.CSGOEMPIRE_COIN);
    const currencyRate = Number(rates[currency]);
    if (!Number.isFinite(coinRate) || coinRate <= 0 || !Number.isFinite(currencyRate) || currencyRate <= 0) {
      return amount;
    }

    return (amount / currencyRate) * coinRate;
  }

  function updateCurrencyAndHighlights() {
    const rates = getTooltipCurrencyRates();
    if (!rates) return;

    $('div[data-testid=currency-value]:not(:has(.plusCurrency))').each(function () {
      if ($(this).closest(".trophy-card-container").length < 1) {
        const raw = $(this).text();
        if (!raw) return;

        const vCoins = convertDisplayedCurrencyToCoins(raw);
        if (!Number.isFinite(vCoins)) return;

        const vDollar = vCoins * rates.usdPerCoin;
        const vEuro = vDollar * rates.eurPerUsd;
        const vGbp = vDollar * rates.gbpPerUsd;
        const vSek = vDollar * rates.sekPerUsd;
        const fmt = (n) => Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

        $(this).attr(
          "title",
          "USD:\t$" +
            fmt(vDollar) +
            "\nEUR:\t€" +
            fmt(vEuro) +
            "\nGBP:\t£" +
            fmt(vGbp) +
            "\nSEK:\t" +
            fmt(vSek) +
            "kr"
        );
      }
    });
  }

  // Listen for messages from injected page context (unchanged)
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "csgoempire-extension") return;
    const items = event.data.payload?.data || event.data.payload || [];
    // No spammy logs
    // console.log("[Content.js] Extracted items:", items);
  }, { passive: true });

  // ---------- Helpers for tablist ----------
  async function getPricesFromDOM({ tries = 8, delayMs = 200 } = {}) {
    for (let i = 0; i < tries; i++) {
      const prices = [];
      // Similar items + the main item price block
      $(
        "div.for-sale div[data-testid=currency-value] span:last-child, div.main-item-info div[data-testid=currency-value]:first span:last-child"
      ).each(function () {
        const raw = $(this).text();
        const clean = raw.replace(/,/g, "");
        const val = parseFloat(clean);
        if (Number.isFinite(val)) prices.push(val);
      });

      if (prices.length > 0) return prices;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return [];
  }

  function getCurrentItemId() {
    const path = String(window.location && window.location.pathname || "");
    const match = path.match(/\/(?:trading\/)?item\/(\d+)/);
    return match ? match[1] : "";
  }

  function parseNumericPrice(value) {
    if (value == null || value === "") return null;
    const number = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function normalizeApiPrice(value, field) {
    const number = parseNumericPrice(value);
    if (number == null) return null;
    return API_PRICE_FIELDS_CENTS.includes(field) ? Number((number / 100).toFixed(6)) : number;
  }

  function firstObjectPrice(object) {
    if (!object || typeof object !== "object") return null;
    for (const field of API_PRICE_FIELDS_CENTS) {
      if (object[field] != null) return normalizeApiPrice(object[field], field);
    }
    for (const field of API_PRICE_FIELDS_RAW) {
      if (object[field] != null) return normalizeApiPrice(object[field], field);
    }
    return null;
  }

  function unwrapItemResponse(payload) {
    if (!payload || typeof payload !== "object") return null;
    const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
    return data && typeof data === "object" ? data : null;
  }

  function collectListingPrices(input, prices) {
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach(entry => {
        const price = firstObjectPrice(entry);
        if (price != null) prices.push(price);
      });
      return;
    }
    if (typeof input !== "object") return;

    Object.entries(input).forEach(([key, value]) => {
      if (/historic|history|sold/i.test(key)) return;
      if (Array.isArray(value)) {
        collectListingPrices(value, prices);
      } else if (value && typeof value === "object") {
        collectListingPrices(value, prices);
      }
    });
  }

  function collectPricesFromItemResponse(payload) {
    const data = unwrapItemResponse(payload);
    if (!data) return [];

    const prices = [];
    const item = data.item && typeof data.item === "object" ? data.item : data;
    const mainPrice = firstObjectPrice(item);
    if (mainPrice != null) prices.push(mainPrice);

    collectListingPrices(
      data.similar_listings || data.similarListings || data.similar_items || data.similarItems,
      prices
    );

    return prices.filter((price) => Number.isFinite(price));
  }

  async function getPricesFromAPI() {
    const itemId = getCurrentItemId();
    if (!itemId) return [];

    try {
      const origin = String(window.location && window.location.origin || "https://csgoempire.com").replace(/\/$/, "");
      const res = await fetch(`${origin}/api/v2/trading/item/${encodeURIComponent(itemId)}`, {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) throw new Error(`Item API ${res.status}`);
      return collectPricesFromItemResponse(await res.json());
    } catch (e) {
      console.warn("[Content.js] item price API failed:", e);
      return [];
    }
  }

  function computeStats(list) {
    if (!list || !list.length) return null;
    let min = Infinity,
      max = -Infinity,
      sum = 0,
      count = 0;
    for (const n of list) {
      if (!Number.isFinite(n)) continue;
      if (n < min) min = n;
      if (n > max) max = n;
      sum += n;
      count++;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || count === 0) return null;
    return { min, avg: sum / count, max, count };
  }

  function readSelectedCurrency() {
    let raw = null;
    try {
      raw = localStorage.getItem("currency");
    } catch (e) {
      return "";
    }
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") raw = parsed;
      else if (parsed && typeof parsed === "object") raw = parsed.currency || parsed.code || parsed.value || "";
    } catch (e) {
      // Plain string values are expected.
    }
    return String(raw || "").replace(/\s+/g, " ").trim().toUpperCase();
  }

  function readStoredExchangeRates() {
    try {
      const raw = localStorage.getItem("exchangeRates");
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && parsed.currency_exchange_rates && parsed.currency_exchange_rates.rates) ||
        (parsed && parsed.rates) ||
        parsed ||
        null;
    } catch (e) {
      return null;
    }
  }

  function getCurrencySignature() {
    let rawRates = "";
    try {
      rawRates = localStorage.getItem("exchangeRates") || "";
    } catch (e) {
      rawRates = "";
    }
    return `${readSelectedCurrency()}|${rawRates}`;
  }

  function convertCoinsToSelectedCurrency(value) {
    const coins = parseNumericPrice(value);
    if (coins == null) return null;

    const currency = readSelectedCurrency();
    const rates = readStoredExchangeRates();
    if (!currency || /^CSGOEMPIRE_COIN$|^COIN$|^COINS$/i.test(currency)) return coins;
    if (!rates) return null;

    const coinRate = parseNumericPrice(rates.CSGOEMPIRE_COIN);
    const currencyRate = parseNumericPrice(rates[currency]);
    if (coinRate == null || currencyRate == null || coinRate <= 0) return null;
    return (coins / coinRate) * currencyRate;
  }

  function renderTablist({ min, avg, max }) {
    const format = (num) => {
      const converted = convertCoinsToSelectedCurrency(num);
      if (converted == null) return null;
      return Number(converted)
        .toFixed(2)
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };
    const minText = format(min);
    const avgText = format(avg);
    const maxText = format(max);
    if (minText == null || avgText == null || maxText == null) return false;

    // Create container if missing (same structure you used)
    if ($("div#2ndtablist").length === 0) {
      const $anchorRow = $("h3:contains('Similar items') + div").children("div").eq(0);
      if ($anchorRow.length) {
        $anchorRow.after(
          "<div role='tablist' id='2ndtablist' aria-orientation='horizontal' class='h-[38px] bg-dark-4 justify-between rounded-full p-xs inline-flex'></div>"
        );
      } else {
        return false;
      }
    }

    const $tab = $("div#2ndtablist");
    if ($tab.length === 0) return false;

    // Idempotent update
    $tab.empty();
    $tab.append(
      "<button class='flex h-full cursor-default items-center justify-center px-[12px] py-md transition-colors transition-opacity duration-100 hover:bg-dark-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30 ui-not-selected:text-light-2 rounded-full ui-selected:bg-dark-2 ui-selected:text-light-1' role='tab' type='button' style='background-color:#01bf4d1a;'><h4 style='color:#01bf4d;font-weight:900;' title='Lowest price'>" +
        minText +
        "</h4></button>"
    );
    $tab.append(
      "<button class='flex h-full cursor-default items-center justify-center px-[12px] py-md transition-colors transition-opacity duration-100 hover:bg-dark-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30 ui-not-selected:text-light-2 rounded-full ui-selected:bg-dark-2 ui-selected:text-light-1' role='tab' type='button'><h4 style='font-weight:500;' title='Average price'>" +
        avgText +
        "</h4></button>"
    );
    $tab.append(
      "<button class='flex h-full cursor-default items-center justify-center px-[12px] py-md transition-colors transition-opacity duration-100 hover:bg-dark-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30 ui-not-selected:text-light-2 rounded-full ui-selected:bg-dark-2 ui-selected:text-light-1' role='tab' type='button' style='background-color:#ff5c5c1a;'><h4 style='color:#ff5c5c;font-weight:900;' title='Highest price'>" +
        maxText +
        "</h4></button>"
    );
    return true;
  }

  // ---------- Orchestrator with guards ----------
  let __statsLastHash = null;
  let __runLock = false;
  let __lastRunTs = 0;
  let __pendingStats = null;
  let __renderRetryTimer = null;
  let __lastStats = null;
  let __lastCurrencySignature = getCurrencySignature();
  const RUN_MIN_GAP_MS = 8000; // don’t recompute more often than every 8s

  function hashStats(s) {
    if (!s) return "";
    return [
      Math.round(s.min * 100),
      Math.round(s.avg * 100),
      Math.round(s.max * 100),
      s.count,
      getCurrencySignature(),
    ].join("|");
  }

  function isItemPagePath() {
    return String(window.location && window.location.pathname || "").includes("/item/");
  }

  function schedulePendingStatsRender() {
    if (__renderRetryTimer || !__pendingStats) return;
    __renderRetryTimer = setTimeout(() => {
      __renderRetryTimer = null;
      if (!isItemPagePath() || !__pendingStats) return;
      if (renderTablist(__pendingStats)) {
        __statsLastHash = hashStats(__pendingStats);
        __pendingStats = null;
      } else {
        schedulePendingStatsRender();
      }
    }, 500);
  }

  function renderStatsWhenReady(stats) {
    if (!renderTablist(stats)) {
      __pendingStats = stats;
      schedulePendingStatsRender();
      return false;
    }
    __pendingStats = null;
    return true;
  }

  function rerenderTablistIfCurrencyChanged() {
    const signature = getCurrencySignature();
    if (signature === __lastCurrencySignature) return;
    __lastCurrencySignature = signature;
    if (!__lastStats || !isItemPagePath()) return;
    if (renderStatsWhenReady(__lastStats)) {
      __statsLastHash = hashStats(__lastStats);
    }
  }

  function parseReferralNumber(value) {
    const parsed = parseFloat(String(value == null ? "" : value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatReferralLastSeen(timestamp, nowMs) {
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const diffMs = Math.max(0, now - seconds * 1000);
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (days <= 0) return "Today";
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  }

  function hasReferralReturnedAfterTwoDays(user) {
    const lastSeen = Number(user && user.last_seen);
    const referralSince = Number(user && user.referral_since);
    if (!Number.isFinite(lastSeen) || !Number.isFinite(referralSince)) return false;
    return lastSeen - referralSince > 2 * 24 * 60 * 60;
  }

  function shouldMarkReferralNotReturned(user) {
    const lastSeen = Number(user && user.last_seen);
    const referralSince = Number(user && user.referral_since);
    if (!Number.isFinite(referralSince) || referralSince <= 0) return false;
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) return true;
    return !hasReferralReturnedAfterTwoDays(user);
  }

  function sanitizeReferralName(name) {
    return String(name || "").trim().replace(/[^a-zA-Z0-9\s]/g, "_");
  }

  function getReferralIdentity(user) {
    const steamId = String(user && user.steam_id || "").trim();
    const userId = String(user && user.user_id || "").trim();
    const name = String(user && user.name || "").trim();
    return {
      key: steamId ? `steam:${steamId}` : userId ? `user:${userId}` : name ? `name:${sanitizeReferralName(name)}` : "",
      steamId,
      userId,
      name,
    };
  }

  function readReferralSnapshot(storageKey, user) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (e) {
      // ignore corrupt entries
    }

    const legacyName = sanitizeReferralName(user && user.name);
    if (!legacyName) return null;

    const wagered = parseFloat(localStorage.getItem(`wagered_${legacyName}`));
    const commission = parseFloat(localStorage.getItem(`commission_${legacyName}`));
    if (!Number.isFinite(wagered) && !Number.isFinite(commission)) return null;
    return {
      wagered: Number.isFinite(wagered) ? wagered : 0,
      commission: Number.isFinite(commission) ? commission : 0,
      legacy: true,
    };
  }

  function writeReferralSnapshot(storageKey, user, wagered, commission) {
    const identity = getReferralIdentity(user);
    localStorage.setItem(storageKey, JSON.stringify({
      steamId: identity.steamId || null,
      userId: identity.userId || null,
      name: identity.name || null,
      wagered,
      commission,
      lastSeen: Number(user && user.last_seen) || null,
      referralSince: Number(user && user.referral_since) || null,
      updatedAt: Date.now(),
    }));
  }

  function buildReferralUserUrl(page) {
    const origin = String(window.location && window.location.origin || "https://csgoempire.com").replace(/\/$/, "");
    return `${origin}/api/v2/referrals/referred-users?per_page=100&page=${page}`;
  }

  async function fetchReferredUsers() {
    const users = [];
    let page = 1;
    let lastPage = 1;
    do {
      const response = await fetch(buildReferralUserUrl(page), {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!response.ok) throw new Error(`Referred users ${response.status}`);
      const json = await response.json();
      if (Array.isArray(json && json.data)) users.push(...json.data);
      lastPage = Math.max(1, parseInt(json && json.last_page, 10) || page);
      page += 1;
    } while (page <= lastPage && page <= 20);
    return users;
  }

  function updateReferralSnapshots(users) {
    const diffs = [];
    users.forEach(user => {
      const identity = getReferralIdentity(user);
      if (!identity.key) return;

      const wagered = parseReferralNumber(user.total_wagered);
      const commission = parseReferralNumber(user.total_commission);
      const storageKey = `${REFERRAL_STORAGE_PREFIX}${identity.key}`;
      const previous = readReferralSnapshot(storageKey, user);

      writeReferralSnapshot(storageKey, user, wagered, commission);

      if (!previous) return;
      const wageredDiff = Number((wagered - parseReferralNumber(previous.wagered)).toFixed(2));
      const commissionDiff = Number((commission - parseReferralNumber(previous.commission)).toFixed(2));
      const previousLastSeen = Number(previous.lastSeen);
      const currentLastSeen = Number(user && user.last_seen);
      const lastSeenImproved = Number.isFinite(previousLastSeen) &&
        Number.isFinite(currentLastSeen) &&
        currentLastSeen > previousLastSeen;
      if (wageredDiff > 0 || commissionDiff > 0 || lastSeenImproved) {
        diffs.push(Object.assign({}, identity, { wageredDiff, commissionDiff, lastSeenImproved }));
      }
    });
    return diffs;
  }

  function findReferralDiffForRow(row, diffs) {
    const rowText = String(row.text ? row.text() : "").trim();
    return diffs.find(diff => diff.name && rowText.includes(diff.name)) || null;
  }

  function findReferralUserForRow(row, users) {
    const rowText = String(row.text ? row.text() : "").trim();
    return users.find(user => user && user.name && rowText.includes(String(user.name).trim())) || null;
  }

  function findReferralLastSeenElement(row) {
    const exact = row.find('[data-label="Last Seen"] div:last, [data-label="Last seen"] div:last, [data-label="Last Activity"] div:last, [data-label="Last activity"] div:last');
    if (exact.length) return exact;

    const root = row && row[0];
    if (!root || typeof root.querySelectorAll !== "function") return exact;

    const bucketPattern = /^(today|yesterday|this\s+(week|month|year)|last\s+(week|month|year)|\d+\s+(day|days|week|weeks|month|months|year|years)\s+ago)$/i;
    const nodes = Array.from(root.querySelectorAll("[data-label], td, span, p, div"))
      .filter(node => {
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
        return bucketPattern.test(text);
      })
      .sort((a, b) => a.children.length - b.children.length);

    return nodes[0] ? $(nodes[0]) : exact;
  }

  function linkReferralSteamProfile(row, user) {
    const steamId = String(user && user.steam_id || "").trim();
    const name = String(user && user.name || "").trim();
    const root = row && row[0];
    if (!steamId || !name || !root || typeof root.querySelectorAll !== "function") return;

    const profileUrl = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`;
    const nodes = Array.from(root.querySelectorAll("a, span, p, div, td"))
      .filter(node => String(node.textContent || "").replace(/\s+/g, " ").trim().includes(name))
      .sort((a, b) => a.children.length - b.children.length);
    const target = nodes[0];
    if (!target) return;

    if (String(target.tagName || "").toUpperCase() === "A") {
      target.setAttribute("href", profileUrl);
      target.setAttribute("target", "_blank");
      target.setAttribute("rel", "noopener noreferrer");
      return;
    }

    if (target.__ceSteamProfileLinked) return;
    const link = document.createElement("a");
    link.href = profileUrl;
    link.setAttribute("href", profileUrl);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.className = "ce-referral-steam-link";
    link.textContent = target.textContent;
    target.textContent = "";
    if (typeof target.appendChild === "function") {
      target.appendChild(link);
      target.__ceSteamProfileLinked = true;
    }
  }

  function annotateReferralTable(users, diffs) {
    const referralTable = $("table.referred-users-table, table:has([data-label='Total Wagered']), table:has([data-label='Comission Generated']), table:has([data-label='Commission Generated'])");
    if (!referralTable.length) return;

    referralTable.find("tr").each(function () {
      const row = $(this);
      const user = findReferralUserForRow(row, users || []);
      const diff = findReferralDiffForRow(row, diffs);

      const wageredElement = row.find('[data-label="Total Wagered"] div[data-testid="currency-value"] span:last-child');
      const commissionElement = row.find('[data-label="Comission Generated"] div[data-testid="currency-value"] span:last-child, [data-label="Commission Generated"] div[data-testid="currency-value"] span:last-child');
      const lastSeenElement = findReferralLastSeenElement(row);

      if (user) {
        linkReferralSteamProfile(row, user);
      }
      if (user && lastSeenElement.length) {
        const lastSeenText = formatReferralLastSeen(user.last_seen);
        if (lastSeenText) lastSeenElement.text(lastSeenText);
      }
      if (diff && diff.lastSeenImproved) {
        row.addClass('ce-referral-returned');
      }
      if (user && shouldMarkReferralNotReturned(user)) {
        row.addClass('ce-referral-delayed-return');
      }
      if (diff && diff.wageredDiff > 0 && wageredElement.length) {
        wageredElement.after(`<span class="text-green-1 ce-referral-diff"> (+${diff.wageredDiff.toFixed(2)})</span>`);
      }
      if (diff && diff.commissionDiff > 0 && commissionElement.length) {
        commissionElement.after(`<span class="text-green-1 ce-referral-diff"> (+${diff.commissionDiff.toFixed(2)})</span>`);
      }
    });
  }

  async function refreshReferralEarnings(force) {
    const path = String(window.location && window.location.pathname || "");
    if (!path.includes("/referrals/dashboard")) return [];
    const now = Date.now();
    if (!force && now - lastReferralCheckTs < REFERRAL_CHECK_INTERVAL_MS) {
      annotateReferralTable(lastReferralUsers, lastReferralDiffs);
      return lastReferralDiffs;
    }
    lastReferralCheckTs = now;

    const users = await fetchReferredUsers();
    const diffs = updateReferralSnapshots(users);
    lastReferralUsers = users;
    lastReferralDiffs = diffs;
    annotateReferralTable(users, diffs);
    return diffs;
  }

  async function runHighLowAvgLogic() {
    const now = Date.now();
    if (__runLock) return;
    if (now - __lastRunTs < RUN_MIN_GAP_MS) return;
    __runLock = true;
    let shouldThrottle = true;

    try {
      // 1) Prefer CSGOEmpire's item endpoint for the page's own data.
      let prices = await getPricesFromAPI();

      // 2) Fallback to DOM if the endpoint shape does not contain listing prices.
      if (prices.length < 1) {
        prices = await getPricesFromDOM({ tries: 8, delayMs: 200 });
      }

      if (!prices.length) return;

      const stats = computeStats(prices);
      if (!stats) return;
      __lastStats = stats;

      const newHash = hashStats(stats);
      if (newHash !== __statsLastHash || $("div#2ndtablist").length === 0) {
        if (!renderStatsWhenReady(stats)) {
          shouldThrottle = false;
          return;
        }
        __statsLastHash = newHash;
      }
    } catch (e) {
      console.warn("[Content.js] runHighLowAvgLogic error:", e);
    } finally {
      if (shouldThrottle) __lastRunTs = Date.now();
      __runLock = false;
    }
  }

  window.__ceDomContentTest = {
    getCurrentItemId,
    collectPricesFromItemResponse,
    getPricesFromAPI,
    computeStats,
    runHighLowAvgLogic,
    convertCoinsToSelectedCurrency,
    convertDisplayedCurrencyToCoins,
    rerenderTablistIfCurrencyChanged,
    getReferralIdentity,
    updateReferralSnapshots,
    refreshReferralEarnings,
    updateCurrencyAndHighlights,
    formatReferralLastSeen,
    hasReferralReturnedAfterTwoDays,
    shouldMarkReferralNotReturned,
    annotateReferralTable,
  };

  // ---------- Route watch (no spam) ----------
  let __lastPathSeen = "";
  function watchItemPageChanges() {
    setInterval(() => {
      const currentPath = window.location.pathname;
      if (currentPath === __lastPathSeen) return;
      __lastPathSeen = currentPath;

      if (currentPath.includes("/item/")) {
        runHighLowAvgLogic(); // fire once on nav
      } else {
        $("#2ndtablist").remove();
      }
    }, 300);
  }

  // ---------- Optional DOM-triggered refresh ----------
  // If Similar items list re-renders, try once more (debounced by run lock)
  const simObserver = new MutationObserver(() => {
    if (window.location.pathname.includes("/item/")) {
      runHighLowAvgLogic();
    }
  });
  function attachSimilarItemsObserver() {
    const holder = $("h3:contains('Similar items') + div")[0];
    if (holder) {
      simObserver.disconnect();
      simObserver.observe(holder, { childList: true, subtree: true });
    }
  }

  $(document).ready(function () {
    setTimeout(function () {
      watchItemPageChanges();
      attachSimilarItemsObserver();
      refreshReferralEarnings(true).catch(err => console.warn("[Content.js] referral earnings failed:", err));
    }, 400);

    setInterval(function () {
      updateCurrencyAndHighlights();
      rerenderTablistIfCurrencyChanged();
      refreshReferralEarnings(false).catch(err => console.warn("[Content.js] referral earnings failed:", err));
    }, 2000);

    // If already on an item page when the extension loads, populate the tablist
    if (window.location.pathname.includes("/item/")) {
      runHighLowAvgLogic();
    }
  });

})();
