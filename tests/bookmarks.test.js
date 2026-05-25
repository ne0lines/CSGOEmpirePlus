const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const BOOKMARKS_KEY = 'ce_bookmarks_v1';

class FakeClassList {
  constructor(el) {
    this.el = el;
  }

  _set(values) {
    this.el.className = Array.from(values).join(' ');
  }

  _values() {
    return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean));
  }

  add(...names) {
    const values = this._values();
    names.forEach(name => values.add(name));
    this._set(values);
  }

  remove(...names) {
    const values = this._values();
    names.forEach(name => values.delete(name));
    this._set(values);
  }

  contains(name) {
    return this._values().has(name);
  }

  toggle(name, force) {
    const values = this._values();
    const shouldAdd = force == null ? !values.has(name) : !!force;
    if (shouldAdd) values.add(name);
    else values.delete(name);
    this._set(values);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.attributes = {};
    this.dataset = {};
    this.eventListeners = {};
    this.style = {};
    this.className = '';
    this.id = '';
    this.textContent = '';
    this._innerHTML = '';
    this.innerHTMLWrites = 0;
    this.classList = new FakeClassList(this);
  }

  set innerHTML(value) {
    this.innerHTMLWrites += 1;
    this._innerHTML = String(value);
    this.children = [];
    for (const match of this._innerHTML.matchAll(/<([a-z0-9-]+)([^>]*)>/gi)) {
      const child = new FakeElement(match[1]);
      const attrs = match[2] || '';
      for (const attr of attrs.matchAll(/\s([^\s=]+)=["']([^"']*)["']/g)) {
        child.setAttribute(attr[1], attr[2]);
      }
      this.appendChild(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes[name] = stringValue;
    if (name === 'id') this.id = stringValue;
    if (name === 'class') this.className = stringValue;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  getAttributeNames() {
    return Object.keys(this.attributes);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    child.parentElement = this;
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentNode = this;
    child.parentElement = this;
    return child;
  }

  prepend(child) {
    return this.insertBefore(child, this.children[0] || null);
  }

  removeChild(child) {
    this.children = this.children.filter(item => item !== child);
    child.parentNode = null;
    child.parentElement = null;
    return child;
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }

  addEventListener(type, callback) {
    this.eventListeners[type] = this.eventListeners[type] || [];
    this.eventListeners[type].push(callback);
  }

  dispatchEvent(event) {
    let stopped = false;
    const evt = Object.assign({
      target: this,
      preventDefault() {},
      stopPropagation() {
        stopped = true;
      },
    }, event);
    let current = this;
    while (current) {
      evt.currentTarget = current;
      (current.eventListeners[evt.type] || []).forEach(callback => callback(evt));
      if (stopped) break;
      current = current.parentElement;
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  matches(selector) {
    return selector.split(',').some(part => this._matchesOne(part.trim()));
  }

  _matchesOne(selector) {
    if (!selector) return false;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) {
      return selector.slice(1).split('.').every(name => this.classList.contains(name));
    }
    if (selector.startsWith('[')) {
      const attrMatch = selector.match(/^\[([^=\]*]+)(?:\*?=["']?([^"'\]]+)["']?)?\]$/);
      if (!attrMatch) return false;
      const attr = attrMatch[1];
      const expected = attrMatch[2];
      const actual = this.getAttribute(attr);
      if (expected == null) return actual != null;
      if (selector.includes('*=')) return String(actual || '').includes(expected);
      return String(actual || '') === expected;
    }
    const classParts = selector.split('.');
    if (classParts.length > 1) {
      return this.tagName.toLowerCase() === classParts[0].toLowerCase() &&
        classParts.slice(1).every(name => this.classList.contains(name));
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

function createSandbox(options = {}) {
  const body = new FakeElement('body');
  const sidebar = new FakeElement('aside');
  sidebar.className = 'sidebar';
  sidebar.getBoundingClientRect = () => ({ left: 900, top: 64, right: 1200, bottom: 900, width: 300, height: 836 });
  const sidebarInner = new FakeElement('div');
  sidebarInner.className = 'sidebar__inner';
  const header = new FakeElement('div');
  header.className = 'extra-sidebar-header';
  header.setAttribute('data-v-ecf11097', '');
  const tradesTab = new FakeElement('button');
  tradesTab.className = 'extra-sidebar-header__tab selected extra-sidebar-header__tab--selected';
  tradesTab.setAttribute('data-ce-native-tab', 'trades');
  tradesTab.setAttribute('data-v-ecf11097', '');
  const tradesIcon = new FakeElement('div');
  tradesIcon.className = 'ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-[14px] mr-sm';
  tradesIcon.setAttribute('data-v-ecf11097', '');
  const tradesText = new FakeElement('h4');
  tradesText.className = 'ellipsis';
  tradesText.setAttribute('data-v-77a34606', '');
  tradesText.setAttribute('data-v-ecf11097', '');
  tradesTab.appendChild(tradesIcon);
  tradesTab.appendChild(tradesText);
  const filtersTab = new FakeElement('button');
  filtersTab.className = 'extra-sidebar-header__tab';
  filtersTab.setAttribute('data-ce-native-tab', 'filters');
  filtersTab.setAttribute('data-v-ecf11097', '');
  header.appendChild(tradesTab);
  if (options.withFilters !== false) header.appendChild(filtersTab);
  const structure = new FakeElement('div');
  structure.className = 'sidebar-structure';
  const content = new FakeElement('div');
  content.className = 'content';
  const contentInner = new FakeElement('div');
  contentInner.className = 'content__inner';
  content.appendChild(contentInner);
  structure.appendChild(content);
  sidebarInner.appendChild(header);
  sidebarInner.appendChild(structure);
  sidebar.appendChild(sidebarInner);
  body.appendChild(sidebar);

  const store = new Map();
  const listeners = {};
  const mutationObservers = [];
  const timers = [];
  const fetchCalls = [];
  const openCalls = [];
  const window = {
    top: null,
    innerWidth: 1200,
    innerHeight: 900,
    location: { pathname: options.pathname || '/item/123', search: '', origin: 'https://csgoempire.com' },
    addEventListener(type, callback) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(callback);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach(callback => callback(event));
    },
    open(...args) {
      openCalls.push(args);
      return null;
    },
  };
  window.top = window;

  const document = {
    body,
    documentElement: body,
    readyState: 'complete',
    createElement: tag => new FakeElement(tag),
    getElementById: id => body.querySelector(`#${id}`),
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener() {},
  };

  const sandbox = {
    window,
    document,
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
    history: {
      pushed: null,
      pushState(_state, _title, path) {
        this.pushed = path;
        window.location.pathname = path;
      },
      replaceState() {},
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    PopStateEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.active = false;
        mutationObservers.push(this);
      }
      observe() {
        this.active = true;
      }
      disconnect() {
        this.active = false;
      }
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, active: true };
      timers.push(timer);
      if (delay !== 500) callback();
      return timers.length;
    },
    clearTimeout(id) {
      const timer = timers[id - 1];
      if (timer) timer.active = false;
    },
    setInterval(callback, delay) {
      const timer = { callback, delay, active: true, interval: true };
      timers.push(timer);
      return timers.length;
    },
    clearInterval(id) {
      const timer = timers[id - 1];
      if (timer) timer.active = false;
    },
    fetch: async (...args) => {
      fetchCalls.push(args);
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    },
    console,
  };
  window.fetch = sandboxFetch;
  function sandboxFetch(...args) {
    return sandbox.fetch(...args);
  }
  sandbox._elements = { sidebar, header, contentInner, sidebarInner, tradesTab, filtersTab };
  sandbox._mutationObservers = mutationObservers;
  sandbox._timers = timers;
  sandbox._fetchCalls = fetchCalls;
  sandbox._openCalls = openCalls;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function flushMutations(sandbox) {
  sandbox._mutationObservers
    .filter(observer => observer.active)
    .forEach(observer => observer.callback());
}

function runTimers(sandbox, delay) {
  sandbox._timers
    .filter(timer => timer.active && timer.delay === delay)
    .forEach(timer => {
      timer.active = false;
      timer.callback();
    });
}

function runScript(sandbox, file) {
  const source = fs.readFileSync(require.resolve(`../scripts/${file}`), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: file });
}

test('normalizes and toggles bookmark entries in localStorage', () => {
  const sandbox = createSandbox();
  sandbox.localStorage.setItem(BOOKMARKS_KEY, '{bad json');
  runScript(sandbox, 'bookmark-manager.js');

  assert.equal(sandbox.window.loadBookmarks().length, 0);

  const addResult = sandbox.window.toggleBookmark({
    id: 123,
    name: 'AK-47 | Redline',
    icon: 'https://example.com/icon.png',
    float: 0.1234,
    price: '1,234.50',
  });

  assert.equal(addResult.saved, true);
  assert.equal(sandbox.window.hasBookmark('123'), true);
  assert.equal(sandbox.window.loadBookmarks().length, 1);
  assert.deepEqual(
    Object.keys(sandbox.window.loadBookmarks()[0]).sort(),
    ['addedAt', 'iconUrl', 'id', 'marketName', 'previewId', 'price', 'wear'].sort()
  );
  assert.equal(sandbox.window.loadBookmarks()[0].marketName, 'AK-47 | Redline');
  assert.equal(sandbox.window.loadBookmarks()[0].iconUrl, 'https://example.com/icon.png');
  assert.equal(sandbox.window.loadBookmarks()[0].wear, 0.1234);
  assert.equal(sandbox.window.loadBookmarks()[0].price, 1234.5);

  const removeResult = sandbox.window.toggleBookmark({ id: '123' });
  assert.equal(removeResult.saved, false);
  assert.equal(sandbox.window.loadBookmarks().length, 0);
});

test('fetches CSGOEmpire item data when adding a like', async () => {
  const sandbox = createSandbox();
  sandbox.fetch = async (url, options) => {
    sandbox._fetchCalls.push([url, options]);
    return {
      ok: true,
      json: async () => ({
        id: 358683082,
        market_name: '★ Butterfly Knife | Doppler (Factory New) - Phase 1',
        icon_url: 'empire-icon-token',
        market_value: 364654,
        preview_id: '320d9175cf6b',
        wear: 0.033,
      }),
    };
  };
  runScript(sandbox, 'bookmark-manager.js');

  const result = await sandbox.window.toggleBookmarkWithItemData({
    id: 358683082,
    marketName: 'Fallback name',
    iconUrl: 'fallback-icon',
    price: 1,
    wear: 0.5,
  });

  assert.equal(result.saved, true);
  assert.equal(sandbox._fetchCalls.length, 1);
  assert.equal(sandbox._fetchCalls[0][0], 'https://csgoempire.com/api/v2/trading/item/358683082');
  assert.equal(sandbox._fetchCalls[0][1].credentials, 'include');
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.window.loadBookmarks()[0])),
    {
      id: '358683082',
      marketName: 'Butterfly Knife | Doppler - Phase 1',
      iconUrl: 'https://community.steamstatic.com/economy/image/empire-icon-token/214x368',
      price: 1,
      marketValue: 364654,
      wear: 0.033,
      previewId: '320d9175cf6b',
      addedAt: result.bookmark.addedAt,
    }
  );
});

