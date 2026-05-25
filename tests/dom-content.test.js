const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createDomContentSandbox(options = {}) {
  const store = new Map();
  if (!options.skipDefaultCurrencyFetchTime) {
    store.set('lastCurrencyFetchTime', String(Date.now()));
  }
  Object.entries(options.localStorage || {}).forEach(([key, value]) => {
    store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  const fetchCalls = [];
  const tabAppends = [];
  const currencyTitles = [];
  const referralRowClasses = [];
  let similarAnchorAvailable = !!options.similarAnchorAvailable;
  let tabInserted = false;
  let referralLastSeenText = options.referralLastSeenText || 'This Month';
  let referralNameText = options.referralNameText || 'Good luck';
  const referralNameLinks = [];
  function createElementStub(tagName = 'div') {
    return {
      tagName: String(tagName).toUpperCase(),
      children: [],
      attributes: {},
      textContent: '',
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return this.attributes[name] || null;
      },
      appendChild(child) {
        this.children.push(child);
        if (this.__isReferralNameNode && child.tagName === 'A') referralNameLinks.push(child);
        return child;
      },
      remove() {},
    };
  }
  const referralNameNode = Object.assign(createElementStub('span'), {
    __isReferralNameNode: true,
    get textContent() {
      return referralNameText;
    },
    set textContent(value) {
      referralNameText = String(value);
    },
  });
  const referralLastSeenNode = {
    children: [],
    get textContent() {
      return referralLastSeenText;
    },
    set textContent(value) {
      referralLastSeenText = String(value);
    },
  };
  const referralRowElement = {
    __ceReferralRow: true,
    querySelectorAll() {
      return [referralNameNode, referralLastSeenNode];
    },
  };
  const document = {
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement(tagName) {
      return createElementStub(tagName);
    },
  };
  const window = {
    __ce_content_initialized__: false,
    location: {
      pathname: options.pathname || '/item/356071890',
      origin: 'https://csgoempire.com',
    },
    addEventListener() {},
  };

  function makeJqueryObject(kind, length = 0) {
    const object = {
      length,
      ready() {},
      first() { return this; },
      text() { return ''; },
      trim() { return ''; },
      children() {
        if (kind === 'similarContainer' && similarAnchorAvailable) return makeJqueryObject('anchorRow', 1);
        return makeJqueryObject('empty', 0);
      },
      eq() { return this.length ? this : makeJqueryObject('empty', 0); },
      after(html) {
        if (kind === 'anchorRow') tabInserted = true;
        return this;
      },
      empty() {
        if (kind === 'tab') tabAppends.length = 0;
        return this;
      },
      append(html) {
        if (kind === 'tab') tabAppends.push(String(html));
        return this;
      },
      remove() {
        if (kind === 'tab') tabInserted = false;
        return this;
      },
      each() { return this; },
      closest() { return makeJqueryObject('empty', 0); },
      find() { return makeJqueryObject('empty', 0); },
      attr() { return this; },
    };
    if (length) object[0] = { kind };
    return object;
  }

  function makeReferralRowObject() {
    return {
      length: 1,
      0: referralRowElement,
      ready() {},
      first() { return this; },
      text() { return options.referralRowText || `Good luck ${referralLastSeenText}`; },
      trim() { return this.text().trim(); },
      children() { return makeJqueryObject('empty', 0); },
      eq() { return this; },
      after() { return this; },
      empty() { return this; },
      append() { return this; },
      remove() { return this; },
      each(callback) {
        callback.call(referralRowElement);
        return this;
      },
      closest() { return makeJqueryObject('empty', 0); },
      find() { return makeJqueryObject('empty', 0); },
      attr() { return this; },
      addClass(className) {
        referralRowClasses.push(className);
        return this;
      },
    };
  }

  function jqueryStub(selector) {
    if (typeof selector === 'string' && selector.startsWith('div[data-testid=currency-value]')) {
      return {
        length: options.currencyValueText ? 1 : 0,
        0: { __ceCurrencyValue: true },
        each(callback) {
          if (options.currencyValueText) callback.call(this[0]);
          return this;
        },
      };
    }
    if (selector && selector.__ceCurrencyValue) {
      return {
        length: 1,
        closest() { return makeJqueryObject('empty', 0); },
        text() { return options.currencyValueText || ''; },
        attr(name, value) {
          if (name === 'title' && arguments.length > 1) currencyTitles.push(String(value));
          return this;
        },
      };
    }
    if (selector === referralLastSeenNode) {
      return {
        length: 1,
        text(value) {
          if (arguments.length) {
            referralLastSeenText = String(value);
            return this;
          }
          return referralLastSeenText;
        },
      };
    }
    if (selector && selector.__ceReferralRow) return makeReferralRowObject();
    if (options.referralTable && typeof selector === 'string' && selector.includes('referred-users-table')) {
      return {
        length: 1,
        find(sel) {
          if (sel === 'tr') return makeReferralRowObject();
          return makeJqueryObject('empty', 0);
        },
      };
    }
    if (selector === 'div#2ndtablist') return makeJqueryObject('tab', tabInserted ? 1 : 0);
    if (selector === "h3:contains('Similar items') + div") {
      return makeJqueryObject('similarContainer', similarAnchorAvailable ? 1 : 0);
    }
    return {
      length: 0,
      ready() {},
      first() { return this; },
      text() { return ''; },
      trim() { return ''; },
      children() { return this; },
      eq() { return this; },
      after() { return this; },
      empty() { return this; },
      append() { return this; },
      remove() { return this; },
      each() { return this; },
      closest() { return this; },
      find() { return this; },
      attr() { return this; },
    };
  }

  const sandbox = {
    window,
    document,
    chrome: { runtime: { getURL: path => path } },
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setInterval() {},
    setTimeout() {},
    URL,
    $: jqueryStub,
    fetch: options.fetch || (async (...args) => {
      fetchCalls.push(args);
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            item: { id: 356071890, market_value: 250000 },
            similar_listings: {
              for_sale: [
                { id: 1, purchase_price: 123450 },
                { id: 2, market_value: 345670 },
              ],
              historic: [
                { id: 3, total_value: 999999 },
              ],
            },
          },
        }),
      };
    }),
    console,
  };
  sandbox.window.fetch = sandbox.fetch;
  sandbox._fetchCalls = fetchCalls;
  sandbox._tabAppends = tabAppends;
  sandbox._currencyTitles = currencyTitles;
  sandbox._getReferralLastSeenText = () => referralLastSeenText;
  sandbox._getReferralNameLinkHref = () => referralNameLinks[0] && referralNameLinks[0].getAttribute('href');
  sandbox._getReferralNameLinkTarget = () => referralNameLinks[0] && referralNameLinks[0].getAttribute('target');
  sandbox._setReferralLastSeenText = value => {
    referralLastSeenText = String(value);
  };
  sandbox._referralRowClasses = referralRowClasses;
  sandbox._setSimilarAnchorAvailable = value => {
    similarAnchorAvailable = !!value;
  };
  sandbox._isTabInserted = () => tabInserted;
  sandbox._store = store;
  return sandbox;
}

