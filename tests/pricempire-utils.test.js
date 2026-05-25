const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPricempireSlug,
  buildPricempireSlugCandidates,
  normalizeSettings,
  normalizeExchangeRates,
  convertEmpireCoins,
  normalizeChartPoints,
  normalizeSalesEvents,
  normalizePricempireLimits,
  normalizePricempirePublicChart,
  extractPricempireItemFromNuxtPayload,
  buildPricempireItemPageCandidates,
  buildPricempirePublicChartUrl,
  CHART_PRESETS,
  DEFAULT_CHART_PRESET,
  getChartPresetWindow,
  normalizeChartPreset,
  filterPointsByRange,
  buildPricempireUrls,
} = require('../scripts/pricempire-utils.js');

test('builds Pricempire slug and variant for phased knife names', () => {
  assert.deepEqual(
    buildPricempireSlug('★ Butterfly Knife | Doppler (Factory New) - Phase 1'),
    {
      slug: 'butterfly-knife-doppler-phase-1',
      variant: null,
      isStatTrak: false,
      wear: 'factory-new',
    }
  );
});

test('builds no variant candidate for factory-new because it is Pricempire default', () => {
  assert.deepEqual(
    buildPricempireSlugCandidates('★ Butterfly Knife | Doppler (Factory New) - Phase 1').map(({ slug, variant, format }) => ({ slug, variant, format })),
    [
      { slug: 'butterfly-knife-doppler-phase-1', variant: null, format: 'base-slug' },
    ]
  );
});

test('builds stattrak variant and removes StatTrak from the slug', () => {
  assert.deepEqual(
    buildPricempireSlug('StatTrak™ AK-47 | Redline (Field-Tested)'),
    {
      slug: 'ak-47-redline',
      variant: 'stattrak-field-tested',
      isStatTrak: true,
      wear: 'field-tested',
    }
  );
});

test('builds ordered Pricempire slug candidates with public URL fallbacks', () => {
  assert.deepEqual(
    buildPricempireSlugCandidates('StatTrak™ AK-47 | Redline (Field-Tested)').map(({ slug, variant, format }) => ({ slug, variant, format })),
    [
      { slug: 'ak-47-redline', variant: 'stattrak-field-tested', format: 'query-variant' },
      { slug: 'stattrak-ak-47-redline-field-tested', variant: null, format: 'full-slug' },
      { slug: 'ak-47-redline-field-tested', variant: null, format: 'full-slug' },
      { slug: 'ak-47-redline', variant: null, format: 'base-slug' },
    ]
  );
});

test('normalizes settings to chart-only full history', () => {
  assert.deepEqual(normalizeSettings({ currency: 'sek', chartRange: '90d', showDetails: false }), {
    currency: 'SEK',
    chartRange: 'all',
    showSummary: false,
    showChart: true,
    showDetails: false,
  });
});

test('defines chart preset buttons with 30d as default view', () => {
  assert.equal(DEFAULT_CHART_PRESET, '30d');
  assert.deepEqual(CHART_PRESETS.map(preset => preset.value), ['24h', '7d', '30d', '90d', '180d', '1y', 'all']);
  assert.equal(normalizeChartPreset('180d'), '180d');
  assert.equal(normalizeChartPreset('bad'), '30d');
});

test('computes preset viewport from full-history chart data', () => {
  const points = [
    { ts: Date.parse('2025-01-01T00:00:00Z') },
    { ts: Date.parse('2026-05-23T12:00:00Z') },
  ];

  assert.deepEqual(getChartPresetWindow(points, '30d'), {
    min: Date.parse('2026-04-23T12:00:00Z'),
    max: Date.parse('2026-05-23T12:00:00Z'),
  });
  assert.deepEqual(getChartPresetWindow(points, 'all'), {
    min: Date.parse('2025-01-01T00:00:00Z'),
    max: Date.parse('2026-05-23T12:00:00Z'),
  });
});

test('normalizes CSGOEmpire exchange rates and converts coin prices', () => {
  const rates = normalizeExchangeRates({ rates: { USD: 1, EUR: 0.92, SEK: 10.6 } });
  assert.equal(convertEmpireCoins(100, 'USD', rates), 61.42808);
  assert.equal(convertEmpireCoins(100, 'SEK', rates), 651.137648);
});

test('normalizes chart points and filters by selected range', () => {
  const now = Date.parse('2026-05-23T12:00:00Z');
  const points = normalizeChartPoints([
    { timestamp: '2026-05-22T12:00:00Z', price: 100 },
    { timestamp: '2026-04-01T12:00:00Z', price: 80 },
  ]);

  assert.equal(points.length, 2);
  assert.deepEqual(filterPointsByRange(points, '30d', now).map(p => p.value), [100]);
});

