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

test('caches Pricempire analysis in localStorage for repeated market names', async () => {
  const storage = {};
  const analysisCalls = [];
  const renderedCharts = [];
  let onReady = null;
  let panel = null;
  let scheduled = null;

  const chartContainer = {};
  const body = {
    prepend(node) {
      panel = node;
      node.parentNode = body;
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
    location: { pathname: '/trading/item/111', search: '', origin: 'https://csgoempire.com' },
    cePricempire: utils,
    addEventListener() {},
    ApexCharts: class {
      constructor(container, options) {
        assert.equal(container, chartContainer);
        renderedCharts.push(options.series[0].data[0].y);
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
      getItem(key) {
        return storage[key] || null;
      },
      setItem(key, value) {
        storage[key] = String(value);
      },
    },
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          analysisCalls.push(message.payload.itemId);
          callback({
            success: true,
            data: {
              settings: utils.normalizeSettings({ currency: 'USD' }),
              chart: [{ timestamp: '2026-05-22T12:00:00Z', value: 111 }],
            },
          });
        },
      },
    },
    fetch: async url => {
      const text = String(url);
      if (text.endsWith('/api/v2/trading/item/111') || text.endsWith('/api/v2/trading/item/222')) {
        return response({ market_name: 'AK-47 | Redline (Field-Tested)', purchase_price: 100 });
      }
      if (text.includes('/sales')) return response({ data: { similar_listings: { historic: [] } } });
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
      scheduled = callback;
      return 1;
    },
    clearTimeout() {},
    setInterval() {},
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();

  const startedAt = Date.now();
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(analysisCalls, ['111']);
  assert.deepEqual(renderedCharts, [111]);

  const cache = JSON.parse(storage.ce_pricempire_analysis_cache_v1);
  const cacheEntries = Object.values(cache);
  assert.equal(cacheEntries.length, 1);
  assert.ok(cacheEntries[0].expiresAt >= startedAt + (29 * 60 * 1000));
  assert.ok(cacheEntries[0].expiresAt <= Date.now() + (31 * 60 * 1000));

  window.location.pathname = '/trading/item/222';
  window.runPricempirePanel();
  scheduled();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(analysisCalls, ['111']);
  assert.deepEqual(renderedCharts, [111, 111]);
});