test('stores raw market value for liked CSGOEmpire items', async () => {
  const sandbox = createSandbox();
  sandbox.fetch = async (url, options) => {
    sandbox._fetchCalls.push([url, options]);
    return {
      ok: true,
      json: async () => ({
        id: 358683082,
        market_name: 'AK-47 | Redline',
        icon_url: 'empire-icon-token',
        market_value: 10000,
        wear: 0.12,
      }),
    };
  };
  runScript(sandbox, 'bookmark-manager.js');

  const result = await sandbox.window.toggleBookmarkWithItemData({ id: 358683082 });
  const bookmark = sandbox.window.loadBookmarks()[0];

  assert.equal(result.saved, true);
  assert.equal(sandbox._fetchCalls.length, 1);
  assert.equal(sandbox._fetchCalls[0][0], 'https://csgoempire.com/api/v2/trading/item/358683082');
  assert.equal(bookmark.marketValue, 10000);
  assert.equal(bookmark.price, null);
});

test('updates liked items from CSGOEmpire websocket item updates', () => {
  const sandbox = createSandbox();
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '358784255',
      marketName: 'Old name',
      iconUrl: 'old-icon',
      price: 1,
      marketValue: 1,
      wear: 0.1,
      previewId: 'old-preview',
      addedAt: 12345,
      sold: true,
      soldAt: 12346,
    },
  ]));
  runScript(sandbox, 'bookmark-manager.js');

  const result = sandbox.window.ceBookmarks.applyWebSocketBookmarkEvent([
    'updated_item',
    [
      {
        id: 358784255,
        market_name: 'M4A4 | Dark Blossom (Factory New)',
        icon_url: 'empire-icon-token',
        market_value: 14706,
        purchase_price: 14706,
        preview_id: '350c5d899af4',
        wear: 0.05,
      },
      {
        id: 999,
        market_name: 'Ignored item',
        market_value: 999,
      },
    ],
  ]);
  const bookmark = sandbox.window.loadBookmarks()[0];

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { event: 'updated_item', updated: 1, sold: 0 });
  assert.equal(bookmark.id, '358784255');
  assert.equal(bookmark.marketName, 'M4A4 | Dark Blossom');
  assert.equal(bookmark.iconUrl, 'https://community.steamstatic.com/economy/image/empire-icon-token/214x368');
  assert.equal(bookmark.price, 14706);
  assert.equal(bookmark.marketValue, 14706);
  assert.equal(bookmark.wear, 0.05);
  assert.equal(bookmark.previewId, '350c5d899af4');
  assert.equal(bookmark.addedAt, 12345);
  assert.equal(bookmark.sold, undefined);
});

test('stores latest price change when liked item websocket update changes market value', () => {
  const sandbox = createSandbox();
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '358784255',
      marketName: 'M4A4 | Dark Blossom',
      marketValue: 10000,
      addedAt: 12345,
    },
  ]));
  runScript(sandbox, 'bookmark-manager.js');

  sandbox.window.ceBookmarks.applyWebSocketBookmarkEvent([
    'item_update',
    {
      id: 358784255,
      market_name: 'M4A4 | Dark Blossom',
      market_value: 12000,
    },
  ]);

  const bookmark = sandbox.window.loadBookmarks()[0];
  assert.equal(bookmark.marketValue, 12000);
  assert.equal(bookmark.previousMarketValue, 10000);
  assert.equal(bookmark.priceDeltaMarketValue, 2000);
  assert.equal(Number.isFinite(bookmark.priceChangedAt), true);
});

test('marks liked items as sold from CSGOEmpire websocket delete and sold events', () => {
  const sandbox = createSandbox();
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    { id: '111', marketName: 'Keep' },
    { id: '222', marketName: 'Remove' },
  ]));
  runScript(sandbox, 'bookmark-manager.js');

  const result = sandbox.window.ceBookmarks.applyWebSocketBookmarkEvent(['deleted_item', [{ id: 222, market_value: 22200 }, { id: 333 }]]);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { event: 'deleted_item', updated: 0, sold: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.loadBookmarks().map(bookmark => bookmark.id))), ['111', '222']);
  assert.equal(sandbox.window.loadBookmarks()[1].sold, true);
  assert.equal(sandbox.window.loadBookmarks()[1].marketValue, 22200);

  const soldResult = sandbox.window.ceBookmarks.applyWebSocketBookmarkEvent(['item_sold', { item: { id: 111 } }]);

  assert.deepEqual(JSON.parse(JSON.stringify(soldResult)), { event: 'item_sold', updated: 0, sold: 1 });
  assert.equal(sandbox.window.loadBookmarks().length, 2);
  assert.equal(sandbox.window.loadBookmarks()[0].sold, true);
});

test('applies websocket bookmark updates from page-context postMessage events', () => {
  const sandbox = createSandbox();
  sandbox.localStorage.setItem('ce_websocket_likes_enabled', 'true');
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'Old' }]));
  runScript(sandbox, 'bookmark-manager.js');

  sandbox.window.dispatchEvent({
    type: 'message',
    source: sandbox.window,
    data: {
      source: 'csgoempire-plus',
      type: 'CE_WEBSOCKET_EVENT',
      payload: ['item_update', { id: 555, market_name: 'AK-47 | Redline', market_value: 5000 }],
    },
  });

  const bookmark = sandbox.window.loadBookmarks()[0];
  assert.equal(bookmark.marketName, 'AK-47 | Redline');
  assert.equal(bookmark.marketValue, 5000);
});

test('ignores page-context websocket bookmark messages when feature flag is disabled', () => {
  const sandbox = createSandbox();
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'Old' }]));
  runScript(sandbox, 'bookmark-manager.js');

  sandbox.window.dispatchEvent({
    type: 'message',
    source: sandbox.window,
    data: {
      source: 'csgoempire-plus',
      type: 'CE_WEBSOCKET_EVENT',
      payload: ['item_update', { id: 555, market_name: 'AK-47 | Redline', market_value: 5000 }],
    },
  });

  const bookmark = sandbox.window.loadBookmarks()[0];
  assert.equal(bookmark.marketName, 'Old');
  assert.equal(bookmark.marketValue, undefined);
});

test('renders native sidebar tab, bookmark list, and item navigation', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '123',
      marketName: 'AK-47 | Redline',
      iconUrl: 'https://example.com/icon.png',
      price: 1234.5,
      wear: 0.12,
      previewId: null,
      addedAt: 10,
    },
  ]));

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  const tab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  const content = sandbox.document.querySelector('.ce-bookmarks-content');
  assert.ok(tab);
  assert.ok(content);
  assert.equal(tab.parentElement, sandbox._elements.header);
  assert.equal(content.parentElement, sandbox._elements.contentInner);
  assert.equal(sandbox._elements.header.className, 'extra-sidebar-header');
  assert.ok(tab.classList.contains('extra-sidebar-header__tab'));
  assert.equal(tab.tagName, 'DIV');
  assert.equal(tab.getAttribute('data-v-ecf11097'), '');
  assert.match(tab.innerHTML, /ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-\[14px\] mr-sm/);
  assert.match(tab.innerHTML, /ce-bookmark-heart-icon/);
  assert.match(tab.innerHTML, /viewBox="0 0 14 14"/);
  assert.doesNotMatch(tab.innerHTML, /M3 1\.5A1\.5/);
  assert.match(tab.innerHTML, /<h4 class="ellipsis">Likes<\/h4>/);
  assert.equal(tab.querySelector('.ms-flex').getAttribute('data-v-ecf11097'), '');
  assert.equal(tab.querySelector('h4').getAttribute('data-v-ecf11097'), '');
  assert.equal(tab.querySelector('h4').getAttribute('data-v-77a34606'), '');
  assert.deepEqual(sandbox._elements.header.children, [
    sandbox._elements.tradesTab,
    sandbox._elements.filtersTab,
    tab,
  ]);

  sandbox.window.togglePanel(true);
  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'true');
  assert.equal(tab.classList.contains('selected'), true);
  assert.equal(tab.classList.contains('extra-sidebar-header__tab--selected'), false);
  assert.equal(sandbox._elements.tradesTab.classList.contains('selected'), false);
  assert.equal(sandbox._elements.tradesTab.classList.contains('extra-sidebar-header__tab--selected'), false);
  assert.equal(sandbox._elements.filtersTab.classList.contains('selected'), false);
  assert.equal(sandbox._elements.filtersTab.classList.contains('extra-sidebar-header__tab--selected'), false);
  assert.equal(sandbox._elements.tradesTab.parentElement, sandbox._elements.header);
  assert.equal(sandbox._elements.filtersTab.parentElement, sandbox._elements.header);
  assert.match(content.innerHTML, /ce-bookmark-name-muted">AK-47</);
  assert.match(content.innerHTML, /ce-bookmark-name-main">Redline</);
  assert.doesNotMatch(content.innerHTML, /AK-47 \| Redline/);
  assert.match(content.innerHTML, /0\.12/);
  assert.doesNotMatch(content.innerHTML, /0\.1200/);
  assert.doesNotMatch(content.innerHTML, /Wear/);
  assert.doesNotMatch(content.innerHTML, /ID 123/);
  assert.match(content.innerHTML, /ce-bookmark-image-frame/);
  assert.doesNotMatch(content.innerHTML, /ce-bookmark-image-trigger/);
  assert.doesNotMatch(content.innerHTML, /ce-bookmark-zoom-icon/);
  assert.doesNotMatch(content.innerHTML, /data-ce-preview-src/);

  const row = sandbox.document.querySelector('[data-ce-bookmark-id="123"]');
  assert.ok(row);
  row.click();
  assert.equal(sandbox.history.pushed, '/item/123');
  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'true');
  assert.equal(tab.classList.contains('selected'), true);
});

