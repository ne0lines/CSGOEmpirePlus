(function () {
  const TARGET_URL = 'https://csgoempire.com/api/v2/metadata/exchange-rates';

  function saveExchangeRates(data) {
    try {
      localStorage.setItem('exchangeRates', JSON.stringify(data));
      localStorage.setItem('exchangeRatesLastUpdated', new Date().toISOString());
      window.postMessage({ source: 'csgoempire-plus', type: 'CE_EXCHANGE_RATES', payload: data }, '*');
    } catch (err) {
      console.warn('[CSGOEmpire Plus] Failed to store exchange rates:', err);
    }
  }

  function isTarget(url) {
    return typeof url === 'string' && url.includes(TARGET_URL);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const input = args[0];
    const url = typeof input === 'string' ? input : input && input.url;
    const response = await originalFetch.apply(this, args);

    if (isTarget(url)) {
      response.clone().json().then(saveExchangeRates).catch(() => {});
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ce_exchange_rates_target = isTarget(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__ce_exchange_rates_target) {
      this.addEventListener('load', function () {
        try {
          saveExchangeRates(JSON.parse(this.responseText));
        } catch (err) {
          // Ignore non-JSON responses.
        }
      });
    }
    return originalSend.apply(this, args);
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('scripts/network-sniffer.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    }
  } catch (err) {
    // Page context cannot always access chrome.runtime.
  }
})();
