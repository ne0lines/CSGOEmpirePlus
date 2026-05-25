const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const utils = require('../scripts/pricempire-utils.js');

function response(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

test('renders vertical sale annotations and price-only tooltip in gradient chart', async () => {
  const storage = {};
  let chartOptions = null;
  let onReady = null;
  let panel = null;
  let salesToggleClick = null;
  let rangePresetClick = null;
  const annotationUpdates = [];
  const chartContainer = {};
  const salesClasses = new Set();
  const trackClasses = new Set(['bg-dark-6']);
  const ballClasses = new Set(['bg-light-2']);
  function mockClasses(classes) {
    return {
      contains(name) { return classes.has(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    };
  }
  const salesTrack = { classList: mockClasses(trackClasses) };
  const salesBall = { classList: mockClasses(ballClasses) };
  const salesToggle = {
    attrs: {},
    dataset: {},
    classList: {
      contains(name) {
        return name === 'ce-pe-sales-switch' || salesClasses.has(name);
      },
      toggle(name, enabled) {
        if (enabled) salesClasses.add(name);
        else salesClasses.delete(name);
      },
    },
    addEventListener(type, callback) {
      if (type === 'click') salesToggleClick = callback;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    querySelector(selector) {
      if (selector === '.toggle') return salesTrack;
      if (selector === '.ball') return salesBall;
      return null;
    },
  };
  const rangePreset = {
    attrs: {},
    dataset: { cePePreset: '7d' },
    classList: {
      contains() { return false; },
      toggle() {},
    },
    addEventListener(type, callback) {
      if (type === 'click') rangePresetClick = callback;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
  const body = {
    prepend(node) {
      panel = node;
    },
  };

  const document = {
    readyState: 'loading',
    body,
    documentElement: body,
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') onReady = callback;
    },
    createElement() {
      const node = {
        id: '',
        className: '',
        parentNode: null,
        set innerHTML(value) {
          this._html = value;
        },
        get innerHTML() {
          return this._html || '';
        },
      };
      return node;
    },
    getElementById(id) {
      if (id === 'ce-pricempire-panel') return panel;
      if (id === 'ce-pe-apex-chart' && panel && panel.innerHTML.includes(id)) return chartContainer;
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('.ce-pe-sales-switch')) return [salesToggle];
      if (selector.includes('.ce-pe-preset')) return [rangePreset];
      return [];
    },
  };
  const window = {
    top: null,
    location: { pathname: '/trading/item/358683082', origin: 'https://csgoempire.com' },
    cePricempire: utils,
    addEventListener() {},
    ApexCharts: class {
      constructor(container, options) {
        assert.equal(container, chartContainer);
        chartOptions = options;
      }
      render() {
        return Promise.resolve();
      }
      zoomX() {}
      updateOptions(options) {
        annotationUpdates.push(options);
      }
      destroy() {}
    },
  };
  window.top = window;

  const sandbox = {
    window,
    document,
    URL,
    Intl,
    Date,
    Promise,
    localStorage: {
      getItem(key) { return storage[key] || null; },
      setItem(key, value) { storage[key] = String(value); },
    },
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          callback({
            success: true,
            data: {
              settings: utils.normalizeSettings({ currency: 'USD' }),
              chart: [
                { timestamp: '2026-05-22T12:00:00Z', value: 100, count: 5 },
              ],
            },
          });
        },
      },
    },
    fetch: async url => {
      if (String(url).endsWith('/api/v2/trading/item/358683082')) {
        return response({ market_name: 'AK-47 | Redline (Field-Tested)', purchase_price: 100 });
      }
      if (String(url).endsWith('/api/v2/trading/item/358683082/sales')) {
        return response({
          data: {
            similar_listings: {
              historic: [{ created_at: 1779227847, total_value: 365130, item: { wear: 0.015 } }],
            },
          },
        });
      }
      return response({ rates: { USD: 1 } });
    },
    MutationObserver: class {
      observe() {}
    },
    history: {
      pushState() {},
      replaceState() {},
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();
  assert.ok(panel);
  assert.doesNotMatch(panel.innerHTML, /Loading Pricempire analysis/);
  assert.match(panel.innerHTML, /ce-pe-chart-pending/);
  assert.match(panel.innerHTML, /ce-pe-preloader/);
  assert.match(panel.innerHTML, /ce-pe-preloader-spinner/);
  assert.match(panel.innerHTML, /src="\/icons\/logo-preloader\.svg"/);
  assert.doesNotMatch(panel.innerHTML, /viewBox="0 0 78 78"/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-panel\{[^}]*max-width:100%[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-chart-wrap\{[^}]*max-width:100%[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-apex-chart\{[^}]*max-width:100%[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-apex-chart \.apexcharts-canvas,\s*\.ce-pe-apex-chart svg\{[^}]*max-width:100%!important/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-range-tabs\{[^}]*flex:1 1 auto/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-preset\{[^}]*padding:0 16px/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-chart-pending\{[^}]*min-height:306px/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-preloader\{[^}]*opacity:\.15/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-preloader-spinner\{[^}]*border:3px solid #e9b10b/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /\.ce-pe-preloader-spinner\{[^}]*transform-origin:50% 50%/);
  assert.match(fs.readFileSync(require.resolve('../css/style.css'), 'utf8'), /@keyframes cePeSpin\{from\{transform:translateZ\(0\) rotate\(0deg\);\}to\{transform:translateZ\(0\) rotate\(360deg\);\}\}/);
  await new Promise(resolve => setImmediate(resolve));

  assert.doesNotMatch(panel.innerHTML, /Loading Pricempire analysis/);
  assert.doesNotMatch(panel.innerHTML, /ce-pe-chart-pending/);
  assert.doesNotMatch(panel.innerHTML, /ce-pe-preloader/);
  assert.match(panel.innerHTML, /ce-pe-chart-wrap ce-pe-fade-in/);
  assert.equal(chartOptions.chart.animations.enabled, true);
  assert.equal(chartOptions.chart.animations.dynamicAnimation.enabled, true);
  assert.equal(chartOptions.chart.toolbar.show, false);
  assert.equal(chartOptions.chart.selection.enabled, true);
  assert.equal(chartOptions.chart.zoom.allowMouseWheelZoom, true);
  assert.equal(chartOptions.chart.type, 'area');
  assert.equal(chartOptions.series[0].type, 'area');
  assert.equal(chartOptions.fill.type, 'gradient');
  assert.equal(chartOptions.series.length, 1);
  assert.equal(chartOptions.series.some(series => series.name === 'CSGOEmpire sales'), false);
  assert.equal(chartOptions.annotations.xaxis.length, 0);
  assert.match(panel.innerHTML, /ce-pe-chart-controls/);
  assert.match(panel.innerHTML, /ce-pe-range-tabs" role="tablist"/);
  assert.match(panel.innerHTML, /ce-pe-sales-switch/);
  assert.match(panel.innerHTML, /role="switch"/);
  assert.match(panel.innerHTML, /aria-checked="false"/);
  assert.match(panel.innerHTML, /Recently sold/);
  assert.doesNotMatch(panel.innerHTML, />Sales</);
  assert.match(panel.innerHTML, /class="toggle cursor-pointer rounded-full p-xs bg-dark-6"/);
  assert.match(panel.innerHTML, /class="ball flex items-center justify-center rounded-full bg-light-2"/);
  const tooltip = chartOptions.tooltip.custom({
    seriesIndex: 0,
    dataPointIndex: 0,
    w: { config: { series: chartOptions.series } },
  });
  assert.match(tooltip, /\$100\.00/);
  assert.doesNotMatch(tooltip, /Pricempire price|Listings|Float|2026/);
  assert.equal(typeof salesToggleClick, 'function');
  salesToggleClick();
  assert.equal(annotationUpdates.at(-1).annotations.xaxis.length, 1);
  assert.equal(storage.ce_pricempire_sales_visible, 'true');
  assert.equal(salesToggle.attrs['aria-checked'], 'true');
  assert.equal(salesClasses.has('is-active'), true);
  assert.equal(trackClasses.has('enabled'), true);
  assert.equal(trackClasses.has('bg-green-2'), true);
  assert.equal(trackClasses.has('bg-dark-6'), false);
  assert.equal(ballClasses.has('bg-light-1'), true);
  assert.equal(ballClasses.has('bg-light-2'), false);
  assert.equal(annotationUpdates.at(-1).annotations.xaxis[0].x, 1779227847000);
  assert.match(annotationUpdates.at(-1).annotations.xaxis[0].label.text, /2,242\.92/);
  assert.equal(annotationUpdates.at(-1).annotations.xaxis[0].label.orientation, 'vertical');
  assert.equal(annotationUpdates.at(-1).annotations.xaxis[0].label.position, 'bottom');
  assert.equal(annotationUpdates.at(-1).annotations.xaxis[0].label.offsetY, -6);
  assert.equal(typeof rangePresetClick, 'function');
  rangePresetClick();
  assert.equal(salesClasses.has('is-active'), true);
  salesToggleClick();
  assert.equal(annotationUpdates.at(-1).annotations.xaxis.length, 0);
  assert.equal(storage.ce_pricempire_sales_visible, 'false');
  assert.equal(salesToggle.attrs['aria-checked'], 'false');
  assert.equal(trackClasses.has('enabled'), false);
  assert.equal(trackClasses.has('bg-green-2'), false);
  assert.equal(trackClasses.has('bg-dark-6'), true);
  assert.equal(ballClasses.has('bg-light-1'), false);
  assert.equal(ballClasses.has('bg-light-2'), true);
});

test('restores Recently sold toggle state from localStorage', async () => {
  let chartOptions = null;
  let onReady = null;
  let panel = null;
  const chartContainer = {};
  const storage = { ce_pricempire_sales_visible: 'true' };

  const body = {
    prepend(node) {
      panel = node;
    },
  };
  const document = {
    readyState: 'loading',
    body,
    documentElement: body,
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') onReady = callback;
    },
    createElement() {
      return {
        id: '',
        className: '',
        parentNode: null,
        set innerHTML(value) {
          this._html = value;
        },
        get innerHTML() {
          return this._html || '';
        },
      };
    },
    getElementById(id) {
      if (id === 'ce-pricempire-panel') return panel;
      if (id === 'ce-pe-apex-chart' && panel && panel.innerHTML.includes(id)) return chartContainer;
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    top: null,
    location: { pathname: '/trading/item/358683082', origin: 'https://csgoempire.com' },
    cePricempire: utils,
    addEventListener() {},
    ApexCharts: class {
      constructor(container, options) {
        assert.equal(container, chartContainer);
        chartOptions = options;
      }
      render() {
        return Promise.resolve();
      }
      zoomX() {}
      destroy() {}
    },
  };
  window.top = window;

  const sandbox = {
    window,
    document,
    URL,
    Intl,
    Date,
    Promise,
    localStorage: {
      getItem(key) { return storage[key] || null; },
      setItem(key, value) { storage[key] = String(value); },
    },
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          callback({
            success: true,
            data: {
              settings: utils.normalizeSettings({ currency: 'USD' }),
              chart: [{ timestamp: '2026-05-22T12:00:00Z', value: 100 }],
            },
          });
        },
      },
    },
    fetch: async url => {
      if (String(url).endsWith('/api/v2/trading/item/358683082')) {
        return response({ market_name: 'AK-47 | Redline (Field-Tested)', purchase_price: 100 });
      }
      if (String(url).endsWith('/api/v2/trading/item/358683082/sales')) {
        return response({
          data: {
            similar_listings: {
              historic: [{ created_at: 1779227847, total_value: 365130, item: { wear: 0.015 } }],
            },
          },
        });
      }
      return response({ rates: { USD: 1 } });
    },
    MutationObserver: class {
      observe() {}
    },
    history: {
      pushState() {},
      replaceState() {},
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();
  await new Promise(resolve => setImmediate(resolve));

  assert.match(panel.innerHTML, /ce-pe-sales-switch is-active/);
  assert.match(panel.innerHTML, /aria-checked="true"/);
  assert.match(panel.innerHTML, /class="toggle cursor-pointer rounded-full p-xs enabled bg-green-2"/);
  assert.equal(chartOptions.annotations.xaxis.length, 1);
});