test('renders sold state for sold liked items without hiding them', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '222',
      marketName: 'M4A4 | Dark Blossom',
      marketValue: 14706,
      sold: true,
      soldAt: 1779716997,
      addedAt: 10,
    },
  ]));
  sandbox.localStorage.setItem('ce_bookmarks_sidebar_open', 'true');
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.togglePanel(true);
  const content = sandbox.document.querySelector('.ce-bookmarks-content');
  assert.match(content.innerHTML, /ce-bookmark-item is-sold/);
  assert.match(content.innerHTML, /ce-bookmark-sold-badge">Sold<\/span>/);
  assert.match(content.innerHTML, /Dark Blossom/);
});

test('renders latest price change badge for liked items', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '222',
      marketName: 'M4A4 | Dark Blossom',
      marketValue: 12000,
      previousMarketValue: 10000,
      priceDeltaMarketValue: 2000,
      priceChangedAt: 1779716997000,
      addedAt: 10,
    },
  ]));
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.togglePanel(true);
  const content = sandbox.document.querySelector('.ce-bookmarks-content');
  assert.match(content.innerHTML, /ce-bookmark-price-change is-up/);
  assert.match(content.innerHTML, /\+20/);
});

test('omits missing wear values from Likes sidebar metadata', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '123',
      marketName: 'AK-47 | Redline',
      iconUrl: 'https://example.com/icon.png',
      price: 1234.5,
      wear: null,
      addedAt: 10,
    },
  ]));

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.togglePanel(true);
  const content = sandbox.document.querySelector('.ce-bookmarks-content');

  assert.match(content.innerHTML, /1,234\.5/);
  assert.doesNotMatch(content.innerHTML, /0\.0000/);
  assert.doesNotMatch(content.innerHTML, /Wear/);
});

test('converts liked item market value on the fly from saved CSGOEmpire exchange rates', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem('currency', 'USD');
  sandbox.localStorage.setItem('exchangeRates', JSON.stringify({
    currency_exchange_rates: {
      base: 'EUR',
      rates: {
        EUR: 1,
        USD: 1,
        CSGOEMPIRE_COIN: 1.88757324,
      },
    },
  }));
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '123',
      marketName: 'AK-47 | Redline',
      iconUrl: 'https://example.com/icon.png',
      marketValue: 10000,
      wear: 0.12,
      addedAt: 10,
    },
  ]));

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.togglePanel(true);
  const bookmark = sandbox.window.loadBookmarks()[0];
  const content = sandbox.document.querySelector('.ce-bookmarks-content');

  assert.equal(bookmark.marketValue, 10000);
  assert.match(content.innerHTML, /52\.98/);
  assert.match(content.innerHTML, /ce-bookmark-price-icon/);
  assert.match(content.innerHTML, /ce-bookmark-meta-separator/);
  assert.match(content.innerHTML, /ce-bookmark-meta-separator">\|<\/span>/);
  assert.match(content.innerHTML, /ce-bookmark-wear/);
  assert.match(content.innerHTML, /fill="#E4AD5A"/);
  assert.doesNotMatch(content.innerHTML, /100/);
});

test('renders selected currency icon before liked item price', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '123',
      marketName: 'AK-47 | Redline',
      iconUrl: 'https://example.com/icon.png',
      price: 1234.5,
      addedAt: 10,
    },
  ]));

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  const cases = [
    ['USD', 'fill="#E4AD5A"'],
    ['EUR', 'fill="#448FF0"'],
    ['GBP', 'fill="#F66634"'],
    ['CSGOEMPIRE_COIN', 'viewBox="0 0 22 22"'],
  ];

  for (const [currency, expectedSvg] of cases) {
    sandbox.localStorage.setItem('currency', currency);
    sandbox.window.renderList();
    const content = sandbox.document.querySelector('.ce-bookmarks-content');
    assert.match(content.innerHTML, new RegExp(expectedSvg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(content.innerHTML, /ce-bookmark-price-icon/);
  }
});

test('rerenders Likes sidebar prices when selected currency changes in localStorage', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem('currency', 'SEK');
  sandbox.localStorage.setItem('exchangeRates', JSON.stringify({
    currency_exchange_rates: {
      rates: {
        SEK: 10,
        USD: 1,
        CSGOEMPIRE_COIN: 2,
      },
    },
  }));
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '123',
      marketName: 'AK-47 | Redline',
      iconUrl: 'https://example.com/icon.png',
      marketValue: 10000,
      addedAt: 10,
    },
  ]));

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.togglePanel(true);
  const content = sandbox.document.querySelector('.ce-bookmarks-content');
  assert.match(content.innerHTML, /ce-bookmark-price-value">500</);

  sandbox.localStorage.setItem('currency', 'USD');
  runTimers(sandbox, 1000);

  assert.match(content.innerHTML, /ce-bookmark-price-value">50</);
  assert.doesNotMatch(content.innerHTML, /500/);
});

test('shows Likes sidebar on Steam market and item routes', () => {
  const sandbox = createSandbox({ pathname: '/account' });
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  assert.equal(sandbox.window.ensurePanel(), null);
  assert.equal(sandbox.document.querySelector('.ce-bookmarks-native-tab'), null);
  assert.equal(sandbox.document.querySelector('.ce-bookmarks-content'), null);

  sandbox.window.location.pathname = '/withdraw/steam/market';
  assert.ok(sandbox.window.ensurePanel());
  assert.ok(sandbox.document.querySelector('.ce-bookmarks-native-tab'));
  assert.ok(sandbox.document.querySelector('.ce-bookmarks-content'));

  sandbox.window.location.pathname = '/item/123';
  assert.ok(sandbox.window.ensurePanel());
  assert.ok(sandbox.document.querySelector('.ce-bookmarks-native-tab'));
  assert.ok(sandbox.document.querySelector('.ce-bookmarks-content'));

  sandbox.window.location.pathname = '/account';
  assert.equal(sandbox.window.ensurePanel(), null);
  assert.equal(sandbox.document.querySelector('.ce-bookmarks-native-tab'), null);
  assert.equal(sandbox.document.querySelector('.ce-bookmarks-content'), null);
  assert.deepEqual(sandbox._elements.header.children, [
    sandbox._elements.tradesTab,
    sandbox._elements.filtersTab,
  ]);
});

test('renders Likes next to Trades on item page sidebars without Filters tab', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612', withFilters: false });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '356358612',
      marketName: 'AWP | Asiimov',
      iconUrl: 'https://example.com/icon.png',
      price: 15438.07,
      wear: 0.21,
      previewId: 'abc123',
      addedAt: 20,
    },
  ]));
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  const tab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  const content = sandbox.document.querySelector('.ce-bookmarks-content');

  assert.ok(tab);
  assert.ok(content);
  assert.equal(tab.parentElement, sandbox._elements.header);
  assert.equal(content.parentElement, sandbox._elements.contentInner);
  assert.deepEqual(sandbox._elements.header.children, [
    sandbox._elements.tradesTab,
    tab,
  ]);
  assert.equal(sandbox._elements.header.getAttribute('data-ce-bookmarks-route'), 'item');
  assert.equal(sandbox._elements.header.getAttribute('data-ce-bookmarks-tab-count'), '2');

  sandbox.window.togglePanel(true);
  assert.equal(tab.classList.contains('selected'), true);
  assert.equal(sandbox._elements.tradesTab.classList.contains('selected'), false);
  assert.match(content.innerHTML, /ce-bookmark-name-muted">AWP</);

  sandbox._elements.tradesTab.click();
  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'false');
  assert.equal(sandbox._elements.tradesTab.classList.contains('selected'), true);
  assert.equal(tab.classList.contains('selected'), false);
});

test('mounts Likes into the existing Pending Trades sidebar on item pages without a native header', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  sandbox._elements.sidebarInner.removeChild(sandbox._elements.header);
  const pendingTrades = new FakeElement('div');
  pendingTrades.className = 'pending-trades-list';
  sandbox._elements.contentInner.appendChild(pendingTrades);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();

  const fallback = sandbox.document.getElementById('ce-bookmarks-fallback-sidebar');
  const header = sandbox._elements.sidebarInner.querySelector('.ce-bookmarks-native-header');
  const tab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  const content = sandbox.document.querySelector('.ce-bookmarks-content');

  assert.equal(fallback, null);
  assert.ok(header);
  assert.equal(header.parentElement, sandbox._elements.sidebarInner);
  assert.equal(header.getAttribute('data-ce-bookmarks-route'), 'item');
  assert.equal(header.children[0], tab);
  assert.equal(sandbox._elements.sidebarInner.children[0], header);
  assert.equal(content.parentElement, sandbox._elements.contentInner);
  assert.equal(pendingTrades.parentElement, sandbox._elements.contentInner);

  sandbox.window.togglePanel(true);

  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'true');
  assert.equal(tab.classList.contains('selected'), true);
  assert.equal(sandbox._elements.sidebarInner.classList.contains('ce-bookmarks-sidebar-active'), true);
});

test('adds Likes as a tab in the existing item page Pending Trades sidebar header', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  sandbox._elements.sidebarInner.removeChild(sandbox._elements.header);
  const pendingHeader = new FakeElement('div');
  pendingHeader.className = 'sidebar-header';
  pendingHeader.textContent = 'Pending Trades';
  const pendingTrades = new FakeElement('div');
  pendingTrades.className = 'pending-trades-list';
  sandbox._elements.sidebarInner.insertBefore(pendingHeader, sandbox._elements.sidebarInner.children[0] || null);
  sandbox._elements.contentInner.appendChild(pendingTrades);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();

  const fallback = sandbox.document.getElementById('ce-bookmarks-fallback-sidebar');
  const tab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  const pendingTab = Array.from(pendingHeader.children)
    .find(child => child.classList.contains('extra-sidebar-header__tab') && !child.classList.contains('ce-bookmarks-native-tab'));
  const content = sandbox.document.querySelector('.ce-bookmarks-content');

  assert.equal(fallback, null);
  assert.equal(tab.parentElement, pendingHeader);
  assert.ok(pendingTab);
  assert.match(pendingTab.innerHTML, />Trades</);
  assert.match(pendingTab.innerHTML, /fill-rule="evenodd"/);
  assert.match(pendingTab.innerHTML, /ms-size-\[14px\] mr-sm/);
  assert.equal(pendingHeader.classList.contains('extra-sidebar-header'), true);
  assert.equal(pendingHeader.classList.contains('ce-bookmarks-native-header'), true);
  assert.equal(pendingHeader.getAttribute('data-ce-bookmarks-route'), 'item');
  assert.deepEqual(pendingHeader.children, [pendingTab, tab]);
  assert.equal(content.parentElement, sandbox._elements.contentInner);
  assert.equal(pendingTrades.parentElement, sandbox._elements.contentInner);

  sandbox.window.togglePanel(true);
  assert.equal(tab.classList.contains('selected'), true);
  assert.equal(pendingTab.classList.contains('selected'), false);

  pendingTab.click();
  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'false');
  assert.equal(pendingTab.classList.contains('selected'), true);
  assert.equal(tab.classList.contains('selected'), false);
});

