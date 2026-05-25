// Extension initialization

(function () {
  'use strict';

  if (window.__ce_extension_initializer__) return;
  window.__ce_extension_initializer__ = true;

  function dbg(tag, ...args) {
    try {
      if (window.debugUtils && window.debugUtils.dbg) window.debugUtils.dbg(tag, ...args);
      else console.log(`[${tag}]`, ...args);
    } catch (e) {
      console.log(`[${tag}]`, ...args);
    }
  }

  function safeCall(name, ...args) {
    try {
      if (typeof window[name] === 'function') return window[name](...args);
    } catch (error) {
      console.warn(`[ce] ${name} failed:`, error);
    }
    return null;
  }

  function start() {
    dbg('init', '[Init.js] Initialization starting');
    safeCall('ensurePanel');
    safeCall('renderList');
    safeCall('ensureNavLink', { retries: 30, interval: 150 });
    safeCall('watchGrid');
    if ((window.location.pathname || '').includes('/item/')) {
      safeCall('runItemEnhancer');
      safeCall('ensureMainStar');
    }
    safeCall('onRouteChange');
    dbg('init', '[Init.js] Initialization complete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