function runDomContent(sandbox) {
  const source = fs.readFileSync(require.resolve('../scripts/dom-content.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'dom-content.js' });
}

test('loads 2ndtablist prices from current CSGOEmpire item endpoint', async () => {
  const sandbox = createDomContentSandbox();
  runDomContent(sandbox);

  assert.ok(sandbox.window.__ceDomContentTest);
  const prices = await sandbox.window.__ceDomContentTest.getPricesFromAPI();

  assert.deepEqual(Array.from(prices).sort((a, b) => a - b), [1234.5, 2500, 3456.7]);
  assert.equal(sandbox._fetchCalls[0][0], 'https://csgoempire.com/api/v2/trading/item/356071890');
  assert.equal(sandbox._fetchCalls[0][1].method, 'GET');
  assert.equal(sandbox._fetchCalls[0][1].credentials, 'include');
  assert.equal(sandbox._fetchCalls[0][1].headers.Accept, 'application/json');
});

test('does not fetch exchange rates directly on startup', async () => {
  const sandbox = createDomContentSandbox({ skipDefaultCurrencyFetchTime: true });
  runDomContent(sandbox);

  assert.equal(sandbox._fetchCalls.length, 0);
});

test('adds currency title tooltips from localStorage exchangeRates', () => {
  const sandbox = createDomContentSandbox({
    currencyValueText: '1,000.00',
    localStorage: {
      exchangeRates: {
        currency_exchange_rates: {
          rates: {
            EUR: 1,
            USD: 2,
            GBP: 0.5,
            SEK: 20,
            CSGOEMPIRE_COIN: 4,
          },
        },
      },
    },
  });
  runDomContent(sandbox);

  sandbox.window.__ceDomContentTest.updateCurrencyAndHighlights();

  assert.equal(sandbox._currencyTitles.length, 1);
  assert.match(sandbox._currencyTitles[0], /USD:\t\$500\.00/);
  assert.match(sandbox._currencyTitles[0], /EUR:\t€250\.00/);
  assert.match(sandbox._currencyTitles[0], /GBP:\t£125\.00/);
  assert.match(sandbox._currencyTitles[0], /SEK:\t5,000\.00kr/);
  assert.equal(sandbox._fetchCalls.length, 0);
});

test('builds currency title tooltips from displayed selected currency, not always coins', () => {
  const sandbox = createDomContentSandbox({
    currencyValueText: '$500.00',
    localStorage: {
      currency: 'USD',
      exchangeRates: {
        currency_exchange_rates: {
          rates: {
            EUR: 1,
            USD: 2,
            GBP: 0.5,
            SEK: 20,
            CSGOEMPIRE_COIN: 4,
          },
        },
      },
    },
  });
  runDomContent(sandbox);

  sandbox.window.__ceDomContentTest.updateCurrencyAndHighlights();

  assert.equal(sandbox.window.__ceDomContentTest.convertDisplayedCurrencyToCoins('$500.00'), 1000);
  assert.equal(sandbox._currencyTitles.length, 1);
  assert.match(sandbox._currencyTitles[0], /USD:\t\$500\.00/);
  assert.match(sandbox._currencyTitles[0], /EUR:\t€250\.00/);
  assert.match(sandbox._currencyTitles[0], /GBP:\t£125\.00/);
  assert.match(sandbox._currencyTitles[0], /SEK:\t5,000\.00kr/);
});

test('renders 2ndtablist after Similar items anchor appears late', async () => {
  const sandbox = createDomContentSandbox({ similarAnchorAvailable: false });
  runDomContent(sandbox);

  const api = sandbox.window.__ceDomContentTest;
  await api.runHighLowAvgLogic();

  assert.equal(sandbox._isTabInserted(), false);

  sandbox._setSimilarAnchorAvailable(true);
  await api.runHighLowAvgLogic();

  assert.equal(sandbox._isTabInserted(), true);
  assert.equal(sandbox._tabAppends.length, 3);
});

test('converts 2ndtablist prices using selected localStorage currency', async () => {
  const sandbox = createDomContentSandbox({
    similarAnchorAvailable: true,
    localStorage: {
      currency: 'USD',
      exchangeRates: {
        currency_exchange_rates: {
          rates: {
            USD: 4,
            CSGOEMPIRE_COIN: 2,
          },
        },
      },
    },
  });
  runDomContent(sandbox);

  await sandbox.window.__ceDomContentTest.runHighLowAvgLogic();

  assert.equal(sandbox._tabAppends.length, 3);
  assert.match(sandbox._tabAppends[0], />2,469.00</);
  assert.match(sandbox._tabAppends[1], />4,794.13</);
  assert.match(sandbox._tabAppends[2], />6,913.40</);
});

test('waits for exchange rates before initial 2ndtablist render for fiat currency', async () => {
  const sandbox = createDomContentSandbox({
    similarAnchorAvailable: true,
    localStorage: {
      currency: 'USD',
    },
  });
  runDomContent(sandbox);

  const api = sandbox.window.__ceDomContentTest;
  await api.runHighLowAvgLogic();

  assert.equal(sandbox._tabAppends.length, 0);

  sandbox.localStorage.setItem('exchangeRates', JSON.stringify({
    currency_exchange_rates: {
      rates: {
        USD: 4,
        CSGOEMPIRE_COIN: 2,
      },
    },
  }));
  api.rerenderTablistIfCurrencyChanged();

  assert.equal(sandbox._tabAppends.length, 3);
  assert.match(sandbox._tabAppends[0], />2,469.00</);
});

test('tracks referral commission by steam id instead of mutable steam name', () => {
  const sandbox = createDomContentSandbox({
    pathname: '/referrals/dashboard',
    localStorage: {
      'ce_referral_user_v1:steam:76561199155983756': {
        steamId: '76561199155983756',
        userId: 'old-user-id',
        name: 'Old name',
        wagered: 2650000,
        commission: 35000,
      },
    },
  });
  runDomContent(sandbox);

  const diffs = sandbox.window.__ceDomContentTest.updateReferralSnapshots([
    {
      name: 'Good luck',
      user_id: 'a48be8f3d9d41412b8f711970c924e5d9eef0dc093720f365e82358e3677f001',
      steam_id: '76561199155983756',
      total_wagered: '2655327',
      total_commission: '35061.5295',
    },
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].steamId, '76561199155983756');
  assert.equal(diffs[0].name, 'Good luck');
  assert.equal(diffs[0].commissionDiff, 61.53);

  const snapshot = JSON.parse(sandbox.localStorage.getItem('ce_referral_user_v1:steam:76561199155983756'));
  assert.equal(snapshot.name, 'Good luck');
  assert.equal(snapshot.commission, 35061.5295);
});

test('marks referral user as returned when last_seen moves forward', () => {
  const sandbox = createDomContentSandbox({
    pathname: '/referrals/dashboard',
    localStorage: {
      'ce_referral_user_v1:steam:76561199155983756': {
        steamId: '76561199155983756',
        name: 'Good luck',
        wagered: 2655327,
        commission: 35061.5295,
        lastSeen: 1777593600,
      },
    },
  });
  runDomContent(sandbox);

  const diffs = sandbox.window.__ceDomContentTest.updateReferralSnapshots([
    {
      name: 'Good luck',
      steam_id: '76561199155983756',
      total_wagered: '2655327',
      total_commission: '35061.5295',
      last_seen: 1779700000,
    },
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].lastSeenImproved, true);

  const snapshot = JSON.parse(sandbox.localStorage.getItem('ce_referral_user_v1:steam:76561199155983756'));
  assert.equal(snapshot.lastSeen, 1779700000);
});

test('marks referral users red only when they have not returned after two days', () => {
  const sandbox = createDomContentSandbox({ pathname: '/referrals/dashboard' });
  runDomContent(sandbox);

  const check = sandbox.window.__ceDomContentTest.shouldMarkReferralNotReturned;
  const day = 24 * 60 * 60;

  assert.equal(check({ referral_since: 1000, last_seen: 1000 + 2 * day }), true);
  assert.equal(check({ referral_since: 1000, last_seen: 1000 + 2 * day + 1 }), false);
  assert.equal(check({ referral_since: 1674469097, last_seen: 1777593600 }), false);
  assert.equal(check({ referral_since: 1000, last_seen: 0 }), true);
});

test('baselines new referral users without showing old commission as new', () => {
  const sandbox = createDomContentSandbox({ pathname: '/referrals/dashboard' });
  runDomContent(sandbox);

  const diffs = sandbox.window.__ceDomContentTest.updateReferralSnapshots([
    {
      name: 'Good luck',
      user_id: 'a48be8f3d9d41412b8f711970c924e5d9eef0dc093720f365e82358e3677f001',
      steam_id: '76561199155983756',
      total_wagered: '2655327',
      total_commission: '35061.5295',
    },
  ]);

  assert.equal(diffs.length, 0);
  assert.ok(sandbox.localStorage.getItem('ce_referral_user_v1:steam:76561199155983756'));
});

test('fetches referred users from referrals API on dashboard', async () => {
  const fetchCalls = [];
  const sandbox = createDomContentSandbox({
    pathname: '/referrals/dashboard',
    fetch: async (...args) => {
      fetchCalls.push(args);
      return {
        ok: true,
        json: async () => ({
          success: true,
          current_page: 1,
          last_page: 1,
          data: [
            {
              name: 'Good luck',
              user_id: 'a48be8f3d9d41412b8f711970c924e5d9eef0dc093720f365e82358e3677f001',
              steam_id: '76561199155983756',
              total_wagered: '2655327',
              total_commission: '35061.5295',
            },
          ],
        }),
      };
    },
  });
  runDomContent(sandbox);

  await sandbox.window.__ceDomContentTest.refreshReferralEarnings(true);

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], 'https://csgoempire.com/api/v2/referrals/referred-users?per_page=100&page=1');
  assert.equal(fetchCalls[0][1].credentials, 'include');
  assert.ok(sandbox.localStorage.getItem('ce_referral_user_v1:steam:76561199155983756'));
});

