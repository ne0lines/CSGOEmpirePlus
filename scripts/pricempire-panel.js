(function () {
  'use strict';

  if (window.top !== window) return;
  if (window.__ce_pricempire_panel__) return;
  window.__ce_pricempire_panel__ = true;

  const utils = window.cePricempire;
  const PANEL_ID = 'ce-pricempire-panel';
  const RATES_CACHE_KEY = 'ce_exchange_rates_v1';
  const RATES_TTL_MS = 60 * 60 * 1000;
  const ANALYSIS_CACHE_KEY = 'ce_pricempire_analysis_cache_v1';
  const ANALYSIS_CACHE_TTL_MS = 30 * 60 * 1000;
  const SALES_VISIBLE_KEY = 'ce_pricempire_sales_visible';
  const CONTEXT_RELOAD_KEY_PREFIX = 'ce_pricempire_context_reloaded:';
  const DEFAULT_CHART_PRESET = utils.DEFAULT_CHART_PRESET || '30d';
  const PENDING_SPINNER_HTML = `
    <div class="ce-pe-preloader" aria-hidden="true">
      <div class="ce-pe-preloader-spinner"></div>
      <img class="ce-pe-preloader-logo" src="/icons/logo-preloader.svg" alt="">
    </div>
  `;
  let lastItemId = null;
  let runTimer = null;
  let currentChart = null;
  let placementObserver = null;
  let saleAnnotationsVisible = readStoredSalesAnnotationsVisible();
  let runSequence = 0;
  let lastRouteKey = '';

  function getItemIdFromPath() {
    const match = window.location.pathname.match(/\/item\/(\d+)/);
    return match ? match[1] : null;
  }

  function getRouteKey() {
    return `${window.location.pathname || ''}${window.location.search || ''}`;
  }

  function readStoredSalesAnnotationsVisible() {
    try {
      return localStorage.getItem(SALES_VISIBLE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function writeStoredSalesAnnotationsVisible(visible) {
    try {
      localStorage.setItem(SALES_VISIBLE_KEY, visible ? 'true' : 'false');
    } catch (e) {
      console.warn('[Pricempire] sales toggle state write failed:', e);
    }
  }

  function getAnalysisCacheKey(marketName) {
    return String(marketName || '').trim().toLowerCase();
  }

  function readAnalysisCache() {
    try {
      const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      return cache && typeof cache === 'object' ? cache : {};
    } catch (e) {
      return {};
    }
  }

  function writeAnalysisCache(cache) {
    try {
      localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('[Pricempire] analysis cache write failed:', e);
    }
  }

  function getCachedAnalysis(marketName) {
    const key = getAnalysisCacheKey(marketName);
    if (!key) return null;
    const cache = readAnalysisCache();
    const entry = cache[key];
    if (!entry || !entry.expiresAt || entry.expiresAt <= Date.now()) {
      if (entry) {
        delete cache[key];
        writeAnalysisCache(cache);
      }
      return null;
    }
    return entry.value || null;
  }

  function setCachedAnalysis(marketName, value) {
    const key = getAnalysisCacheKey(marketName);
    if (!key || !value) return;
    const cache = readAnalysisCache();
    cache[key] = {
      value,
      expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS,
    };
    writeAnalysisCache(cache);
  }

  function fetchJson(path) {
    const url = new URL(path, window.location.origin);
    return fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    }).then(async response => {
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
      if (!response.ok) {
        const err = new Error(`CSGOEmpire HTTP ${response.status}`);
        err.status = response.status;
        err.body = body;
        throw err;
      }
      return body;
    });
  }

  function isExtensionContextInvalidatedError(err) {
    const message = String(err && err.message ? err.message : err || '').toLowerCase();
    return message.includes('extension context invalidated') || message.includes('context invalidated');
  }

  function contextReloadStorageKey() {
    return `${CONTEXT_RELOAD_KEY_PREFIX}${getRouteKey() || getItemIdFromPath() || 'item'}`;
  }

  function clearInvalidatedContextReloadFlag() {
    try {
      sessionStorage.removeItem(contextReloadStorageKey());
    } catch (e) {
      // ignore
    }
  }

  function reloadAfterInvalidatedContext() {
    let shouldReload = true;
    try {
      const key = contextReloadStorageKey();
      shouldReload = sessionStorage.getItem(key) !== 'true';
      if (shouldReload) sessionStorage.setItem(key, 'true');
    } catch (e) {
      shouldReload = false;
    }

    if (!shouldReload || !window.location || typeof window.location.reload !== 'function') return false;
    window.location.reload();
    return true;
  }

  function handleInvalidatedContext(err) {
    console.warn('[Pricempire] extension context invalidated, reloading item page:', err);
    if (reloadAfterInvalidatedContext()) return;
    renderState('error', 'Reload the page to reconnect the extension.');
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
          reject(new Error('Extension runtime unavailable.'));
          return;
        }

        chrome.runtime.sendMessage(message, response => {
          let lastError = null;
          try {
            lastError = chrome.runtime && chrome.runtime.lastError;
          } catch (err) {
            reject(err);
            return;
          }
          if (lastError) {
            reject(new Error(lastError.message || String(lastError)));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function deepFind(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    const lowerKeys = new Set(keys.map(k => k.toLowerCase()));
    const queue = [obj];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      for (const [key, value] of Object.entries(current)) {
        if (lowerKeys.has(key.toLowerCase()) && value != null && value !== '') return value;
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return null;
  }

  function extractDomMarketName() {
    const selectors = [
      '.item-page h2',
      '.item-page h1',
      'h1',
      'h2',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el && el.textContent ? el.textContent.trim() : '';
      if (text && !/similar items/i.test(text)) return text;
    }
    return '';
  }

  function extractDomPrice() {
    const candidates = document.querySelectorAll(
      'div.main-item-info div[data-testid=currency-value] span:last-child, div.item-page div[data-testid=currency-value] span:last-child'
    );
    for (const el of candidates) {
      const value = utils.parseNumber(el.textContent);
      if (value != null) return value;
    }
    return null;
  }

  function normalizeItemResponse(json) {
    const item = json && (json.data || json.item || json);
    const marketName = deepFind(item, ['market_name', 'marketName', 'name']) || extractDomMarketName();
    const empirePrice = utils.parseNumber(deepFind(item, ['purchase_price', 'market_value', 'price', 'auction_price'])) ?? extractDomPrice();
    return {
      marketName: marketName ? String(marketName).trim() : '',
      empirePrice,
      raw: item,
    };
  }

  async function getItem(itemId) {
    try {
      return normalizeItemResponse(await fetchJson(`/api/v2/trading/item/${itemId}`));
    } catch (err) {
      console.warn('[Pricempire] item endpoint failed, falling back to DOM:', err);
      return { marketName: extractDomMarketName(), empirePrice: extractDomPrice(), raw: null };
    }
  }

  async function getSales(itemId) {
    try {
      const json = await fetchJson(`/api/v2/trading/item/${itemId}/sales`);
      return utils.normalizeSalesEvents(json);
    } catch (err) {
      console.warn('[Pricempire] sales endpoint failed:', err);
      return [];
    }
  }

  async function getExchangeRates() {
    const cachedRaw = localStorage.getItem(RATES_CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached.expiresAt && cached.expiresAt > Date.now()) return cached.rates;
      } catch (e) { /* ignore */ }
    }

    try {
      const json = await fetchJson('/api/v2/metadata/exchange-rates');
      const rates = utils.normalizeExchangeRates(json);
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ rates, expiresAt: Date.now() + RATES_TTL_MS }));
      return rates;
    } catch (err) {
      console.warn('[Pricempire] exchange-rates endpoint failed:', err);
      return utils.normalizeExchangeRates({ USD: 1 });
    }
  }

  function findSimilarItemsAnchor() {
    const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,section,div'))
      .filter(el => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text.length <= 80 && /\bsimilar\s+items\b/i.test(text);
      });

    for (const el of candidates) {
      if (el.id === PANEL_ID || el.closest(`#${PANEL_ID}`)) continue;
      let current = el;
      while (current && current.parentElement && current.parentElement !== document.body) {
        const parent = current.parentElement;
        if (parent.matches('.item-page, main') || parent.children.length > 1) return current;
        current = parent;
      }
      return el;
    }
    return null;
  }

  function placePanel(panel) {
    const similarAnchor = findSimilarItemsAnchor();
    if (similarAnchor && similarAnchor.parentNode && similarAnchor !== panel) {
      if (similarAnchor.previousElementSibling !== panel) {
        similarAnchor.parentNode.insertBefore(panel, similarAnchor);
      }
      return;
    }

    const anchor = document.querySelector('.item-page .main-item-info') ||
      document.querySelector('.item-page') ||
      document.querySelector('main') ||
      document.body;

    if (anchor && anchor.parentNode && anchor !== document.body) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } else {
      document.body.prepend(panel);
    }
  }

  function keepPanelAboveSimilarItems() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !getItemIdFromPath()) return;

    const similarAnchor = findSimilarItemsAnchor();
    if (!similarAnchor || !similarAnchor.parentNode || similarAnchor.previousElementSibling === panel) return;
    similarAnchor.parentNode.insertBefore(panel, similarAnchor);
  }

  function observePanelPlacement() {
    if (placementObserver || typeof MutationObserver !== 'function') return;
    const root = document.body || document.documentElement;
    if (!root) return;

    placementObserver = new MutationObserver(keepPanelAboveSimilarItems);
    placementObserver.observe(root, { childList: true, subtree: true });
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      placePanel(panel);
      return panel;
    }

    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'ce-pe-panel';
    placePanel(panel);
    return panel;
  }

  function destroyCurrentChart() {
    if (!currentChart) return;
    try {
      currentChart.destroy();
    } catch (e) {
      console.warn('[Pricempire] ApexCharts destroy failed:', e);
    }
    currentChart = null;
  }

  function renderState(kind, message) {
    destroyCurrentChart();
    const panel = ensurePanel();
    panel.innerHTML = `<div class="ce-pe-state ce-pe-${kind}">${escapeHtml(message)}</div>`;
  }

  function renderPendingChartContainer() {
    destroyCurrentChart();
    const panel = ensurePanel();
    panel.innerHTML = `<div class="ce-pe-chart-wrap ce-pe-chart-pending">${PENDING_SPINNER_HTML}</div>`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  function formatMoney(value, currency) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    if (currency === 'BTC') return `${number.toFixed(8)} BTC`;
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'SEK' ? 0 : 2,
    }).format(number);
  }

  function buildChartPayload(chartRaw, salesRaw, settings, rates) {
    const normalizedRates = utils.normalizeExchangeRates(rates || {});
    const rate = normalizedRates[settings.currency] || 1;
    const chart = utils.filterPointsByRange(utils.normalizeChartPoints(chartRaw), settings.chartRange)
      .map(point => {
        const value = Number(point.value);
        if (!Number.isFinite(value)) return null;
        return Object.assign({}, point, {
          displayValue: Number((value * rate).toFixed(6)),
          count: point.count ?? (point.raw && point.raw.count),
        });
      })
      .filter(Boolean);
    const sales = utils.filterPointsByRange(salesRaw, settings.chartRange)
      .map(point => {
        const displayValue = utils.convertEmpireCoins(point.value, settings.currency, normalizedRates);
        if (!Number.isFinite(displayValue)) return null;
        return Object.assign({}, point, { displayValue });
      })
      .filter(Boolean);
    return {
      chart,
      sales,
      hasData: Boolean(chart.length || sales.length),
    };
  }

  function renderChart(chartRaw, salesRaw, settings, rates) {
    const payload = buildChartPayload(chartRaw, salesRaw, settings, rates);
    if (!payload.hasData) return '<div class="ce-pe-empty">No chart data available.</div>';
    const presets = Array.isArray(utils.CHART_PRESETS) ? utils.CHART_PRESETS : [];

    return `
      <div class="ce-pe-chart-wrap ce-pe-fade-in">
        <div class="ce-pe-chart-controls">
          <div class="ce-pe-range-tabs" role="tablist" aria-label="Chart range">
            ${presets.map(preset => `
              <button
                class="ce-pe-preset${preset.value === DEFAULT_CHART_PRESET ? ' is-active' : ''}"
                type="button"
                role="tab"
                aria-selected="${preset.value === DEFAULT_CHART_PRESET ? 'true' : 'false'}"
                data-ce-pe-preset="${escapeHtml(preset.value)}"
              >${escapeHtml(preset.label)}</button>
            `).join('')}
          </div>
          <button
            class="ce-pe-sales-switch${saleAnnotationsVisible ? ' is-active' : ''}"
            type="button"
            role="switch"
            aria-checked="${saleAnnotationsVisible ? 'true' : 'false'}"
          >
            <span class="ce-pe-sales-label">Recently sold</span>
            <span class="toggle cursor-pointer rounded-full p-xs${saleAnnotationsVisible ? ' enabled bg-green-2' : ' bg-dark-6'}">
              <span class="ball flex items-center justify-center rounded-full ${saleAnnotationsVisible ? 'bg-light-1' : 'bg-light-2'}"></span>
            </span>
          </button>
        </div>
        <div id="ce-pe-apex-chart" class="ce-pe-apex-chart" role="img" aria-label="Pricempire chart with CSGOEmpire sales events"></div>
      </div>
    `;
  }

  function chartPreset(value) {
    return utils.normalizeChartPreset ? utils.normalizeChartPreset(value) : DEFAULT_CHART_PRESET;
  }

  function expandFlatWindow(view) {
    if (!view || !Number.isFinite(view.min) || !Number.isFinite(view.max)) return null;
    if (view.min !== view.max) return view;
    const day = 24 * 60 * 60 * 1000;
    return { min: view.min - day, max: view.max + day };
  }

  function getChartWindow(payload, preset) {
    const points = (payload.chart || []).concat(payload.sales || []);
    const view = utils.getChartPresetWindow ? utils.getChartPresetWindow(points, preset) : null;
    return expandFlatWindow(view);
  }

  function setActivePreset(preset) {
    const selected = chartPreset(preset);
    document.querySelectorAll(`#${PANEL_ID} .ce-pe-preset`).forEach(button => {
      const active = button.dataset.cePePreset === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function applyChartPreset(preset, payload) {
    const selected = chartPreset(preset);
    const view = getChartWindow(payload, selected);
    if (!currentChart || !view) return;

    if (typeof currentChart.zoomX === 'function') {
      currentChart.zoomX(view.min, view.max);
    } else if (typeof currentChart.updateOptions === 'function') {
      currentChart.updateOptions({ xaxis: { min: view.min, max: view.max } }, false, false);
    }
    setActivePreset(selected);
  }

  function bindPresetButtons(payload) {
    document.querySelectorAll(`#${PANEL_ID} .ce-pe-preset`).forEach(button => {
      button.addEventListener('click', () => applyChartPreset(button.dataset.cePePreset, payload), { passive: true });
    });
  }

  function setSalesAnnotationsVisible(visible, saleAnnotations) {
    saleAnnotationsVisible = Boolean(visible);
    writeStoredSalesAnnotationsVisible(saleAnnotationsVisible);
    document.querySelectorAll(`#${PANEL_ID} .ce-pe-sales-switch`).forEach(button => {
      button.classList.toggle('is-active', saleAnnotationsVisible);
      button.setAttribute('aria-checked', String(saleAnnotationsVisible));
      const toggle = button.querySelector('.toggle');
      const ball = button.querySelector('.ball');
      if (toggle) {
        toggle.classList.toggle('enabled', saleAnnotationsVisible);
        toggle.classList.toggle('bg-green-2', saleAnnotationsVisible);
        toggle.classList.toggle('bg-dark-6', !saleAnnotationsVisible);
      }
      if (ball) {
        ball.classList.toggle('bg-light-1', saleAnnotationsVisible);
        ball.classList.toggle('bg-light-2', !saleAnnotationsVisible);
      }
    });
    if (currentChart && typeof currentChart.updateOptions === 'function') {
      currentChart.updateOptions({
        annotations: { xaxis: saleAnnotationsVisible ? saleAnnotations : [] },
      }, false, true);
    }
  }

  function bindSalesToggle(saleAnnotations) {
    document.querySelectorAll(`#${PANEL_ID} .ce-pe-sales-switch`).forEach(button => {
      button.addEventListener('click', () => {
        setSalesAnnotationsVisible(!saleAnnotationsVisible, saleAnnotations);
      });
    });
  }

  function chartTooltip(point, settings) {
    if (!point) return '';

    return `
      <div class="ce-pe-chart-tooltip">
        <span>${escapeHtml(formatMoney(point.y, settings.currency))}</span>
      </div>
    `;
  }

  function mountChart(chartRaw, salesRaw, settings, rates) {
    destroyCurrentChart();
    const container = document.getElementById('ce-pe-apex-chart');
    if (!container) return;

    if (typeof window.ApexCharts !== 'function') {
      container.outerHTML = '<div class="ce-pe-empty">ApexCharts could not be loaded.</div>';
      return;
    }

    const payload = buildChartPayload(chartRaw, salesRaw, settings, rates);
    if (!payload.hasData) return;

    const series = [];
    if (payload.chart.length) {
      series.push({
        name: 'Pricempire price',
        type: 'area',
        data: payload.chart.map(point => ({
          x: point.ts,
          y: point.displayValue,
          count: point.count,
        })),
      });
    }
    const saleAnnotations = payload.sales.map(point => ({
      x: point.ts,
      borderColor: '#01bf4d',
      strokeDashArray: 3,
      label: {
        borderColor: '#01bf4d',
        position: 'bottom',
        orientation: 'vertical',
        offsetY: -6,
        text: formatMoney(point.displayValue, settings.currency),
        style: {
          background: '#01bf4d',
          color: '#fff',
          fontSize: '11px',
          fontWeight: 600,
        },
      },
    }));

    const options = {
      series,
      annotations: {
        xaxis: saleAnnotationsVisible ? saleAnnotations : [],
      },
      chart: {
        type: 'area',
        height: 260,
        background: 'transparent',
        parentHeightOffset: 0,
        foreColor: '#9293a6',
        animations: {
          enabled: true,
          speed: 400,
          animateGradually: { enabled: false },
          dynamicAnimation: { enabled: true, speed: 300 },
        },
        toolbar: {
          show: false,
          autoSelected: 'zoom',
          tools: {
            download: false,
            selection: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
            reset: true,
          },
        },
        selection: { enabled: true, type: 'x' },
        zoom: {
          enabled: true,
          type: 'x',
          autoScaleYaxis: true,
          allowMouseWheelZoom: true,
        },
      },
      colors: ['#e9b10e'],
      dataLabels: { enabled: false },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.34,
          opacityTo: 0.04,
          stops: [0, 100],
        },
      },
      stroke: {
        curve: 'smooth',
        width: 2.5,
      },
      markers: {
        size: 0,
        strokeColors: '#141419',
        strokeWidth: 2,
        hover: { sizeOffset: 2 },
      },
      grid: {
        borderColor: '#333541',
        strokeDashArray: 4,
        padding: { left: 8, right: 8 },
      },
      xaxis: {
        type: 'datetime',
        axisBorder: { color: '#333541' },
        axisTicks: { color: '#333541' },
        labels: {
          datetimeUTC: false,
          style: { colors: '#9293a6' },
        },
      },
      yaxis: {
        forceNiceScale: true,
        labels: {
          style: { colors: '#9293a6' },
          formatter: value => formatMoney(value, settings.currency),
        },
      },
      legend: {
        show: false,
      },
      tooltip: {
        enabled: true,
        theme: 'dark',
        shared: false,
        custom: ({ seriesIndex, dataPointIndex, w }) => {
          const item = w && w.config && w.config.series ? w.config.series[seriesIndex] : null;
          const point = item && item.data ? item.data[dataPointIndex] : null;
          return chartTooltip(point, settings);
        },
      },
    };

    try {
      currentChart = new window.ApexCharts(container, options);
      const result = currentChart.render();
      if (result && typeof result.catch === 'function') {
        result
          .then(() => applyChartPreset(DEFAULT_CHART_PRESET, payload))
          .catch(err => {
            console.error('[Pricempire] ApexCharts render failed:', err);
            container.outerHTML = '<div class="ce-pe-empty">Chart could not be rendered.</div>';
            currentChart = null;
          });
      } else {
        applyChartPreset(DEFAULT_CHART_PRESET, payload);
      }
      bindPresetButtons(payload);
      bindSalesToggle(saleAnnotations);
    } catch (err) {
      console.error('[Pricempire] ApexCharts render failed:', err);
      container.outerHTML = '<div class="ce-pe-empty">Chart could not be rendered.</div>';
      currentChart = null;
    }
  }

  function renderAnalysis({ analysis, sales, rates }) {
    const panel = ensurePanel();
    destroyCurrentChart();
    const settings = utils.normalizeSettings(analysis.settings);

    panel.innerHTML = renderChart(analysis.chart, sales, settings, rates);
    mountChart(analysis.chart, sales, settings, rates);
  }

  async function run(force) {
    const itemId = getItemIdFromPath();
    if (!itemId) {
      const panel = document.getElementById(PANEL_ID);
      destroyCurrentChart();
      if (panel) panel.remove();
      lastItemId = null;
      return;
    }
    if (!force && lastItemId === itemId) return;
    lastItemId = itemId;
    const sequence = ++runSequence;

    renderPendingChartContainer();
    const [item, sales, rates] = await Promise.all([
      getItem(itemId),
      getSales(itemId),
      getExchangeRates(),
    ]);
    if (sequence !== runSequence || itemId !== getItemIdFromPath()) return;

    if (!item.marketName) {
      renderState('error', 'Could not find market_name for this item.');
      return;
    }

    const cachedAnalysis = getCachedAnalysis(item.marketName);
    if (cachedAnalysis) {
      clearInvalidatedContextReloadFlag();
      renderAnalysis({ item, analysis: cachedAnalysis, sales, rates });
      return;
    }

    let response = null;
    try {
      response = await sendMessage({
        type: 'PRICEMPIRE_GET_ANALYSIS',
        payload: { itemId, marketName: item.marketName, empirePrice: item.empirePrice },
      });
    } catch (err) {
      if (sequence !== runSequence || itemId !== getItemIdFromPath()) return;
      if (isExtensionContextInvalidatedError(err)) {
        handleInvalidatedContext(err);
        return;
      }
      throw err;
    }
    if (sequence !== runSequence || itemId !== getItemIdFromPath()) return;

    if (!response || !response.success) {
      const message = response && response.error ? response.error.message : 'Pricempire analysis failed.';
      if (isExtensionContextInvalidatedError(message)) {
        handleInvalidatedContext(message);
        return;
      }
      renderState('error', message);
      return;
    }

    clearInvalidatedContextReloadFlag();
    setCachedAnalysis(item.marketName, response.data);
    renderAnalysis({ item, analysis: response.data, sales, rates });
  }

  function scheduleRun(force) {
    clearTimeout(runTimer);
    runTimer = setTimeout(() => run(force).catch(err => {
      if (isExtensionContextInvalidatedError(err)) {
        handleInvalidatedContext(err);
        return;
      }
      console.error('[Pricempire] panel failed:', err);
      renderState('error', err.message || 'Pricempire panel failed.');
    }), 250);
  }

  function hookRouteChanges() {
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function (...args) {
      const result = push.apply(this, args);
      scheduleRun(false);
      return result;
    };
    history.replaceState = function (...args) {
      const result = replace.apply(this, args);
      scheduleRun(false);
      return result;
    };
    window.addEventListener('popstate', () => scheduleRun(false), { passive: true });
    window.addEventListener('ce:route', () => scheduleRun(false), { passive: true });
  }

  function watchAddressChanges() {
    lastRouteKey = getRouteKey();
    if (typeof setInterval !== 'function') return;
    setInterval(() => {
      const routeKey = getRouteKey();
      if (routeKey === lastRouteKey) return;
      lastRouteKey = routeKey;
      scheduleRun(false);
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observePanelPlacement();
      scheduleRun(false);
    }, { once: true });
  } else {
    observePanelPlacement();
    scheduleRun(false);
  }
  hookRouteChanges();
  watchAddressChanges();
  window.runPricempirePanel = () => scheduleRun(true);
})();
