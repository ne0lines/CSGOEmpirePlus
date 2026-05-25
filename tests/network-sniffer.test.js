const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runNetworkSniffer(sandbox) {
  const source = fs.readFileSync(require.resolve('../scripts/network-sniffer.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'network-sniffer.js' });
}

function makeLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test('loads fetch injector before other content scripts so websocket hook installs early', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.equal(scripts[0], 'scripts/fetch-injector.js');
  assert.ok(scripts.indexOf('scripts/fetch-injector.js') < scripts.indexOf('scripts/dom-content.js'));
});

test('forwards CSGOEmpire websocket JSON events to content scripts', () => {
  const posted = [];
  const sockets = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.sent = [];
      sockets.push(this);
    }

    addEventListener(type, callback) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(callback);
    }

    emit(type, event) {
      (this.listeners[type] || []).forEach(callback => callback(event));
    }

    send(data) {
      this.sent.push(data);
    }
  }

  function FakeXMLHttpRequest() {}
  FakeXMLHttpRequest.prototype.open = function () {};
  FakeXMLHttpRequest.prototype.send = function () {};

  const sandbox = {
    window: {
      WebSocket: FakeWebSocket,
      postMessage(message) {
        posted.push(message);
      },
    },
    WebSocket: FakeWebSocket,
    XMLHttpRequest: FakeXMLHttpRequest,
    localStorage: makeLocalStorage({ ce_websocket_likes_enabled: 'true' }),
    console,
    Object,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.XMLHttpRequest = FakeXMLHttpRequest;

  runNetworkSniffer(sandbox);

  const socket = new sandbox.window.WebSocket('wss://example.test/trade');
  socket.emit('message', { data: '42/trade,["updated_item",[{"id":358784255,"market_value":14706}]]' });
  socket.emit('message', { data: 'not json' });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].source, 'csgoempire-plus');
  assert.equal(posted[0].type, 'CE_WEBSOCKET_EVENT');
  assert.deepEqual(JSON.parse(JSON.stringify(posted[0].payload)), ['updated_item', [{ id: 358784255, market_value: 14706 }]]);
});

test('does not hook websockets unless websocket feature flag is enabled', () => {
  class FakeWebSocket {
    constructor() {
      this.listeners = {};
    }

    addEventListener(type, callback) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(callback);
    }
  }

  function FakeXMLHttpRequest() {}
  FakeXMLHttpRequest.prototype.open = function () {};
  FakeXMLHttpRequest.prototype.send = function () {};

  const sandbox = {
    window: {
      WebSocket: FakeWebSocket,
      postMessage() {},
    },
    WebSocket: FakeWebSocket,
    XMLHttpRequest: FakeXMLHttpRequest,
    localStorage: makeLocalStorage(),
    console,
    Object,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.XMLHttpRequest = FakeXMLHttpRequest;

  runNetworkSniffer(sandbox);

  assert.equal(sandbox.window.WebSocket, FakeWebSocket);
  assert.equal(sandbox.window.__ceEmpirePlusWebSocketHooked, undefined);
});

test('subscribes to CSGOEmpire trade websocket events on socket open', () => {
  const sockets = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.sent = [];
      sockets.push(this);
    }

    addEventListener(type, callback) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(callback);
    }

    send(data) {
      this.sent.push(data);
    }

    emit(type, event) {
      (this.listeners[type] || []).forEach(callback => callback(event));
    }
  }
  FakeWebSocket.OPEN = 1;

  function FakeXMLHttpRequest() {}
  FakeXMLHttpRequest.prototype.open = function () {};
  FakeXMLHttpRequest.prototype.send = function () {};

  const sandbox = {
    window: {
      WebSocket: FakeWebSocket,
      postMessage() {},
    },
    WebSocket: FakeWebSocket,
    XMLHttpRequest: FakeXMLHttpRequest,
    localStorage: makeLocalStorage({ ce_websocket_likes_enabled: 'true' }),
    console,
    Object,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.XMLHttpRequest = FakeXMLHttpRequest;

  runNetworkSniffer(sandbox);

  const socket = new sandbox.window.WebSocket('wss://trade.csgoempire.com/socket.io/?transport=websocket');
  socket.emit('open', {});

  assert.equal(socket.sent.length, 1);
  assert.match(socket.sent[0], /^42\/trade,/);
  assert.match(socket.sent[0], /updated_item/);
  assert.match(socket.sent[0], /deleted_item/);
});