test('normalizes CSGOEmpire sales events from tolerant response shapes', () => {
  const sales = normalizeSalesEvents({
    data: [
      { sold_at: '2026-05-22T12:00:00Z', sale_price: 120, item: { float_value: 0.03 } },
      { created_at: 'bad-date', purchase_price: 90 },
    ],
  });

  assert.equal(sales.length, 1);
  assert.equal(sales[0].value, 120);
  assert.equal(sales[0].float, 0.03);
});

test('normalizes historic CSGOEmpire sales from similar listings and minor coin values', () => {
  const sales = normalizeSalesEvents({
    success: true,
    data: {
      similar_listings: {
        historic: [
          { created_at: 1779227847, total_value: 365130, item: { wear: 0.015 } },
        ],
      },
    },
  });

  assert.equal(sales.length, 1);
  assert.equal(sales[0].date, '2026-05-19T21:57:27.000Z');
  assert.equal(sales[0].value, 3651.3);
  assert.equal(sales[0].float, 0.015);
});

test('builds Pricempire insights and chart URLs with variant', () => {
  const urls = buildPricempireUrls(
    'https://api.pricempire.com',
    { slug: 'butterfly-knife-doppler-phase-1', variant: 'factory-new' }
  );

  assert.equal(
    urls.insights,
    'https://api.pricempire.com/v4/trader/insights/butterfly-knife-doppler-phase-1?variant=factory-new'
  );
  assert.equal(
    urls.chart,
    'https://api.pricempire.com/v4/trader/insights/butterfly-knife-doppler-phase-1/chart?variant=factory-new'
  );
});

test('normalizes Pricempire limits data into display rows', () => {
  assert.deepEqual(
    normalizePricempireLimits({
      plan: 'Trader',
      daily: { limit: 100, used: 23, remaining: 77 },
      reset_at: '2026-05-24T00:00:00Z',
    }),
    {
      raw: {
        plan: 'Trader',
        daily: { limit: 100, used: 23, remaining: 77 },
        reset_at: '2026-05-24T00:00:00Z',
      },
      rows: [
        ['plan', 'Trader'],
        ['daily.limit', 100],
        ['daily.used', 23],
        ['daily.remaining', 77],
        ['reset_at', '2026-05-24T00:00:00Z'],
      ],
    }
  );
});

test('builds public Pricempire page candidates from market names', () => {
  assert.deepEqual(
    buildPricempireItemPageCandidates('StatTrak™ AK-47 | Redline (Field-Tested)').map(item => item.path),
    [
      '/cs2-items/skin/ak-47-redline?variant=stattrak-field-tested',
      '/cs2-items/skin/ak-47-redline/stattrak-field-tested',
      '/item/stattrak-ak-47-redline-field-tested',
      '/cs2-items/skin/ak-47-redline',
    ]
  );

  assert.deepEqual(
    buildPricempireItemPageCandidates('★ Butterfly Knife | Doppler (Factory New) - Phase 1').map(item => item.path),
    [
      '/cs2-items/skin/butterfly-knife-doppler-phase-1',
      '/item/butterfly-knife-doppler-factory-new-phase-1',
    ]
  );
});

test('extracts exact Pricempire item id from Nuxt payload HTML', () => {
  const payload = [
    ['ShallowReactive', 1],
    { data: 2 },
    [
      3,
      7,
    ],
    {
      id: 4,
      market_hash_name: 5,
      slug: 6,
      discriminator_slug: 10,
    },
    14819,
    '★ Butterfly Knife | Doppler (Factory New) - Phase 1',
    'butterfly-knife-doppler-factory-new-phase-1',
    {
      id: 8,
      market_hash_name: 9,
      slug: 11,
      discriminator_slug: 12,
    },
    14821,
    '★ StatTrak™ Butterfly Knife | Doppler (Factory New) - Phase 1',
    'factory-new',
    'stattrak-butterfly-knife-doppler-factory-new-phase-1',
    'stattrak-factory-new',
  ];
  const html = `<script>${JSON.stringify(payload)}</script>`;

  assert.deepEqual(
    extractPricempireItemFromNuxtPayload(html, '★ Butterfly Knife | Doppler (Factory New) - Phase 1'),
    {
      id: 14819,
      marketHashName: '★ Butterfly Knife | Doppler (Factory New) - Phase 1',
      slug: 'butterfly-knife-doppler-factory-new-phase-1',
      discriminator: null,
      discriminatorSlug: 'factory-new',
      liquidity: null,
      priceHistory: null,
    }
  );
});

test('normalizes public Pricempire chart arrays from cents to currency values', () => {
  assert.deepEqual(
    normalizePricempirePublicChart([
      [1776988800, 219399, 121],
      [1777075200, null, 100],
      ['bad', 200, 1],
    ]),
    [
      {
        date: '2026-04-24T00:00:00.000Z',
        ts: 1776988800000,
        value: 2193.99,
        count: 121,
        raw: [1776988800, 219399, 121],
      },
    ]
  );

  assert.equal(
    buildPricempirePublicChartUrl('https://pricempire.com', 14819, 10000),
    'https://pricempire.com/api-data/v1/item/chart?id=14819&days=10000'
  );
});