test('renders Steam thumbnail and delayed preview hover for liked items', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([
    {
      id: '358683082',
      marketName: 'Butterfly Knife | Doppler (Factory New) - Phase 1',
      iconUrl: 'https://community.steamstatic.com/economy/image/empire-icon-token/214x368',
      price: 3646.54,
      wear: 0.033,
      previewId: '320d9175cf6b',
      addedAt: 10,
    },
  ]));
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  sandbox.window.togglePanel(true);

  const trigger = sandbox.document.querySelector('.ce-bookmark-image-trigger');
  assert.ok(trigger);
  assert.equal(trigger.getAttribute('data-ce-preview-src'), 'https://inspect.csgoempire2.com/320d9175cf6b.jpg');
  assert.match(sandbox.document.querySelector('.ce-bookmarks-content').innerHTML, /https:\/\/community\.steamstatic\.com\/economy\/image\/empire-icon-token\/214x368/);
  assert.match(sandbox.document.querySelector('.ce-bookmarks-content').innerHTML, /ce-bookmark-zoom-icon/);

  trigger.dispatchEvent({ type: 'mouseenter', target: trigger });

  assert.equal(sandbox.document.querySelector('.ce-bookmark-preview-popover'), null);
  runTimers(sandbox, 500);
  const popover = sandbox.document.querySelector('.ce-bookmark-preview-popover');
  assert.ok(popover);
  assert.match(popover.innerHTML, /https:\/\/inspect\.csgoempire2\.com\/320d9175cf6b\.jpg/);
  assert.equal(popover.style.left, '8px');
  assert.equal(popover.style.top, '64px');
  assert.equal(popover.style.width, '884px');
  assert.equal(popover.style.maxHeight, '828px');

  trigger.dispatchEvent({ type: 'mouseleave', target: trigger });
  assert.equal(sandbox.document.querySelector('.ce-bookmark-preview-popover'), null);

  trigger.click();
  assert.deepEqual(sandbox._openCalls[0], ['https://inspect.csgoempire2.com/320d9175cf6b.jpg', '_blank', 'noopener,noreferrer']);
  assert.equal(sandbox.history.pushed, null);
});

test('does not hide native sidebar tabs when bookmarks content is active', () => {
  const css = fs.readFileSync(require.resolve('../css/style.css'), 'utf8');
  assert.match(css, /\.content__inner>:not\(\.ce-bookmarks-content\):not\(\.extra-sidebar-header\)/);
  assert.doesNotMatch(css, /\.content__inner>:not\(\.ce-bookmarks-content\)\{display:none!important;\}/);
});

test('fits native sidebar header with two or three tabs', () => {
  const css = fs.readFileSync(require.resolve('../css/style.css'), 'utf8');
  assert.doesNotMatch(css, /\.extra-sidebar-header\[data-ce-bookmarks-bound="true"\]>\.extra-sidebar-header__tab\{[^}]*height:46px!important/);
  assert.doesNotMatch(css, /\.extra-sidebar-header\[data-ce-bookmarks-bound="true"\]>\.extra-sidebar-header__tab\{[^}]*font-size:11\.25px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]\{[^}]*display:flex/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]\{[^}]*height:36px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]\{[^}]*min-height:36px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*display:flex!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*height:36px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*padding:0 16px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*background:rgb\(25,26,33\)!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*cursor:pointer!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*font-size:11\.25px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*font-weight:400!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*flex:0 1 auto!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\{[^}]*width:auto!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-tab-count="2"\]>\.extra-sidebar-header__tab\{[^}]*width:calc\(50% - 1px\)!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-tab-count="3"\]>\.extra-sidebar-header__tab\{[^}]*width:calc\(33\.333% - 2px\)!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]\[data-ce-bookmarks-tab-count="2"\]>\.extra-sidebar-header__tab\{[^}]*width:50%!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.ce-bookmarks-native-tab\{[^}]*display:flex!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab\.selected,\n\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab--selected\{[^}]*background:rgb\(29,30,38\)!important/);
  assert.doesNotMatch(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.ce-bookmarks-native-tab>\.ms-flex\{[^}]*margin-right/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab \.ellipsis\{[^}]*overflow:hidden!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab \.ellipsis\{[^}]*font-family:Flama,sans-serif!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab \.ellipsis\{[^}]*font-size:14px!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab \.ellipsis\{[^}]*font-weight:700!important/);
  assert.match(css, /\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]>\.extra-sidebar-header__tab \.ellipsis\{[^}]*line-height:16\.8px!important/);
  assert.match(css, /\.ce-bookmarks-sidebar-host:has\(\.extra-sidebar-header\[data-ce-bookmarks-route="item"\]\) \.ce-bookmarks-content\{padding-top:0;\}/);
});

test('sets the native sidebar component width to 300px', () => {
  const css = fs.readFileSync(require.resolve('../css/style.css'), 'utf8');
  assert.match(css, /div\.sidebar__component\{[^}]*width:300px!important/);
  assert.match(css, /div\.sidebar__component\{[^}]*flex-basis:300px!important/);
});

test('removes native fixed sidebar width class from Trades items', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  const row = new FakeElement('div');
  row.className = 'flex h-[42px] w-[--site-sidebar-width] items-center gap-md px-[12px] transition-colors duration-200 bg-yellow-2 bg-opacity-5';
  const lateRow = new FakeElement('div');
  lateRow.className = 'flex h-[42px] w-[--site-sidebar-width] items-center';
  const outside = new FakeElement('div');
  outside.className = 'w-[--site-sidebar-width]';

  sandbox._elements.contentInner.appendChild(row);
  sandbox.document.body.appendChild(outside);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  assert.equal(row.classList.contains('w-[--site-sidebar-width]'), false);
  assert.equal(row.classList.contains('h-[42px]'), true);
  assert.equal(outside.classList.contains('w-[--site-sidebar-width]'), true);

  sandbox._elements.contentInner.appendChild(lateRow);
  flushMutations(sandbox);

  assert.equal(lateRow.classList.contains('w-[--site-sidebar-width]'), false);
});

test('styles Likes sidebar background and Steam thumbnail size', () => {
  const css = fs.readFileSync(require.resolve('../css/style.css'), 'utf8');
  assert.match(css, /\.ce-bookmarks-fallback-sidebar\{[^}]*background:rgb\(29,30,38\)/);
  assert.match(css, /\.ce-bookmarks-content\{[^}]*background:rgb\(29,30,38\)/);
  assert.match(css, /\.ce-bookmarks-content\{[^}]*;height:calc\(100vh - 130px\)/);
  assert.match(css, /\.ce-bookmark-item\{[^}]*grid-template-columns:104px minmax\(0,1fr\) 28px/);
  assert.match(css, /\.ce-bookmark-item\{[^}]*background:rgb\(29,30,38\)/);
  assert.match(css, /\.ce-bookmark-item\{[^}]*border-bottom:1px solid rgb\(25,26,33\)/);
  assert.match(css, /\.ce-bookmark-name-muted\{[^}]*font-size:12px/);
  assert.match(css, /\.ce-bookmark-meta\{[^}]*display:flex/);
  assert.match(css, /\.ce-bookmark-meta\{[^}]*align-items:center/);
  assert.match(css, /\.ce-bookmark-price\{[^}]*line-height:14px/);
  assert.match(css, /\.ce-bookmark-wear\{[^}]*line-height:14px/);
  assert.match(css, /\.ce-bookmark-price-icon\{[^}]*width:14px/);
  assert.match(css, /\.ce-bookmark-price-icon\{[^}]*height:14px/);
  assert.match(css, /\.ce-bookmark-price-icon\{[^}]*fill:currentColor/);
  assert.match(css, /\.ce-bookmark-price-icon\{[^}]*color:#e9b10e/);
  assert.match(css, /\.ce-bookmark-image-trigger\{[^}]*width:104px/);
  assert.match(css, /\.ce-bookmark-image-trigger\{[^}]*height:69px/);
  assert.match(css, /\.ce-bookmark-image-trigger\{[^}]*background:transparent/);
  assert.match(css, /\.ce-bookmark-image\{[^}]*width:104px/);
  assert.match(css, /\.ce-bookmark-image\{[^}]*height:69px/);
  assert.match(css, /\.ce-bookmark-image\{[^}]*object-fit:contain/);
  assert.match(css, /\.ce-bookmark-image\{[^}]*background:transparent/);
});

test('moves a fallback bookmarks tab into the native header when sidebar renders late', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  sandbox.document.body.removeChild(sandbox._elements.sidebar);
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  const fallback = sandbox.document.getElementById('ce-bookmarks-fallback-sidebar');
  const fallbackTab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  assert.ok(fallback);
  assert.equal(fallbackTab.closest('#ce-bookmarks-fallback-sidebar'), fallback);

  sandbox.document.body.insertBefore(sandbox._elements.sidebar, sandbox.document.body.children[0] || null);
  sandbox.window.ensurePanel();

  assert.equal(fallbackTab.parentElement, sandbox._elements.header);
  assert.equal(sandbox.document.getElementById('ce-bookmarks-fallback-sidebar'), null);
  assert.deepEqual(sandbox._elements.header.children, [
    sandbox._elements.tradesTab,
    sandbox._elements.filtersTab,
    fallbackTab,
  ]);
});

test('moves item page fallback Likes into a late sidebar component without native header classes', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  sandbox.document.body.removeChild(sandbox._elements.sidebar);
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  const fallbackTab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  assert.ok(fallbackTab.closest('#ce-bookmarks-fallback-sidebar'));

  const component = new FakeElement('aside');
  component.className = 'sidebar__component';
  const title = new FakeElement('div');
  title.textContent = 'Pending Trades';
  component.appendChild(title);
  sandbox.document.body.appendChild(component);

  sandbox.window.ensurePanel();

  const header = component.querySelector('.extra-sidebar-header');
  const content = component.querySelector('.ce-bookmarks-content');
  assert.ok(header);
  assert.ok(content);
  assert.equal(fallbackTab.parentElement, header);
  assert.equal(sandbox.document.getElementById('ce-bookmarks-fallback-sidebar'), null);
  assert.equal(header.children[0].classList.contains('ce-bookmarks-native-tab'), false);
  assert.match(header.children[0].innerHTML, />Trades</);
});

