(() => {
  const dbg = (tag, ...args) => {
    try {
      if (typeof window !== 'undefined' && window.debugUtils && window.debugUtils.dbg) {
        window.debugUtils.dbg(tag, ...args);
      } else {
        console.log(`[${tag}]`, ...args);
      }
    } catch (e) {
      console.log(`[${tag}]`, ...args);
    }
  };

  dbg('sniffer', '[Empire] Script started');

  const TARGET_PATH = '/api/v2/metadata/exchange-rates';
  const WEBSOCKET_FEATURE_KEY = 'ce_websocket_likes_enabled';

  const $open = XMLHttpRequest.prototype.open;
  const $send = XMLHttpRequest.prototype.send;

  function saveExchangeRates(data) {
    try {
      localStorage.setItem('exchangeRates', JSON.stringify(data));
      localStorage.setItem('exchangeRatesLastUpdated', new Date().toISOString());
      console.log('[Empire] Exchange rates saved to localStorage:', data);
    } catch (err) {
      console.error('[Empire] Failed to save exchange rates:', err);
    }
  }

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const value = typeof url === 'string' ? url : '';
    const isExchangeRatesRequest = value.includes(TARGET_PATH);
    if (isExchangeRatesRequest) {
      this.__empire_isTarget = true;
    } else {
      this.__empire_isTarget = false;
    }
    return $open.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__empire_isTarget) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          const rates = data && (data.rates || (data.currency_exchange_rates && data.currency_exchange_rates.rates));
          if (rates) saveExchangeRates(data);
        } catch (err) {
          console.error('[Empire] XMLHttpRequest response JSON parse failed:', err);
        }
      });
    }
    return $send.apply(this, args);
  };

  function parseSocketMessage(data) {
    if (typeof data !== 'string') return null;
    const text = data.trim();
    if (!text) return null;

    const jsonStart = text.indexOf('[');
    if (jsonStart < 0) return null;

    try {
      return JSON.parse(text.slice(jsonStart));
    } catch (err) {
      return null;
    }
  }

  function isWebSocketFeatureEnabled() {
    try {
      return localStorage.getItem(WEBSOCKET_FEATURE_KEY) === 'true';
    } catch (err) {
      return false;
    }
  }

  const TRADE_EVENTS = [
    'new_item',
    'updated_item',
    'item_update',
    'item_updated',
    'deleted_item',
    'removed_item',
    'sold_item',
    'item_deleted',
    'item_removed',
    'item_sold',
  ];

  function isTradeSocketUrl(url) {
    return /trade|socket\.io/i.test(String(url || ''));
  }

  function subscribeTradeEvents(socket, url) {
    if (!socket || socket.__ceEmpirePlusSubscribed || !isTradeSocketUrl(url)) return;
    socket.__ceEmpirePlusSubscribed = true;
    try {
      socket.send(`42/trade,["allowedEvents",{"events":${JSON.stringify(TRADE_EVENTS)}}]`);
    } catch (err) {
      socket.__ceEmpirePlusSubscribed = false;
    }
  }

  function installWebSocketSniffer() {
    if (window.__ceEmpirePlusWebSocketHooked) return;
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== 'function') return;

    function WrappedWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      const url = args[0];
      try {
        socket.addEventListener('open', () => subscribeTradeEvents(socket, url));
        if (socket.readyState === NativeWebSocket.OPEN || socket.readyState === window.WebSocket.OPEN) {
          subscribeTradeEvents(socket, url);
        }
        socket.addEventListener('message', event => {
          const payload = parseSocketMessage(event && event.data);
          if (!payload) return;
          window.postMessage({
            source: 'csgoempire-plus',
            type: 'CE_WEBSOCKET_EVENT',
            payload,
          }, '*');
        });
      } catch (err) {
        // Leave the native socket behavior untouched if listener binding fails.
      }
      return socket;
    }

    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    try {
      Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
    } catch (err) {
      // ignored in older browser contexts
    }

    window.WebSocket = WrappedWebSocket;
    window.__ceEmpirePlusWebSocketHooked = true;
  }

  if (isWebSocketFeatureEnabled()) installWebSocketSniffer();

  dbg('sniffer', '[Empire] Running directly in page context');
})();
