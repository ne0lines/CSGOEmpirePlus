const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const utils = require('../scripts/pricempire-utils.js');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

test('does not let a stale item request overwrite chart after SPA navigation', async () => {
  const itemOne = deferred();
  const analysisOne = deferred();
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
    location: { pathname: '/trading/item/111', origin: 'https://csgoempire.com' },
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
      getItem() { return null; },
      setItem() {},
    },
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          analysisCalls.push(message.payload.itemId);
          if (message.payload.itemId === '111') {
            analysisOne.promise.then(() => callback({
              success: true,
              data: {
                settings: utils.normalizeSettings({ currency: 'USD' }),
                chart: [{ timestamp: '2026-05-22T12:00:00Z', value: 111 }],
              },
            }));
            return;
          }
          callback({
            success: true,
            data: {
              settings: utils.normalizeSettings({ currency: 'USD' }),
              chart: [{ timestamp: '2026-05-22T12:00:00Z', value: 222 }],
            },
          });
        },
      },
    },
    fetch: async url => {
      const text = String(url);
      if (text.endsWith('/api/v2/trading/item/111')) return itemOne.promise;
      if (text.endsWith('/api/v2/trading/item/222')) {
        return jsonResponse({ market_name: 'AK-47 | Redline (Field-Tested)', purchase_price: 222 });
      }
      if (text.endsWith('/api/v2/trading/item/111/sales') || text.endsWith('/api/v2/trading/item/222/sales')) {
        return jsonResponse({ data: { similar_listings: { historic: [] } } });
      }
      return jsonResponse({ rates: { USD: 1 } });
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
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();

  scheduled();
  window.location.pathname = '/trading/item/222';
  window.runPricempirePanel();
  scheduled();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(analysisCalls, ['222']);
  assert.deepEqual(renderedCharts, [222]);

  itemOne.resolve(jsonResponse({ market_name: 'M4A1-S | Printstream (Factory New)', purchase_price: 111 }));
  analysisOne.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(renderedCharts, [222]);
});

test('reruns when browser address changes even if history hooks miss the SPA navigation', async () => {
  const analysisCalls = [];
  const renderedCharts = [];
  let onReady = null;
  let panel = null;
  let scheduled = null;
  let locationCheck = null;

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
      getItem() { return null; },
      setItem() {},
    },
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          analysisCalls.push(message.payload.itemId);
          const value = Number(message.payload.itemId);
          callback({
            success: true,
            data: {
              settings: utils.normalizeSettings({ currency: 'USD' }),
              chart: [{ timestamp: '2026-05-22T12:00:00Z', value }],
            },
          });
        },
      },
    },
    fetch: async url => {
      const text = String(url);
      if (text.endsWith('/api/v2/trading/item/111')) {
        return jsonResponse({ market_name: 'M4A1-S | Printstream (Factory New)', purchase_price: 111 });
      }
      if (text.endsWith('/api/v2/trading/item/222')) {
        return jsonResponse({ market_name: 'AK-47 | Redline (Field-Tested)', purchase_price: 222 });
      }
      if (text.endsWith('/api/v2/trading/item/111/sales') || text.endsWith('/api/v2/trading/item/222/sales')) {
        return jsonResponse({ data: { similar_listings: { historic: [] } } });
      }
      return jsonResponse({ rates: { USD: 1 } });
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
    setInterval(callback) {
      locationCheck = callback;
      return 1;
    },
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();

  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(analysisCalls, ['111']);
  assert.deepEqual(renderedCharts, [111]);

  window.location.pathname = '/trading/item/222';
  assert.equal(typeof locationCheck, 'function');
  locationCheck();
  scheduled();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(analysisCalls, ['111', '222']);
  assert.deepEqual(renderedCharts, [111, 222]);
});

test('reloads once instead of rendering raw extension context invalidated errors after SPA navigation', async () => {
  let onReady = null;
  let panel = null;
  let scheduled = null;
  let reloads = 0;
  const session = {};

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
      return id === 'ce-pricempire-panel' ? panel : null;
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
    location: {
      pathname: '/item/357996233',
      search: '',
      origin: 'https://csgoempire.com',
      reload() {
        reloads += 1;
      },
    },
    cePricempire: utils,
    addEventListener() {},
    ApexCharts: class {},
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
      getItem() { return null; },
      setItem() {},
    },
    sessionStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(session, key) ? session[key] : null;
      },
      setItem(key, value) {
        session[key] = String(value);
      },
      removeItem(key) {
        delete session[key];
      },
    },
    chrome: {
      runtime: {
        sendMessage() {
          throw new Error('Extension context invalidated.');
        },
      },
    },
    fetch: async url => {
      const text = String(url);
      if (text.endsWith('/api/v2/trading/item/357996233')) {
        return jsonResponse({ market_name: 'AK-47 | Redline (Field-Tested)', purchase_price: 222 });
      }
      if (text.endsWith('/api/v2/trading/item/357996233/sales')) {
        return jsonResponse({ data: { similar_listings: { historic: [] } } });
      }
      return jsonResponse({ rates: { USD: 1 } });
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
    setInterval() {
      return 1;
    },
    console,
  };

  const source = fs.readFileSync(require.resolve('../scripts/pricempire-panel.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  onReady();

  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(reloads, 1);
  assert.doesNotMatch(panel.innerHTML, /Extension context invalidated/i);
});