test('does not convert the item page trade sidebar component into the Likes header', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  sandbox.document.body.removeChild(sandbox._elements.sidebar);
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();

  const sidebar = new FakeElement('div');
  sidebar.className = 'sidebar sidebar__desktop z-30';
  const inner = new FakeElement('div');
  inner.className = 'sidebar__inner';
  const component = new FakeElement('div');
  component.className = 'relative sidebar__component';
  component.setAttribute('data-testid', 'trade-sidebar');
  const title = new FakeElement('div');
  title.textContent = 'Pending Trades';
  component.appendChild(title);
  inner.appendChild(component);
  sidebar.appendChild(inner);
  sandbox.document.body.appendChild(sidebar);

  sandbox.window.ensurePanel();

  const header = inner.querySelector('.extra-sidebar-header');
  const content = inner.querySelector('.ce-bookmarks-content');
  assert.ok(header);
  assert.ok(content);
  assert.notEqual(header, component);
  assert.equal(component.classList.contains('extra-sidebar-header'), false);
  assert.equal(component.classList.contains('ce-bookmarks-native-header'), false);
  assert.equal(header.parentElement, component);
});

test('moves early item page Likes header into native Pending Trades header after refresh render', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  sandbox.document.body.removeChild(sandbox._elements.sidebar);
  sandbox.localStorage.setItem('ce_bookmarks_sidebar_open', 'true');

  const sidebar = new FakeElement('div');
  sidebar.className = 'sidebar sidebar__desktop z-30';
  sandbox.document.body.appendChild(sidebar);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  const earlyHeader = sidebar.querySelector('.ce-bookmarks-native-header');
  const tab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  assert.ok(earlyHeader);
  assert.equal(tab.parentElement, earlyHeader);
  assert.equal(sidebar.classList.contains('ce-bookmarks-sidebar-active'), true);

  const inner = new FakeElement('div');
  inner.className = 'sidebar__inner';
  const component = new FakeElement('div');
  component.className = 'relative sidebar__component';
  component.setAttribute('data-testid', 'trade-sidebar');
  const structure = new FakeElement('div');
  structure.className = 'sidebar-structure';
  const pendingHeader = new FakeElement('div');
  pendingHeader.className = 'simple-header text-light-1 [&_h5]:normal-case';
  pendingHeader.textContent = 'Pending Trades';
  const content = new FakeElement('div');
  content.className = 'content';
  const contentInner = new FakeElement('div');
  contentInner.className = 'content__inner';
  content.appendChild(contentInner);
  structure.appendChild(pendingHeader);
  structure.appendChild(content);
  component.appendChild(structure);
  inner.appendChild(component);
  sidebar.appendChild(inner);

  sandbox.window.ensurePanel();

  assert.equal(tab.parentElement, pendingHeader);
  assert.equal(pendingHeader.classList.contains('extra-sidebar-header'), true);
  assert.equal(pendingHeader.classList.contains('ce-bookmarks-native-header'), true);
  assert.equal(earlyHeader.parentElement, null);
  assert.equal(sidebar.classList.contains('ce-bookmarks-sidebar-active'), false);
  const activeAfterMove = Array.from(sandbox.document.querySelectorAll('.ce-bookmarks-sidebar-active'));
  assert.equal(activeAfterMove.length, 1);
  assert.equal(activeAfterMove[0].contains(pendingHeader), true);
  assert.equal(contentInner.querySelector('.ce-bookmarks-content'), sandbox.document.querySelector('.ce-bookmarks-content'));
  assert.match(pendingHeader.children[0].innerHTML, />Trades</);

  pendingHeader.children[0].click();
  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'false');
  assert.equal(sandbox.document.querySelectorAll('.ce-bookmarks-sidebar-active').length, 0);
});

test('moves item page fallback Likes into a late Pending Trades host without sidebar classes', () => {
  const sandbox = createSandbox({ pathname: '/item/356358612' });
  sandbox.document.body.removeChild(sandbox._elements.sidebar);
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  const fallbackTab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  assert.ok(fallbackTab.closest('#ce-bookmarks-fallback-sidebar'));

  const host = new FakeElement('aside');
  host.className = 'pending-trades-host';
  const title = new FakeElement('div');
  title.textContent = 'Pending Trades';
  host.appendChild(title);
  sandbox.document.body.appendChild(host);

  sandbox.window.ensurePanel();

  const header = host.querySelector('.extra-sidebar-header');
  const content = host.querySelector('.ce-bookmarks-content');
  assert.ok(header);
  assert.ok(content);
  assert.equal(fallbackTab.parentElement, header);
  assert.equal(sandbox.document.getElementById('ce-bookmarks-fallback-sidebar'), null);
  assert.match(header.children[0].innerHTML, />Trades</);
});

test('reinjects Likes tab after native sidebar header rerenders', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  flushMutations(sandbox);

  const firstTab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  assert.ok(firstTab);
  const timerCount = sandbox._timers.length;
  sandbox._elements.header.removeChild(firstTab);
  assert.equal(sandbox.document.querySelector('.ce-bookmarks-native-tab'), null);

  flushMutations(sandbox);

  assert.equal(sandbox._timers.length, timerCount);
  const tab = sandbox.document.querySelector('.ce-bookmarks-native-tab');
  assert.ok(tab);
  assert.equal(tab.parentElement, sandbox._elements.header);
  assert.deepEqual(sandbox._elements.header.children, [
    sandbox._elements.tradesTab,
    sandbox._elements.filtersTab,
    tab,
  ]);
});

test('selects clicked native tab on the first click after Likes was active', () => {
  const sandbox = createSandbox({ pathname: '/withdraw/steam/market' });
  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');

  sandbox.window.ensurePanel();
  sandbox.window.togglePanel(true);

  sandbox._elements.filtersTab.click();

  assert.equal(sandbox.localStorage.getItem('ce_bookmarks_sidebar_open'), 'false');
  assert.equal(sandbox._elements.filtersTab.classList.contains('selected'), true);
  assert.equal(sandbox._elements.filtersTab.classList.contains('extra-sidebar-header__tab--selected'), true);
  assert.equal(sandbox._elements.filtersTab.getAttribute('active'), 'true');
  assert.equal(sandbox._elements.filtersTab.getAttribute('aria-selected'), 'true');
  assert.equal(sandbox._elements.tradesTab.classList.contains('selected'), false);
  assert.equal(sandbox.document.querySelector('.ce-bookmarks-native-tab').classList.contains('selected'), false);
});

test('injects listing card star and toggles bookmark state', () => {
  const sandbox = createSandbox();
  const card = new FakeElement('div');
  card.className = 'item-card';
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const name = new FakeElement('p');
  name.textContent = 'M4A1-S | Printstream';
  const image = new FakeElement('img');
  image.setAttribute('src', 'https://example.com/printstream.png');
  link.appendChild(image);
  link.appendChild(name);
  card.appendChild(link);
  sandbox.document.body.appendChild(card);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'ui-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(card);
  const star = card.querySelector('.ce-card-bookmark-inline');
  assert.ok(star);
  assert.match(star.className, /hover:text-yellow-2/);
  assert.match(star.innerHTML, /ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-\[14px\] cursor-pointer/);
  assert.match(star.innerHTML, /ms-h-full ms-w-full/);
  assert.match(star.innerHTML, /ce-bookmark-heart-icon/);
  assert.doesNotMatch(star.innerHTML, /★/);

  star.click();
  assert.equal(sandbox.window.hasBookmark('555'), true);
  assert.equal(sandbox._fetchCalls[0][0], 'https://csgoempire.com/api/v2/trading/item/555');
  assert.equal(sandbox.window.loadBookmarks()[0].marketName, 'M4A1-S | Printstream');
  assert.equal(star.classList.contains('saved'), true);
});

test('places market card Like star before the native preview popover', () => {
  const sandbox = createSandbox();
  const card = new FakeElement('div');
  card.className = 'item-card';
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const previewActions = new FakeElement('div');
  previewActions.className = 'absolute bottom-md right-[12px]';
  const popover = new FakeElement('div');
  popover.className = 'popover-container relative preview-popover';
  card.appendChild(link);
  previewActions.appendChild(popover);
  card.appendChild(previewActions);
  sandbox.document.body.appendChild(card);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(card);
  const star = card.querySelector('.ce-card-bookmark-inline');

  assert.ok(star);
  assert.equal(star.parentElement, previewActions);
  assert.deepEqual(previewActions.children, [star, popover]);
  assert.equal(previewActions.classList.contains('w-full'), true);
  assert.equal(previewActions.classList.contains('ce-card-like-preview-actions'), true);
  assert.equal(popover.parentElement, previewActions);
});

test('places item page Similar items Like button before the Buy button', () => {
  const sandbox = createSandbox({ pathname: '/item/358464881' });
  const row = new FakeElement('div');
  row.className = 'similar-item-row';
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const image = new FakeElement('img');
  image.setAttribute('src', 'https://example.com/item.png');
  const actions = new FakeElement('div');
  actions.className = 'similar-item-actions';
  const price = new FakeElement('span');
  price.textContent = '11,503.40';
  const buy = new FakeElement('button');
  buy.className = 'touch-manipulation outline-none btn-secondary pop flex rounded font-[500] text-dark-5 hidden lg:block';
  buy.setAttribute('data-v-d2e6e3bb', '');
  buy.textContent = 'Buy';

  link.appendChild(image);
  actions.appendChild(price);
  actions.appendChild(buy);
  row.appendChild(link);
  row.appendChild(actions);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(row);
  sandbox.window.ensureCardStar(row);
  const heart = row.querySelector('.ce-similar-bookmark-button');

  assert.ok(heart);
  assert.equal(heart.parentElement, actions);
  assert.deepEqual(actions.children, [price, heart, buy]);
  assert.match(actions.className, /gap-2/);
  assert.match(actions.className, /ce-similar-bookmark-actions/);
  assert.match(heart.className, /touch-manipulation/);
  assert.match(heart.className, /btn-green/);
  assert.match(heart.className, /pop/);
  assert.match(heart.className, /flex/);
  assert.doesNotMatch(heart.className, /btn-secondary/);
  assert.doesNotMatch(heart.className, /hover:text-yellow-2/);
  assert.match(heart.className, /rounded/);
  assert.match(heart.className, /font-\[500\]/);
  assert.match(heart.className, /hidden/);
  assert.match(heart.className, /lg:block/);
  assert.equal(heart.getAttribute('data-v-d2e6e3bb'), '');
  assert.match(heart.innerHTML, /front items-center justify-center/);
  assert.match(heart.innerHTML, /flex items-center/);
  assert.match(heart.innerHTML, /ce-bookmark-heart-icon/);

  heart.click();
  assert.equal(sandbox.window.hasBookmark('555'), true);
  assert.match(heart.className, /btn-red/);
  assert.doesNotMatch(heart.className, /btn-green/);
  assert.ok(heart.querySelector('.ce-bookmark-broken-heart-icon'));
  assert.equal(heart.querySelector('.ce-bookmark-heart-icon'), null);
  assert.equal(sandbox._fetchCalls[0][0], 'https://csgoempire.com/api/v2/trading/item/555');
});