test('reapplies referral last_seen formatting while API refresh is throttled', async () => {
  const fetchCalls = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sandbox = createDomContentSandbox({
    pathname: '/referrals/dashboard',
    referralTable: true,
    referralRowText: 'Good luck This Month',
    fetch: async (...args) => {
      fetchCalls.push(args);
      return {
        ok: true,
        json: async () => ({
          success: true,
          current_page: 1,
          last_page: 1,
          data: [
            {
              name: 'Good luck',
              steam_id: '76561199155983756',
              referral_since: nowSeconds - 10 * 24 * 60 * 60,
              last_seen: nowSeconds - 5 * 24 * 60 * 60,
              total_wagered: '0',
              total_commission: '0',
            },
          ],
        }),
      };
    },
  });
  runDomContent(sandbox);

  await sandbox.window.__ceDomContentTest.refreshReferralEarnings(true);
  assert.equal(sandbox._getReferralLastSeenText(), '5 days ago');

  sandbox._setReferralLastSeenText('This Month');
  await sandbox.window.__ceDomContentTest.refreshReferralEarnings(false);

  assert.equal(fetchCalls.length, 1);
  assert.equal(sandbox._getReferralLastSeenText(), '5 days ago');
});

test('links referred user names to their Steam profiles', async () => {
  const sandbox = createDomContentSandbox({
    pathname: '/referrals/dashboard',
    referralTable: true,
    referralRowText: 'Good luck This Month',
    referralNameText: 'Good luck',
  });
  runDomContent(sandbox);

  sandbox.window.__ceDomContentTest.annotateReferralTable([
    {
      name: 'Good luck',
      steam_id: '76561199155983756',
      last_seen: Math.floor(Date.now() / 1000),
    },
  ], []);

  assert.equal(sandbox._getReferralNameLinkHref(), 'https://steamcommunity.com/profiles/76561199155983756');
  assert.equal(sandbox._getReferralNameLinkTarget(), '_blank');
});

test('formats referral last_seen timestamps as days ago', () => {
  const sandbox = createDomContentSandbox({ pathname: '/referrals/dashboard' });
  runDomContent(sandbox);

  const format = sandbox.window.__ceDomContentTest.formatReferralLastSeen;
  const now = Date.UTC(2026, 4, 25, 12, 0, 0);

  assert.equal(format(now / 1000, now), 'Today');
  assert.equal(format((now - 24 * 60 * 60 * 1000) / 1000, now), '1 day ago');
  assert.equal(format((now - 7 * 24 * 60 * 60 * 1000) / 1000, now), '7 days ago');
});
