// SPA route handling for bookmark and item-page enhancers

(function () {
  'use strict';

  if (window.__ce_bookmarks_route_handler__) return;
  window.__ce_bookmarks_route_handler__ = true;

  let lastRouteKey = `${window.location.pathname || ''}${window.location.search || ''}`;

  function safeCall(name, ...args) {
    try {
      if (typeof window[name] === 'function') return window[name](...args);
    } catch (error) {
      console.warn(`[ce] ${name} failed:`, error);
    }
    return null;
  }

  function onRouteChange() {
    const path = window.location.pathname || '';
    safeCall('ensureNavLink', { retries: 5, interval: 120 });

    if (path.includes('/item/')) {
      setTimeout(() => {
        safeCall('ensureMainStar');
        safeCall('runItemEnhancer');
      }, 150);
    }

    if (path.startsWith('/withdraw/steam/market') || path.includes('/market')) {
      setTimeout(() => safeCall('watchGrid'), 120);
    } else {
      safeCall('watchGrid');
    }

    setTimeout(() => {
      safeCall('renderList');
      safeCall('syncAllStates');
    }, 250);
  }

  function dispatchRouteChange() {
    window.dispatchEvent(new Event('ce:route'));
  }

  function hookHistory() {
    if (!window.history || window.history.__ceBookmarksHooked) return;
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function (...args) {
      const result = push.apply(this, args);
      dispatchRouteChange();
      return result;
    };
    history.replaceState = function (...args) {
      const result = replace.apply(this, args);
      dispatchRouteChange();
      return result;
    };
    history.__ceBookmarksHooked = true;
  }

  function watchAddressChanges() {
    if (typeof setInterval !== 'function') return;
    setInterval(() => {
      const routeKey = `${window.location.pathname || ''}${window.location.search || ''}`;
      if (routeKey === lastRouteKey) return;
      lastRouteKey = routeKey;
      dispatchRouteChange();
    }, 300);
  }

  const debounceFn = window.debounce || ((fn, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  });

  hookHistory();
  watchAddressChanges();
  window.addEventListener('popstate', dispatchRouteChange, { passive: true });
  window.addEventListener('ce:route', debounceFn(onRouteChange, 60), { passive: true });
  window.onRouteChange = onRouteChange;
})();