test('renders fade percentage badge on item page Similar items', async () => {
  const sandbox = createSandbox({ pathname: '/item/358464881' });
  sandbox.fetch = async (...args) => {
    sandbox._fetchCalls.push(args);
    return {
      ok: true,
      json: async () => ({ data: { item: { id: 555, fade_percentage: 97.6 } } }),
    };
  };
  const row = new FakeElement('div');
  row.className = 'similar-item-row';
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const details = new FakeElement('div');
  details.className = 'similar-item-details';
  details.textContent = 'Factory New ~0.063';
  const actions = new FakeElement('div');
  actions.className = 'similar-item-actions';
  const buy = new FakeElement('button');
  buy.textContent = 'Buy';

  actions.appendChild(buy);
  row.appendChild(link);
  row.appendChild(details);
  row.appendChild(actions);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(row);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sandbox._fetchCalls.length, 1);
  assert.equal(row.getAttribute('data-ce-similar-fade-state'), 'ready');
  assert.equal(details.children.length, 1);
  const badge = row.querySelector('.fade-percentage');
  assert.ok(badge);
  assert.equal(badge.tagName, 'P');
  assert.equal(badge.textContent, '97.6%');
  assert.equal(
    badge.className,
    'size-xs font-bold flex h-[14px] items-center justify-center rounded px-sm text-light-1 fade-percentage'
  );
  assert.equal(badge.parentElement, details);
  assert.equal(sandbox._fetchCalls.length, 1);

  sandbox.window.ensureCardStar(row);
  await Promise.resolve();
  assert.equal(sandbox._fetchCalls.length, 1);
});

test('renders blue percentage badge on item page Similar items', async () => {
  const sandbox = createSandbox({ pathname: '/item/356071890' });
  sandbox.fetch = async (...args) => {
    sandbox._fetchCalls.push(args);
    return {
      ok: true,
      json: async () => ({ data: { item: { id: 777, blue_percentage: 84.3 } } }),
    };
  };
  const row = new FakeElement('div');
  row.className = 'similar-item-row';
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/777');
  const details = new FakeElement('div');
  details.className = 'similar-item-details';
  const actions = new FakeElement('div');
  actions.className = 'similar-item-actions';
  const buy = new FakeElement('button');
  buy.textContent = 'Buy';

  actions.appendChild(buy);
  row.appendChild(link);
  row.appendChild(details);
  row.appendChild(actions);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(row);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sandbox._fetchCalls.length, 1);
  assert.equal(row.getAttribute('data-ce-similar-blue-state'), 'ready');
  const badge = row.querySelector('.blue-percentage');
  assert.ok(badge);
  assert.equal(badge.tagName, 'P');
  assert.equal(badge.textContent, '84.3%');
  assert.equal(
    badge.className,
    'size-xs font-bold flex h-[14px] items-center justify-center rounded px-sm text-light-1 blue-percentage'
  );
  assert.equal(badge.parentElement, details);

  sandbox.window.ensureCardStar(row);
  await Promise.resolve();
  assert.equal(sandbox._fetchCalls.length, 1);
});

test('adds fade and blue sort options to native Similar items sort dropdown', async () => {
  const sandbox = createSandbox({ pathname: '/item/356071890' });
  const fadeById = new Map([
    ['111', 91.2],
    ['222', 98.4],
    ['333', null],
  ]);
  const blueById = new Map([
    ['111', 40.5],
    ['222', 12.2],
    ['333', 98.7],
  ]);
  sandbox.fetch = async (...args) => {
    sandbox._fetchCalls.push(args);
    const id = String(args[0]).match(/\/item\/(\d+)/)[1];
    return {
      ok: true,
      json: async () => ({ data: { item: { id, fade_percentage: fadeById.get(id), blue_percentage: blueById.get(id) } } }),
    };
  };

  const heading = new FakeElement('h3');
  heading.textContent = 'Similar items';
  const closedSort = new FakeElement('div');
  closedSort.className = 'relative';
  const sortTrigger = new FakeElement('button');
  sortTrigger.textContent = 'Lowest Price First';
  const sortMenu = new FakeElement('ul');
  sortMenu.className = 'native-sort-menu';
  sortMenu.setAttribute('role', 'listbox');
  function sortOption(text) {
    const item = new FakeElement('li');
    item.className = 'native-sort-option flex h-[38px] w-full items-center rounded text-light-2 hover:bg-dark-2';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.setAttribute('data-headlessui-state', '');
    const label = new FakeElement('p');
    label.className = 'size-medium w-full';
    label.textContent = text;
    item.appendChild(label);
    return item;
  }
  const lowPrice = sortOption('Lowest Price First');
  lowPrice.className = 'native-sort-option flex h-[38px] w-full items-center rounded text-light-1 bg-dark-2 hover:bg-dark-2 selected';
  lowPrice.setAttribute('aria-selected', 'true');
  lowPrice.setAttribute('data-headlessui-state', 'selected');
  const highPrice = sortOption('Highest Price First');
  const list = new FakeElement('div');
  list.className = 'similar-items';

  function similarRow(id) {
    const row = new FakeElement('div');
    row.className = 'similar-item-row';
    const link = new FakeElement('a');
    link.setAttribute('href', `/item/${id}`);
    const details = new FakeElement('div');
    details.className = 'similar-item-details';
    const actions = new FakeElement('div');
    actions.className = 'similar-item-actions';
    const buy = new FakeElement('button');
    buy.textContent = 'Buy';

    actions.appendChild(buy);
    row.appendChild(link);
    row.appendChild(details);
    row.appendChild(actions);
    return row;
  }

  const row111 = similarRow('111');
  const row222 = similarRow('222');
  const row333 = similarRow('333');
  list.appendChild(row111);
  list.appendChild(row222);
  list.appendChild(row333);
  sortMenu.appendChild(lowPrice);
  sortMenu.appendChild(highPrice);
  closedSort.appendChild(sortTrigger);
  sandbox.document.body.appendChild(heading);
  sandbox.document.body.appendChild(closedSort);
  sandbox.document.body.appendChild(list);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.watchGrid();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(closedSort.querySelector('[data-ce-fade-sort="desc"]'), null);
  assert.equal(sandbox.document.querySelector('[data-ce-fade-sort="desc"]'), null);

  sandbox.document.body.appendChild(sortMenu);
  flushMutations(sandbox);

  const high = sandbox.document.querySelector('[data-ce-fade-sort="desc"]');
  const low = sandbox.document.querySelector('[data-ce-fade-sort="asc"]');
  const highBlue = sandbox.document.querySelector('[data-ce-blue-sort="desc"]');
  const lowBlue = sandbox.document.querySelector('[data-ce-blue-sort="asc"]');

  assert.equal(sandbox.document.querySelector('.ce-fade-sort-controls'), null);
  assert.ok(high);
  assert.ok(low);
  assert.ok(highBlue);
  assert.ok(lowBlue);
  assert.equal(high.parentElement, sortMenu);
  assert.equal(low.parentElement, sortMenu);
  assert.equal(highBlue.parentElement, sortMenu);
  assert.equal(lowBlue.parentElement, sortMenu);
  assert.equal(high.tagName, 'LI');
  assert.equal(highBlue.tagName, 'LI');
  assert.match(high.className, /native-sort-option/);
  assert.match(high.className, /ce-fade-sort-native-option/);
  assert.match(highBlue.className, /native-sort-option/);
  assert.match(highBlue.className, /ce-fade-sort-native-option/);
  assert.match(high.className, /text-light-2/);
  assert.doesNotMatch(high.className, /text-light-1/);
  assert.match(highBlue.className, /text-light-2/);
  assert.doesNotMatch(highBlue.className, /text-light-1/);
  assert.doesNotMatch(high.className, /(^|\s)bg-dark-2(\s|$)/);
  assert.doesNotMatch(high.className, /(^|\s)selected(\s|$)/);
  assert.equal(high.getAttribute('aria-selected'), 'false');
  assert.equal(high.getAttribute('data-headlessui-state'), '');
  assert.equal(high.querySelector('p').textContent, 'Highest Fade First');
  assert.equal(low.querySelector('p').textContent, 'Lowest Fade First');
  assert.equal(highBlue.querySelector('p').textContent, 'Highest Blue First');
  assert.equal(lowBlue.querySelector('p').textContent, 'Lowest Blue First');
  assert.equal(row111.getAttribute('data-ce-similar-fade-value'), '91.2');
  assert.equal(row222.getAttribute('data-ce-similar-fade-value'), '98.4');
  assert.equal(row333.getAttribute('data-ce-similar-fade-state'), 'empty');
  assert.equal(row111.getAttribute('data-ce-similar-blue-value'), '40.5');
  assert.equal(row222.getAttribute('data-ce-similar-blue-value'), '12.2');
  assert.equal(row333.getAttribute('data-ce-similar-blue-value'), '98.7');

  high.click();
  assert.deepEqual(list.children, [row222, row111, row333]);
  assert.equal(high.getAttribute('active'), 'true');
  assert.match(high.className, /text-light-1/);
  assert.doesNotMatch(high.className, /text-light-2/);

  low.click();
  assert.deepEqual(list.children, [row111, row222, row333]);
  assert.equal(low.getAttribute('active'), 'true');
  assert.match(high.className, /text-light-2/);
  assert.doesNotMatch(high.className, /text-light-1/);

  highBlue.click();
  assert.deepEqual(list.children, [row333, row111, row222]);
  assert.equal(highBlue.getAttribute('active'), 'true');
  assert.match(highBlue.className, /text-light-1/);
  assert.doesNotMatch(highBlue.className, /text-light-2/);
  assert.equal(low.getAttribute('active'), 'false');

  lowBlue.click();
  assert.deepEqual(list.children, [row222, row111, row333]);
  assert.equal(lowBlue.getAttribute('active'), 'true');
  assert.match(highBlue.className, /text-light-2/);
  assert.doesNotMatch(highBlue.className, /text-light-1/);
});

