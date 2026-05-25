const test = require('node:test');
const assert = require('node:assert/strict');

function setupBackground(storageSeed) {
  const storage = Object.assign({}, storageSeed);
  let listener = null;

  global.self = globalThis;
  global.self.cePricempire = require('../scripts/pricempire-utils.js');
  global.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          if (Array.isArray(keys)) {
            callback(Object.fromEntries(keys.map(key => [key, storage[key]])));
            return;
          }
          if (typeof keys === 'string') {
            callback({ [keys]: storage[keys] });
            return;
          }
          callback(Object.assign({}, storage));
        },
        set(values, callback) {
          Object.assign(storage, values);
          if (callback) callback();
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach(key => delete storage[key]);
          if (callback) callback();
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
    },
  };

  delete require.cache[require.resolve('../scripts/background.js')];
  require('../scripts/background.js');
  return listener;
}

function send(listener, message) {
  return new Promise(resolve => {
    const keepAlive = listener(message, {}, resolve);
    if (keepAlive !== true) resolve({ success: false, error: { code: 'no_listener' } });
  });
}

test('returns full public Pricempire chart data resolved from item page', async () => {
  const listener = setupBackground({
    ce_pricempire_settings: { currency: 'USD', chartRange: '30d' },
  });

  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/cs2-items/skin/butterfly-knife-doppler-phase-1')) {
      const payload = [
        ['ShallowReactive', 1],
        { data: 2 },
        [3],
        { id: 4, market_hash_name: 5, slug: 6, discriminator_slug: 7, liquidity: 8 },
        14819,
        '★ Butterfly Knife | Doppler (Factory New) - Phase 1',
        'butterfly-knife-doppler-factory-new-phase-1',
        'factory-new',
        '56.07',
      ];
      return {
        ok: true,
        status: 200,
        text: async () => `<html><script>${JSON.stringify(payload)}</script></html>`,
      };
    }
    if (String(url).includes('/api-data/v1/item/chart?id=14819')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([[1776988800, 219399, 121]]),
      };
    }
    return {
      ok: false,
      status: 404,
      text: async () => 'not found',
    };
  };

  const response = await send(listener, {
    type: 'PRICEMPIRE_GET_ANALYSIS',
    payload: {
      itemId: '358683082',
      marketName: '★ Butterfly Knife | Doppler (Factory New) - Phase 1',
      empirePrice: 100,
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.pricempireItem.id, 14819);
  assert.equal(response.data.pricempireUnavailable, false);
  assert.deepEqual(response.data.chart.map(point => point.value), [2193.99]);
  assert.equal(response.data.insights.liquidity, '56.07');
  assert.ok(urls.some(url => url.includes('/cs2-items/skin/butterfly-knife-doppler-phase-1')));
  assert.ok(urls.some(url => url.includes('/api-data/v1/item/chart?id=14819&days=10000')));
});

test('fetches Pricempire free limits through background', async () => {
  const listener = setupBackground({
    ce_pricempire_api_key: 'test-key',
  });

  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ plan: 'Trader', daily: { used: 1, remaining: 99 } }),
    };
  };

  const response = await send(listener, { type: 'PRICEMPIRE_GET_LIMITS' });

  assert.equal(response.success, true);
  assert.equal(requestedUrl, 'https://api.pricempire.com/v4/free/limits');
  assert.deepEqual(response.data.rows, [
    ['plan', 'Trader'],
    ['daily.used', 1],
    ['daily.remaining', 99],
  ]);
});