test('omits fade sort options when Similar items have no fade percentages', async () => {
  const sandbox = createSandbox({ pathname: '/item/356071890' });
  sandbox.fetch = async (...args) => {
    sandbox._fetchCalls.push(args);
    const id = String(args[0]).match(/\/item\/(\d+)/)[1];
    return {
      ok: true,
      json: async () => ({ data: { item: { id, fade_percentage: null, blue_percentage: id === '222' ? 80 : 20 } } }),
    };
  };

  const sortMenu = new FakeElement('ul');
  sortMenu.setAttribute('role', 'listbox');
  function sortOption(text) {
    const item = new FakeElement('li');
    item.className = 'native-sort-option flex h-[38px] w-full items-center rounded text-light-2 hover:bg-dark-2';
    item.setAttribute('role', 'option');
    const label = new FakeElement('p');
    label.className = 'size-medium w-full';
    label.textContent = text;
    item.appendChild(label);
    return item;
  }
  sortMenu.appendChild(sortOption('Lowest Price First'));
  sortMenu.appendChild(sortOption('Highest Price First'));

  const list = new FakeElement('div');
  function similarRow(id) {
    const row = new FakeElement('div');
    const link = new FakeElement('a');
    link.setAttribute('href', `/item/${id}`);
    const details = new FakeElement('div');
    const actions = new FakeElement('div');
    const buy = new FakeElement('button');
    buy.textContent = 'Buy';
    actions.appendChild(buy);
    row.appendChild(link);
    row.appendChild(details);
    row.appendChild(actions);
    return row;
  }
  const row111 = similarRow('111');
  const row222 = similarRow('222');
  list.appendChild(row111);
  list.appendChild(row222);
  sandbox.document.body.appendChild(sortMenu);
  sandbox.document.body.appendChild(list);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.watchGrid();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(sandbox.document.querySelector('[data-ce-fade-sort="desc"]'), null);
  assert.equal(sandbox.document.querySelector('[data-ce-fade-sort="asc"]'), null);
  assert.ok(sandbox.document.querySelector('[data-ce-blue-sort="desc"]'));
  assert.ok(sandbox.document.querySelector('[data-ce-blue-sort="asc"]'));
});

test('does not inject item Like buttons into Trades sidebar items', () => {
  const sandbox = createSandbox({ pathname: '/item/358464881' });
  const page = new FakeElement('div');
  page.className = 'item-page';
  const title = new FakeElement('h1');
  title.textContent = 'Current item';
  const mainActions = new FakeElement('div');
  const mainBuy = new FakeElement('button');
  mainBuy.textContent = 'Buy';
  const tradesRow = new FakeElement('div');
  tradesRow.className = 'pending-trades-list';
  const tradesLink = new FakeElement('a');
  tradesLink.setAttribute('href', '/item/555');
  const tradesActions = new FakeElement('div');
  const tradesBuy = new FakeElement('button');
  tradesBuy.textContent = 'Buy';

  mainActions.appendChild(mainBuy);
  page.appendChild(title);
  page.appendChild(mainActions);
  sandbox.document.body.appendChild(page);
  tradesActions.appendChild(tradesBuy);
  tradesRow.appendChild(tradesLink);
  tradesRow.appendChild(tradesActions);
  sandbox._elements.contentInner.appendChild(tradesRow);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.watchGrid();

  assert.equal(Boolean(tradesRow.querySelector('.ce-card-bookmark-inline')), false);
  assert.equal(Boolean(tradesRow.querySelector('.ce-similar-bookmark-button')), false);
  assert.ok(mainActions.querySelector('.ce-main-bookmark-button'));
});

test('shows broken heart and red button for already liked Similar items', () => {
  const sandbox = createSandbox({ pathname: '/item/358683082' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'M4A1-S | Printstream' }]));
  const row = new FakeElement('div');
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const actions = new FakeElement('div');
  const buy = new FakeElement('button');
  buy.className = 'touch-manipulation outline-none btn-secondary pop flex rounded font-[500] text-dark-5 hidden lg:block';
  buy.textContent = 'Buy';

  actions.appendChild(buy);
  row.appendChild(link);
  row.appendChild(actions);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(row);
  const heart = row.querySelector('.ce-similar-bookmark-button');

  assert.ok(heart);
  assert.match(heart.className, /saved/);
  assert.match(heart.className, /btn-red/);
  assert.doesNotMatch(heart.className, /btn-green/);
  assert.ok(heart.querySelector('.ce-bookmark-broken-heart-icon'));
  assert.equal(heart.querySelector('.ce-bookmark-heart-icon'), null);
});

test('does not rewrite an already synced saved Similar item heart on rescan', () => {
  const sandbox = createSandbox({ pathname: '/item/358683082' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'M4A1-S | Printstream' }]));
  const row = new FakeElement('div');
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const actions = new FakeElement('div');
  const buy = new FakeElement('button');
  buy.className = 'touch-manipulation outline-none btn-secondary pop flex rounded font-[500] text-dark-5 hidden lg:block';
  buy.textContent = 'Buy';

  actions.appendChild(buy);
  row.appendChild(link);
  row.appendChild(actions);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(row);
  const heart = row.querySelector('.ce-similar-bookmark-button');
  const icon = heart.querySelector('.ce-bookmark-broken-heart-icon');
  const buttonWrites = heart.innerHTMLWrites;
  const iconWrites = icon.innerHTMLWrites;

  sandbox.window.ensureCardStar(row);
  sandbox.window.ensureCardStar(row);

  assert.equal(heart.innerHTMLWrites, buttonWrites);
  assert.equal(icon.innerHTMLWrites, iconWrites);
  assert.ok(heart.querySelector('.ce-bookmark-broken-heart-icon'));
  assert.equal(heart.querySelector('.ce-bookmark-heart-icon'), null);
  assert.match(heart.className, /btn-red/);
});

test('keeps stretch item page Like and Buy buttons on one row', () => {
  const sandbox = createSandbox({ pathname: '/item/358464881' });
  const row = new FakeElement('div');
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/356358612');
  const actions = new FakeElement('div');
  actions.className = 'flex flex-wrap justify-center pt-lg gap-2';
  const buy = new FakeElement('button');
  buy.className = 'touch-manipulation outline-none btn-primary pop stretch flex rounded font-[500] text-dark-5';
  buy.setAttribute('data-v-d2e6e3bb', '');
  buy.setAttribute('data-v-63dfe463', '');
  buy.textContent = 'Buy';

  actions.appendChild(buy);
  row.appendChild(link);
  row.appendChild(actions);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(row);
  const heart = row.querySelector('.ce-similar-bookmark-button');

  assert.ok(heart);
  assert.equal(heart.parentElement, actions);
  assert.deepEqual(actions.children, [heart, buy]);
  assert.match(actions.className, /ce-similar-bookmark-actions/);
  assert.match(heart.className, /btn-green/);
  assert.doesNotMatch(heart.className, /stretch/);
  assert.match(buy.className, /stretch/);
  assert.match(heart.innerHTML, /ce-bookmark-heart-icon/);
});

test('uses solid 14px heart icons for item page and table row Like buttons', () => {
  const sandbox = createSandbox();
  const titleWrap = new FakeElement('div');
  const title = new FakeElement('h1');
  title.textContent = 'M4A1-S | Printstream';
  const row = new FakeElement('div');
  const byId = new Map([['777', { marketName: 'AK-47 | Redline' }]]);
  titleWrap.appendChild(title);
  sandbox.document.body.appendChild(titleWrap);
  sandbox.document.body.appendChild(row);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');
  runScript(sandbox, 'table-enhancer.js');

  const mainButton = sandbox.window.ensureMainStar();
  sandbox.window.enhanceRowById(row, '777', byId);
  const rowButton = row.querySelector('.ce-row-bookmark-button');

  assert.match(mainButton.innerHTML, /ce-bookmark-heart-icon/);
  assert.match(rowButton.innerHTML, /ce-bookmark-heart-icon/);
  assert.doesNotMatch(mainButton.innerHTML, /★/);
  assert.doesNotMatch(rowButton.innerHTML, /★/);
});

test('does not reinsert market card Like star when it is already before the preview popover', () => {
  const sandbox = createSandbox();
  const card = new FakeElement('div');
  card.className = 'item-card';
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const previewActions = new FakeElement('div');
  previewActions.className = 'absolute bottom-md right-[12px]';
  const popover = new FakeElement('div');
  popover.className = 'popover-container relative preview-popover';
  let insertCount = 0;
  const insertBefore = previewActions.insertBefore.bind(previewActions);
  previewActions.insertBefore = (child, reference) => {
    insertCount += 1;
    return insertBefore(child, reference);
  };
  card.appendChild(link);
  previewActions.appendChild(popover);
  card.appendChild(previewActions);
  sandbox.document.body.appendChild(card);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.ensureCardStar(card);
  sandbox.window.ensureCardStar(card);
  const star = card.querySelector('.ce-card-bookmark-inline');

  assert.equal(insertCount, 1);
  assert.deepEqual(previewActions.children, [star, popover]);
});

test('keeps item page Like star in the title area even when a preview popover exists', () => {
  const sandbox = createSandbox();
  const titleWrap = new FakeElement('div');
  const title = new FakeElement('h1');
  title.textContent = 'M4A1-S | Printstream';
  const previewActions = new FakeElement('div');
  previewActions.className = 'absolute bottom-md right-[12px]';
  const popover = new FakeElement('div');
  popover.className = 'popover-container relative preview-popover';
  titleWrap.appendChild(title);
  previewActions.appendChild(popover);
  sandbox.document.body.appendChild(titleWrap);
  sandbox.document.body.appendChild(previewActions);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  const star = sandbox.window.ensureMainStar();

  assert.ok(star);
  assert.equal(star.parentElement, titleWrap);
  assert.deepEqual(previewActions.children, [popover]);
  assert.equal(previewActions.classList.contains('w-full'), false);
});

test('resyncs item page Like button to the current route id on SPA navigation', () => {
  const sandbox = createSandbox({ pathname: '/item/111' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'Liked similar item' }]));
  const titleWrap = new FakeElement('div');
  const title = new FakeElement('h1');
  title.textContent = 'Current item';
  const similarRow = new FakeElement('div');
  const link = new FakeElement('a');
  link.setAttribute('href', '/item/555');
  const actions = new FakeElement('div');
  const buy = new FakeElement('button');
  buy.textContent = 'Buy';
  titleWrap.appendChild(title);
  actions.appendChild(buy);
  similarRow.appendChild(link);
  similarRow.appendChild(actions);
  sandbox.document.body.appendChild(titleWrap);
  sandbox.document.body.appendChild(similarRow);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  const mainButton = sandbox.window.ensureMainStar();
  sandbox.window.ensureCardStar(similarRow);
  assert.equal(mainButton.getAttribute('data-ce-bookmark-id'), '111');
  assert.equal(mainButton.classList.contains('not-saved'), true);
  assert.equal(mainButton.classList.contains('saved'), false);
  assert.equal(similarRow.querySelector('.ce-similar-bookmark-button').classList.contains('saved'), true);

  sandbox.window.location.pathname = '/item/222';
  const resynced = sandbox.window.ensureMainStar();

  assert.equal(resynced, mainButton);
  assert.equal(mainButton.getAttribute('data-ce-bookmark-id'), '222');
  assert.equal(mainButton.classList.contains('not-saved'), true);
  assert.equal(mainButton.classList.contains('saved'), false);
  assert.equal(mainButton.querySelector('.ce-bookmark-heart-icon') != null, true);
  assert.equal(mainButton.querySelector('.ce-bookmark-broken-heart-icon'), null);
  assert.equal(sandbox.document.querySelectorAll('.ce-main-bookmark-button').length, 1);
});

test('does not place a liked Similar item button beside the main item Buy button', () => {
  const sandbox = createSandbox({ pathname: '/item/111' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'Liked similar item' }]));
  const page = new FakeElement('div');
  page.className = 'item-page';
  const title = new FakeElement('h1');
  title.textContent = 'Current item';
  const mainActions = new FakeElement('div');
  mainActions.className = 'main-actions';
  const mainBuy = new FakeElement('button');
  mainBuy.className = 'touch-manipulation outline-none btn-primary pop stretch flex rounded font-[500] text-dark-5';
  mainBuy.setAttribute('data-v-d2e6e3bb', '');
  mainBuy.textContent = 'Buy';
  const similarContainer = new FakeElement('div');
  similarContainer.className = 'similar-items';
  const similarLink = new FakeElement('a');
  similarLink.setAttribute('href', '/item/555');

  mainActions.appendChild(mainBuy);
  similarContainer.appendChild(similarLink);
  page.appendChild(title);
  page.appendChild(mainActions);
  page.appendChild(similarContainer);
  sandbox.document.body.appendChild(page);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.watchGrid();
  sandbox.window.ensureMainStar();

  const mainButton = sandbox.document.querySelector('.ce-main-bookmark-button');
  assert.ok(mainButton);
  assert.equal(mainButton.getAttribute('data-ce-bookmark-id'), '111');
  assert.equal(mainButton.classList.contains('not-saved'), true);
  assert.equal(mainButton.classList.contains('saved'), false);
  assert.match(mainButton.className, /touch-manipulation/);
  assert.match(mainButton.className, /btn-primary/);
  assert.match(mainButton.className, /btn-green/);
  assert.match(mainButton.className, /pop/);
  assert.match(mainButton.className, /flex/);
  assert.match(mainButton.className, /rounded/);
  assert.doesNotMatch(mainButton.className, /stretch/);
  assert.doesNotMatch(mainButton.className, /btn-secondary/);
  assert.match(mainButton.className, /ce-main-bookmark-button-native/);
  assert.match(mainButton.innerHTML, /front items-center justify-center/);
  assert.match(mainButton.innerHTML, /ce-bookmark-heart-icon/);
  assert.equal(mainActions.querySelector('.ce-similar-bookmark-button'), null);
});

test('places the main item Like button beside the main Buy button without inheriting Similar item state', () => {
  const sandbox = createSandbox({ pathname: '/item/111' });
  sandbox.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([{ id: '555', marketName: 'Liked similar item' }]));
  const page = new FakeElement('div');
  page.className = 'item-page';
  const mainActions = new FakeElement('div');
  mainActions.className = 'main-actions';
  const mainBuy = new FakeElement('button');
  mainBuy.textContent = 'Buy';
  const similarRow = new FakeElement('div');
  similarRow.className = 'similar-item-row';
  const similarLink = new FakeElement('a');
  similarLink.setAttribute('href', '/item/555');
  const similarActions = new FakeElement('div');
  const similarBuy = new FakeElement('button');
  similarBuy.textContent = 'Buy';

  mainActions.appendChild(mainBuy);
  similarActions.appendChild(similarBuy);
  similarRow.appendChild(similarLink);
  similarRow.appendChild(similarActions);
  page.appendChild(mainActions);
  page.appendChild(similarRow);
  sandbox.document.body.appendChild(page);

  runScript(sandbox, 'bookmark-manager.js');
  runScript(sandbox, 'grid-helper.js');

  sandbox.window.watchGrid();

  const mainButton = mainActions.querySelector('.ce-main-bookmark-button');
  const similarButton = similarActions.querySelector('.ce-similar-bookmark-button');
  assert.ok(mainButton);
  assert.equal(mainButton.getAttribute('data-ce-bookmark-id'), '111');
  assert.equal(mainButton.classList.contains('not-saved'), true);
  assert.equal(mainButton.classList.contains('saved'), false);
  assert.equal(mainActions.querySelector('.ce-similar-bookmark-button'), null);
  assert.ok(similarButton);
  assert.equal(similarButton.getAttribute('data-ce-bookmark-id'), '555');
  assert.equal(similarButton.classList.contains('saved'), true);
});

test('styles market card Like and preview action row without moving the preview button', () => {
  const css = fs.readFileSync(require.resolve('../css/style.css'), 'utf8');
  assert.match(css, /\.ce-card-like-preview-actions\{[^}]*justify-content:flex-end/);
  assert.match(css, /\.ce-card-like-preview-actions\{[^}]*flex-direction:column/);
  assert.match(css, /\.ce-card-like-preview-actions\{[^}]*width:100%/);
  assert.match(css, /\.ce-card-like-preview-actions>\.popover-container\.preview-popover\{[^}]*flex:0 0 auto/);
  assert.match(css, /\.ce-card-like-preview-actions \.ce-card-bookmark-inline\{[^}]*position:static/);
  assert.match(css, /\.ce-card-like-preview-actions \.ce-card-bookmark-inline\{[^}]*width:auto/);
  assert.match(css, /\.ce-card-like-preview-actions \.ce-card-bookmark-inline\{[^}]*height:auto/);
  assert.match(css, /\.ce-card-like-preview-actions \.ce-card-bookmark-inline\{[^}]*background:transparent/);
  assert.match(css, /\.ce-card-like-preview-actions \.ce-card-bookmark-inline:hover\{[^}]*color:#e9b10e/);
  assert.match(css, /\.ce-bookmark-heart-icon\{[^}]*width:14px/);
  assert.match(css, /\.ce-bookmark-heart-icon\{[^}]*height:14px/);
  assert.match(css, /\.ce-bookmark-heart-icon\{[^}]*cursor:pointer/);
  assert.match(css, /\.ce-bookmark-broken-heart-icon\{[^}]*width:14px/);
  assert.match(css, /\.ce-bookmark-broken-heart-icon\{[^}]*height:14px/);
  assert.match(css, /\.ce-bookmark-broken-heart-icon\{[^}]*cursor:pointer/);
  assert.match(css, /\.ce-card-bookmark-inline:not\(\.ce-similar-bookmark-button\)\{[^}]*position:absolute/);
  assert.match(css, /\.ce-similar-bookmark-actions,\.ce-main-bookmark-actions\{[^}]*flex-wrap:nowrap!important/);
  assert.match(css, /\.ce-similar-bookmark-actions,\.ce-main-bookmark-actions\{[^}]*gap:8px!important/);
  assert.match(css, /\.ce-similar-bookmark-actions>\.ce-similar-bookmark-button\{[^}]*flex:0 0 auto!important/);
  assert.match(css, /\.ce-similar-bookmark-actions>\.ce-similar-bookmark-button\+button\{[^}]*flex:1 1 auto!important/);
  assert.match(css, /\.ce-main-bookmark-actions>\.ce-main-bookmark-button-native\{[^}]*flex:0 0 auto!important/);
  assert.match(css, /\.ce-main-bookmark-actions>\.ce-main-bookmark-button-native\+button\{[^}]*flex:1 1 auto!important/);
  assert.match(css, /\.ce-similar-bookmark-button \.ce-bookmark-heart-icon,\n\.ce-similar-bookmark-button \.ce-bookmark-broken-heart-icon,\n\.ce-main-bookmark-button-native \.ce-bookmark-heart-icon,\n\.ce-main-bookmark-button-native \.ce-bookmark-broken-heart-icon\{[^}]*color:#fff/);
  assert.match(css, /\.ce-similar-bookmark-button \.ce-bookmark-heart-icon,\n\.ce-similar-bookmark-button \.ce-bookmark-broken-heart-icon,\n\.ce-main-bookmark-button-native \.ce-bookmark-heart-icon,\n\.ce-main-bookmark-button-native \.ce-bookmark-broken-heart-icon\{[^}]*fill:#fff/);
  assert.match(css, /\.fade-percentage\{[^}]*background:linear-gradient\(103deg,#f58647cc -1\.44%,#f54747cc 14\.82%,#e800fccc 63\.11%,#6331cccc 99\.32%\)/);
  assert.doesNotMatch(css, /\.fade-percentage\{[^}]*box-shadow:0 0 15px #71205e/);
  assert.match(css, /\.fade-percentage:hover\{[^}]*box-shadow:0 0 15px #71205e/);
  assert.match(css, /\.fade-percentage\{[^}]*width:fit-content/);
  assert.match(css, /\.fade-percentage\{[^}]*align-self:flex-start/);
  assert.match(css, /\.blue-percentage\{[^}]*background:linear-gradient\(104deg,#00b0fcb3 -1\.44%,#739affb3 108\.1%\)/);
  assert.doesNotMatch(css, /\.blue-percentage\{[^}]*box-shadow:0 0 15px #075fd399/);
  assert.match(css, /\.blue-percentage:hover\{[^}]*box-shadow:0 0 15px #075fd399/);
  assert.match(css, /\.blue-percentage\{[^}]*width:fit-content/);
  assert.match(css, /\.blue-percentage\{[^}]*align-self:flex-start/);
  assert.doesNotMatch(css, /\.ce-fade-sort-controls\{/);
  assert.match(css, /\.ce-fade-sort-native-option\{[^}]*cursor:pointer/);
  assert.doesNotMatch(css, /\.ce-similar-bookmark-button:hover/);
});

test('route handler is safe when optional enhancers are absent', () => {
  const sandbox = createSandbox();
  runScript(sandbox, 'route-handler.js');

  assert.doesNotThrow(() => sandbox.window.onRouteChange());
});
