// Bookmark sidebar UI

(function () {
  'use strict';

  const SIDEBAR_OPEN_KEY = 'ce_bookmarks_sidebar_open';
  const FALLBACK_ID = 'ce-bookmarks-fallback-sidebar';
  const CONTENT_CLASS = 'ce-bookmarks-content';
  const TAB_CLASS = 'ce-bookmarks-native-tab';
  const STEAM_MARKET_PATH = '/withdraw/steam/market';
  const NATIVE_SIDEBAR_FIXED_WIDTH_CLASS = 'w-[--site-sidebar-width]';
  const HEART_PATH_HTML = '<path d="M7 12.4 5.98 11.5C2.35 8.28.5 6.65.5 4.25.5 2.3 2.03.8 3.98.8 5.08.8 6.14 1.31 6.82 2.12L7 2.34l.18-.22A3.73 3.73 0 0 1 10.02.8c1.95 0 3.48 1.5 3.48 3.45 0 2.4-1.85 4.03-5.48 7.25z"></path>';
  const BROKEN_HEART_PATH_HTML = '<path d="M6.23 12.42 5.41 11.7C2.13 8.82.5 7.36.5 5.12.5 3.16 2.03 1.66 3.98 1.66c.91 0 1.79.35 2.45.94L5.3 5.08l1.46 1.14-1.13 2.14 1.32 1.03-.72 3.03Z"></path><path d="m7.64 11.95.95-.84c3.28-2.9 4.91-4.35 4.91-6.59 0-1.96-1.53-3.46-3.48-3.46-1.02 0-2.01.44-2.68 1.14L6.3 4.45l1.5 1.17-1.13 2.14 1.37 1.06-.4 3.13Z"></path>';
  const BOOKMARK_ICON_HTML = `
    <div class="ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-[14px] mr-sm">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="ce-bookmark-heart-icon ms-h-full ms-w-full" viewBox="0 0 14 14" aria-hidden="true">
        ${HEART_PATH_HTML}
      </svg>
    </div>
    <h4 class="ellipsis">Likes</h4>
  `;
  const PENDING_TRADES_ICON_HTML = `
    <div class="ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-[14px] mr-sm">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="ms-h-full ms-w-full" viewBox="0 0 14 14" aria-hidden="true">
        <path fill-rule="evenodd" d="M10.566 1.434a.8.8 0 0 1 0 1.132L3.419 9.712c-.819.82-2.219.24-2.219-.92V5a.8.8 0 1 1 1.6 0v3.069l6.634-6.635a.8.8 0 0 1 1.132 0M3.434 12.566a.8.8 0 0 1 0-1.132l7.147-7.146c.819-.82 2.219-.24 2.219.92V9a.8.8 0 0 1-1.6 0V5.931l-6.634 6.635a.8.8 0 0 1-1.132 0" clip-rule="evenodd"></path>
      </svg>
    </div>
    <h4 class="ellipsis">Trades</h4>
  `;
  let activeHost = null;
  let mountObserver = null;
  let mountRefreshing = false;
  let previewTimer = null;
  let previewPopover = null;
  let pricingSignature = '';
  let pricingObserver = null;

  function bookmarksApi() {
    return window.ceBookmarks || {
      loadBookmarks: window.loadBookmarks,
      hasBookmark: window.hasBookmark,
      removeBookmark: window.removeBookmark,
      clearAllBookmarks: window.clearAllBookmarks,
    };
  }

  function escapeText(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  function readOpenState() {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function readPricingSignature() {
    try {
      return `${localStorage.getItem('currency') || ''}|${localStorage.getItem('exchangeRates') || ''}`;
    } catch (e) {
      return '';
    }
  }

  function writeOpenState(open) {
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, open ? 'true' : 'false');
    } catch (e) {
      // ignored
    }
  }

  function isSteamMarketRoute() {
    const path = String(window.location && window.location.pathname || '').replace(/\/+$/, '');
    return path === STEAM_MARKET_PATH || path.startsWith(`${STEAM_MARKET_PATH}/`);
  }

  function isItemRoute() {
    const path = String(window.location && window.location.pathname || '');
    return /\/(?:trading\/)?item\/[^/]+/.test(path);
  }

  function isBookmarksSidebarRoute() {
    return isSteamMarketRoute() || isItemRoute();
  }

  function removeElement(element) {
    if (element && element.parentNode) element.parentNode.removeChild(element);
  }

  function removeAttributeValue(element, name) {
    if (!element) return;
    if (typeof element.removeAttribute === 'function') {
      element.removeAttribute(name);
    } else if (element.attributes) {
      delete element.attributes[name];
    }
    if (name.startsWith('data-') && element.dataset) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete element.dataset[key];
    }
  }

  function findSidebarHost() {
    return document.querySelector('.sidebar__inner') ||
      document.querySelector('.sidebar') ||
      document.querySelector('.sidebar__component') ||
      document.querySelector('[data-testid="trade-sidebar"]') ||
      null;
  }

  function removeNativeSidebarFixedWidthClasses(root) {
    const hosts = root
      ? [root]
      : Array.from(document.querySelectorAll('.sidebar,.sidebar__inner,.sidebar__component,[data-testid="trade-sidebar"]'));
    const seen = new Set();
    const scrub = element => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      if (element.classList && element.classList.contains(NATIVE_SIDEBAR_FIXED_WIDTH_CLASS)) {
        element.classList.remove(NATIVE_SIDEBAR_FIXED_WIDTH_CLASS);
      }
    };

    hosts.forEach(host => {
      scrub(host);
      Array.from(host && host.querySelectorAll ? host.querySelectorAll('[class]') : []).forEach(scrub);
    });
  }

  function findChild(parent, selector) {
    return Array.from(parent && parent.children || []).find(child => child.matches && child.matches(selector)) || null;
  }

  function findDescendant(parent, selector) {
    return parent && parent.querySelector ? parent.querySelector(selector) : null;
  }

  function findNativeHeader() {
    return Array.from(document.querySelectorAll('.extra-sidebar-header'))
      .find(header =>
        !header.matches('.sidebar__component,[data-testid="trade-sidebar"]') &&
        !header.closest(`#${FALLBACK_ID}`) &&
        !header.closest('.ce-bookmarks-fallback-sidebar')
      ) || null;
  }

  function isPendingTradesHeader(element) {
    const text = (element && element.textContent || '').replace(/\s+/g, ' ').trim();
    return /^pending\s+trades$/i.test(text) ||
      (/^pending\s+trades\b/i.test(text) && text.length <= 40);
  }

  function isSidebarHostElement(element) {
    return Boolean(element && element.matches &&
      element.matches('.sidebar,.sidebar__inner,.sidebar__component,[data-testid="trade-sidebar"]'));
  }

  function findPendingTradesCandidates(root) {
    const headerSelector = '.simple-header,.sidebar-header,.sidebar__header,.sidebar-header__title,.sidebar-title,[class*="sidebar"][class*="header"]';
    return Array.from(root && root.querySelectorAll ? root.querySelectorAll(headerSelector) : [])
      .concat(Array.from(root && root.children || []))
      .concat(Array.from(root && root.querySelectorAll ? root.querySelectorAll('div') : []));
  }

  function findPendingTradesHeader(root) {
    if (!isItemRoute() || !root) return null;
    return findPendingTradesCandidates(root).find(element =>
      element &&
      !isSidebarHostElement(element) &&
      !element.closest(`#${FALLBACK_ID}`) &&
      !element.closest('.ce-bookmarks-fallback-sidebar') &&
      isPendingTradesHeader(element)
    ) || null;
  }

  function findItemSidebarHostFromPendingTrades() {
    const pendingHeader = findPendingTradesHeader(document);
    if (!pendingHeader) return null;
    return pendingHeader.closest('.sidebar__inner') ||
      pendingHeader.closest('.sidebar') ||
      pendingHeader.closest('.sidebar__component') ||
      pendingHeader.closest('[data-testid="trade-sidebar"]') ||
      pendingHeader.parentElement ||
      null;
  }

  function findNativeSidebarParts() {
    const pendingHeader = isItemRoute() ? findPendingTradesHeader(document) : null;
    const header = pendingHeader || findNativeHeader();
    const root = pendingHeader
      ? (pendingHeader.closest('.sidebar__component') || pendingHeader.closest('[data-testid="trade-sidebar"]') || pendingHeader.closest('.sidebar__inner') || pendingHeader.closest('.sidebar') || pendingHeader.parentElement)
      : header
        ? (header.closest('.sidebar__inner') || header.closest('.sidebar') || header.closest('.sidebar__component') || header.parentElement)
      : (isItemRoute() ? (findSidebarHost() || findItemSidebarHostFromPendingTrades()) : null);
    if (!root) return null;
    const structure = findChild(root, '.sidebar-structure') ||
      findDescendant(root, '.sidebar-structure') ||
      document.querySelector('.sidebar-structure');
    const content = findChild(structure, '.content') ||
      findDescendant(structure, '.content');
    const contentInner = findChild(content, '.content__inner') ||
      findDescendant(content, '.content__inner') ||
      document.querySelector('.content__inner');

    if (!header && !isItemRoute()) return null;
    return {
      root: root || header.parentElement,
      header,
      contentMount: contentInner || (isItemRoute() ? root : null),
    };
  }

  function ensureFallbackHost() {
    if (!document.body) return null;
    let host = document.getElementById(FALLBACK_ID);
    if (!host) {
      host = document.createElement('aside');
      host.id = FALLBACK_ID;
      host.className = 'ce-bookmarks-fallback-sidebar';
      document.body.appendChild(host);
    }
    return host;
  }

  function removeFallbackHost() {
    const fallback = document.getElementById(FALLBACK_ID);
    if (fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback);
  }

  function cleanupPanel() {
    removePreviewPopover();
    removeFallbackHost();
    Array.from(document.querySelectorAll(`.${TAB_CLASS}`)).forEach(removeElement);
    Array.from(document.querySelectorAll(`.${CONTENT_CLASS}`)).forEach(removeElement);
    Array.from(document.querySelectorAll('.extra-sidebar-header')).forEach(header => {
      removeAttributeValue(header, 'data-ce-bookmarks-tab-count');
    });
    Array.from(document.querySelectorAll('.ce-bookmarks-sidebar-host')).forEach(host => {
      host.classList.remove('ce-bookmarks-sidebar-host', 'ce-bookmarks-sidebar-active', 'ce-bookmarks-fallback-host');
    });
    activeHost = null;
  }

  function copyVueScopeAttributes(source, target) {
    if (!source || !target) return;
    const directNames = typeof source.getAttributeNames === 'function' ? source.getAttributeNames() : [];
    const attrNames = source.attributes
      ? Array.from(source.attributes).map(attr => attr && attr.name).filter(Boolean)
      : [];
    Array.from(new Set(directNames.concat(attrNames)))
      .filter(name => /^data-v-/.test(name))
      .forEach(name => target.setAttribute(name, source.getAttribute(name) || ''));
  }

  function syncTabScopeAttributes(header, tab) {
    if (!header || !tab) return;
    const nativeTab = Array.from(header.querySelectorAll('.extra-sidebar-header__tab'))
      .find(item => item !== tab && !item.classList.contains(TAB_CLASS));
    const nativeIcon = nativeTab && nativeTab.querySelector('.ms-flex');
    const nativeLabel = nativeTab && nativeTab.querySelector('h4');
    const icon = tab.querySelector('.ms-flex');
    const label = tab.querySelector('h4');

    copyVueScopeAttributes(header, tab);
    copyVueScopeAttributes(nativeTab, tab);
    copyVueScopeAttributes(header, icon);
    copyVueScopeAttributes(nativeIcon, icon);
    copyVueScopeAttributes(header, label);
    copyVueScopeAttributes(nativeLabel, label);
  }

  function findNonBookmarksTab(header) {
    return Array.from(header && header.querySelectorAll ? header.querySelectorAll('.extra-sidebar-header__tab') : [])
      .find(item => !item.classList.contains(TAB_CLASS)) || null;
  }

  function ensurePendingTradesTab(header) {
    if (!header || findNonBookmarksTab(header)) return;
    const label = 'Trades';
    while (header.children && header.children.length) {
      header.removeChild(header.children[0]);
    }
    header.textContent = '';

    const tab = document.createElement('div');
    tab.className = 'extra-sidebar-header__tab selected extra-sidebar-header__tab--selected';
    tab.innerHTML = PENDING_TRADES_ICON_HTML;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', '0');
    tab.setAttribute('active', 'true');
    tab.setAttribute('aria-selected', 'true');
    tab.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      selectNativeTab(tab);
      togglePanel(false);
    });
    header.appendChild(tab);
  }

  function findClickedNativeTab(target) {
    const tab = target && target.closest && target.closest('.extra-sidebar-header__tab');
    if (!tab || tab.classList.contains(TAB_CLASS)) return null;
    return tab;
  }

  function selectNativeTab(tab) {
    const header = tab && tab.parentElement;
    if (!header) return;

    Array.from(header.querySelectorAll('.extra-sidebar-header__tab')).forEach(item => {
      const active = item === tab;
      item.classList.toggle('selected', active);
      item.classList.toggle('extra-sidebar-header__tab--selected', active && !item.classList.contains(TAB_CLASS));
      item.setAttribute('active', active ? 'true' : 'false');
      item.setAttribute('aria-selected', String(active));
    });
  }

  function syncHeaderTabCount(header) {
    if (!header) return;
    const count = Array.from(header.children || [])
      .filter(item => item.classList && item.classList.contains('extra-sidebar-header__tab'))
      .length;
    if (count) header.setAttribute('data-ce-bookmarks-tab-count', String(count));
    else removeAttributeValue(header, 'data-ce-bookmarks-tab-count');
  }

  function ensureHeader(host, nativeHeader) {
    let header = nativeHeader || Array.from(host.children || []).find(child => child.matches && child.matches('.ce-bookmarks-native-header'));
    let shouldEnsurePendingTab = false;
    if (!header) {
      header = Array.from(host.children || []).find(child => child.matches && child.matches('.extra-sidebar-header'));
    }
    if (!header) {
      header = findPendingTradesHeader(host);
      shouldEnsurePendingTab = Boolean(header);
    }
    if (!header) {
      header = document.createElement('div');
      header.className = 'extra-sidebar-header ce-bookmarks-native-header';
      host.insertBefore(header, host.children[0] || null);
    } else if (!nativeHeader || isPendingTradesHeader(header)) {
      header.classList.add('extra-sidebar-header');
      header.classList.add('ce-bookmarks-native-header');
    }
    if (shouldEnsurePendingTab || isPendingTradesHeader(header)) ensurePendingTradesTab(header);

    let tab = header.querySelector(`.${TAB_CLASS}`) || document.querySelector(`.${TAB_CLASS}`);
    if (!tab) {
      tab = document.createElement('div');
      tab.className = `extra-sidebar-header__tab ${TAB_CLASS}`;
      tab.innerHTML = BOOKMARK_ICON_HTML;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('tabindex', '0');
      tab.setAttribute('aria-controls', 'ce-bookmarks-content');
      tab.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
      });
      tab.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
      });
    }
    if (!tab.querySelector('.ce-bookmark-heart-icon')) tab.innerHTML = BOOKMARK_ICON_HTML;
    if (tab.parentElement !== header) header.appendChild(tab);
    header.setAttribute('data-ce-bookmarks-route', isItemRoute() ? 'item' : 'market');
    Array.from(document.querySelectorAll('.ce-bookmarks-native-header'))
      .filter(item => item !== header && !item.querySelector(`.${TAB_CLASS}`))
      .forEach(removeElement);
    syncTabScopeAttributes(header, tab);
    syncHeaderTabCount(header);

    if (!header.dataset.ceBookmarksBound) {
      header.dataset.ceBookmarksBound = 'true';
      header.addEventListener('click', event => {
        if (event.target && event.target.closest && event.target.closest(`.${TAB_CLASS}`)) return;
        if (readOpenState()) {
          selectNativeTab(findClickedNativeTab(event.target));
          togglePanel(false);
        }
      });
    }

    return header;
  }

  function ensureContent(host, contentMount) {
    let content = document.querySelector(`#ce-bookmarks-content`) || host.querySelector(`.${CONTENT_CLASS}`);
    if (!content) {
      content = document.createElement('section');
      content.id = 'ce-bookmarks-content';
      content.className = CONTENT_CLASS;
      content.setAttribute('aria-label', 'Likes');
    }
    if (content.parentElement !== contentMount) contentMount.appendChild(content);
    return content;
  }

  function ensurePanel(skipRender) {
    if (!isBookmarksSidebarRoute()) {
      cleanupPanel();
      return null;
    }

    const nativeParts = findNativeSidebarParts();
    const fallbackHost = nativeParts ? null : ensureFallbackHost();
    const host = nativeParts ? nativeParts.root : fallbackHost;
    if (!host) return null;

    if (activeHost && activeHost !== host && activeHost.classList) {
      activeHost.classList.remove('ce-bookmarks-sidebar-active', 'ce-bookmarks-fallback-host');
    }
    Array.from(document.querySelectorAll('.ce-bookmarks-sidebar-host')).forEach(item => {
      if (item !== host) item.classList.remove('ce-bookmarks-sidebar-active', 'ce-bookmarks-fallback-host');
    });
    activeHost = host;
    host.classList.add('ce-bookmarks-sidebar-host');
    host.classList.toggle('ce-bookmarks-fallback-host', !nativeParts);
    removeNativeSidebarFixedWidthClasses(nativeParts ? host : null);

    const header = ensureHeader(host, nativeParts && nativeParts.header);
    if (nativeParts && !nativeParts.contentMount) {
      removeFallbackHost();
      updateTabState(host);
      return null;
    }

    const contentMount = nativeParts ? nativeParts.contentMount : host;
    const content = ensureContent(host, contentMount);
    if (nativeParts) removeFallbackHost();
    host.classList.toggle('ce-bookmarks-sidebar-active', readOpenState());
    updateTabState(host);
    if (!skipRender) renderList();
    return content;
  }

  function updateTabState(host) {
    const target = host || activeHost;
    if (!target) return;

    const open = readOpenState();
    const tab = target.querySelector(`.${TAB_CLASS}`);
    if (!tab) return;
    const header = tab.parentElement;

    tab.classList.toggle('is-active', open);
    tab.classList.toggle('selected', open);
    tab.setAttribute('active', open ? 'true' : 'false');
    tab.setAttribute('aria-selected', String(open));
    if (!tab.querySelector('h4') || !tab.querySelector('.ce-bookmark-heart-icon')) tab.innerHTML = BOOKMARK_ICON_HTML;

    if (open && header) {
      Array.from(header.querySelectorAll('.extra-sidebar-header__tab'))
        .filter(item => item !== tab && !item.classList.contains(TAB_CLASS))
        .forEach(item => {
          item.classList.remove('selected', 'extra-sidebar-header__tab--selected');
          item.setAttribute('active', 'false');
          item.setAttribute('aria-selected', 'false');
        });
    }
  }

  const CURRENCY_ICON_HTML = {
    USD: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" class="ms-h-full ms-w-full"><rect width="14" height="14" fill="#E4AD5A" rx="7"></rect><path fill="#460519" d="M6.616 10.549v-.846c-.819-.081-1.512-.522-1.836-1.188l.945-.612a1.4 1.4 0 0 0 1.278.774c.486 0 .927-.171.927-.576 0-.423-.405-.513-.738-.612l-.927-.234c-.774-.207-1.242-.666-1.242-1.512 0-.918.657-1.548 1.593-1.701v-.864h.954v.864c.693.108 1.269.423 1.521 1.008l-.918.594c-.243-.414-.666-.594-1.134-.594-.414 0-.774.198-.774.594 0 .315.297.423.666.522l.873.234c.792.216 1.404.621 1.404 1.566 0 .936-.702 1.548-1.638 1.71v.873z"></path></svg>',
    EUR: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" class="ms-h-full ms-w-full"><rect width="14" height="14" fill="#448FF0" rx="7"></rect><path fill="#fff" d="M7.394 10.108c-1.386 0-2.439-.729-2.466-2.205v-.054h-.765v-.738h.765v-.639h-.765v-.738h.765V5.68c.036-1.413 1.17-2.205 2.52-2.205 1.233 0 2.43.657 2.43 2.115v.252H8.555v-.126c0-.747-.549-1.125-1.16-1.125-.55 0-1.054.36-1.063 1.089v.054h1.8v.738H6.323v.639h1.81v.738h-1.8v.063c.008.639.431 1.053 1.097 1.053.684 0 1.125-.351 1.125-1.107v-.117h1.323v.252c0 1.458-1.25 2.115-2.484 2.115"></path></svg>',
    GBP: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" class="ms-h-full ms-w-full"><rect width="14" height="14" fill="#F66634" rx="7"></rect><path fill="#fff" d="M4.677 10V8.929h.729V7.228H4.82v-.792h.585V5.32c0-1.386 1.08-1.845 2.052-1.845 1.017 0 1.88.585 1.88 1.71v.342H8.098V5.23c0-.396-.28-.693-.72-.693-.396 0-.675.297-.675.693v1.206h1.674v.792H6.702v1.701h2.772L9.23 10z"></path></svg>',
    CSGOEMPIRE_COIN: '<svg viewBox="0 0 22 22" class="ms-h-full ms-w-full"><path d="M21.72 4a1 1 0 0 0 0-.17c0-1.7-4.44-3.09-9.93-3.09S1.9 2.14 1.9 3.84a1.5 1.5 0 0 0 0 .22L1.86 4v2.55c0 .55.61 1.15 1.68 1.7 0 0 2.63 1.58 8.26 1.64a21.3 21.3 0 0 0 7-1.09c1.82-.64 2.91-1.46 2.91-2.19V4.05a.3.3 0 0 0 0-.09.1.1 0 0 1 .01.04M4.37 3.31c.73-1 3.78-1.71 7.43-1.71s6.78.75 7.46 1.74a.72.72 0 0 1 .14.41s0 .38 0 .41a2.6 2.6 0 0 0-.4-.32c-1.07-.76-3.9-1.2-7.18-1.2s-6 .4-7.1 1.14a1.7 1.7 0 0 0-.49.38v-.41a.77.77 0 0 1 .14-.44m15.52 6.46v2.55c0 .73-1.08 1.55-2.91 2.2a21 21 0 0 1-7 1.08c-5.67-.06-8.3-1.6-8.3-1.6C.61 13.42 0 12.82 0 12.27v-2.5a.3.3 0 0 1 0-.09.8.8 0 0 1 0-.16C0 9 .57 8.38 1.55 7.9V8c0 .58.67 1.21 1.85 1.78 0 0 2.58 1.38 8.1 1.55a19.6 19.6 0 0 0 7-1.08 10.5 10.5 0 0 0 1.32-.56 1 1 0 0 1-.08.28 1.6 1.6 0 0 0 .12-.27ZM22 15.41v2.5c0 .55-.61 1.15-1.68 1.7 0 0-2.63 1.57-8.27 1.63a21 21 0 0 1-7-1.08C3.19 19.52 2.11 18.7 2.11 18v-2.68a2 2 0 0 0 .09.21 10 10 0 0 0 1.23.52 19.8 19.8 0 0 0 7 1.08c5.52-.18 8.1-1.55 8.1-1.55 1.17-.57 1.85-1.2 1.85-1.78v-.08c1 .48 1.54 1 1.54 1.65v-.06a.3.3 0 0 1 .08.1"></path></svg>',
  };

  function getPriceCurrency() {
    const currency = readSelectedCurrency();
    return currency || 'CSGOEMPIRE_COIN';
  }

  function currencyIconHtml(currency) {
    const key = String(currency || '').toUpperCase();
    if (CURRENCY_ICON_HTML[key]) return CURRENCY_ICON_HTML[key];
    return CURRENCY_ICON_HTML.CSGOEMPIRE_COIN;
  }

  function renderPriceChangeBadge(bookmark) {
    const delta = convertMarketValue(bookmark && bookmark.priceDeltaMarketValue);
    if (!Number.isFinite(delta) || delta === 0) return '';
    const direction = delta > 0 ? 'is-up' : 'is-down';
    const sign = delta > 0 ? '+' : '-';
    const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Math.abs(delta));
    return `<span class="ce-bookmark-price-change ${direction}">${sign}${escapeText(formatted)}</span>`;
  }

  function renderMeta(bookmark) {
    const pieces = [];
    const displayPrice = getDisplayPrice(bookmark);
    if (Number.isFinite(displayPrice)) {
      const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(displayPrice);
      pieces.push(`<span class="ce-bookmark-price"><span class="ce-bookmark-price-icon">${currencyIconHtml(getPriceCurrency())}</span><span class="ce-bookmark-price-value">${escapeText(formatted)}</span></span>`);
    }
    const priceChangeBadge = renderPriceChangeBadge(bookmark);
    if (priceChangeBadge) pieces.push(priceChangeBadge);
    if (bookmark.wear !== null && bookmark.wear !== undefined && bookmark.wear !== '' && Number.isFinite(Number(bookmark.wear))) {
      pieces.push(`<span class="ce-bookmark-wear">${escapeText(new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(Number(bookmark.wear)))}</span>`);
    }
    if (bookmark.sold) {
      pieces.push('<span class="ce-bookmark-sold-badge">Sold</span>');
    }
    return pieces.join('<span class="ce-bookmark-meta-separator">|</span>');
  }

  function parseNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function readSelectedCurrency() {
    let raw = null;
    try {
      raw = localStorage.getItem('currency');
    } catch (e) {
      return '';
    }
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') raw = parsed;
      else if (parsed && typeof parsed === 'object') raw = parsed.currency || parsed.code || parsed.value || '';
    } catch (e) {
      // Plain string values are expected.
    }
    return String(raw || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function readStoredExchangeRates() {
    try {
      const raw = localStorage.getItem('exchangeRates');
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && parsed.currency_exchange_rates && parsed.currency_exchange_rates.rates) ||
        (parsed && parsed.rates) ||
        parsed ||
        null;
    } catch (e) {
      return null;
    }
  }

  function convertMarketValue(marketValue) {
    const coinCents = parseNumber(marketValue);
    if (coinCents == null) return null;
    const coins = coinCents / 100;
    const currency = readSelectedCurrency();
    const rates = readStoredExchangeRates();
    if (!currency || !rates || /^CSGOEMPIRE_COIN$|^COIN$|^COINS$/i.test(currency)) return coins;

    const coinRate = parseNumber(rates.CSGOEMPIRE_COIN);
    const currencyRate = parseNumber(rates[currency]);
    if (coinRate == null || currencyRate == null || coinRate <= 0) return coins;
    return (coins / coinRate) * currencyRate;
  }

  function getDisplayPrice(bookmark) {
    const converted = convertMarketValue(bookmark && bookmark.marketValue);
    if (converted != null) return converted;
    return parseNumber(bookmark && bookmark.price);
  }

  function buildPreviewImageUrl(previewId) {
    const id = String(previewId || '').trim();
    return id ? `https://inspect.csgoempire2.com/${encodeURIComponent(id)}.jpg` : '';
  }

  function clearPreviewTimer() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
  }

  function removePreviewPopover() {
    clearPreviewTimer();
    if (previewPopover && previewPopover.parentNode) previewPopover.parentNode.removeChild(previewPopover);
    previewPopover = null;
  }

  function getSidebarRect() {
    const sidebar = (activeHost && activeHost.closest && activeHost.closest('.sidebar')) ||
      document.querySelector('.sidebar') ||
      document.querySelector('.sidebar__inner') ||
      activeHost;
    if (sidebar && typeof sidebar.getBoundingClientRect === 'function') return sidebar.getBoundingClientRect();
    return null;
  }

  function showPreviewPopover(trigger) {
    const src = trigger && trigger.getAttribute('data-ce-preview-src');
    if (!src || !document.body) return;
    removePreviewPopover();

    const popover = document.createElement('div');
    popover.className = 'ce-bookmark-preview-popover';
    popover.setAttribute('role', 'tooltip');
    popover.innerHTML = `<img src="${escapeText(src)}" alt="">`;
    document.body.appendChild(popover);

    const viewportWidth = Number(window.innerWidth) || 1200;
    const viewportHeight = Number(window.innerHeight) || 900;
    const sidebarRect = getSidebarRect();
    const sidebarLeft = sidebarRect && Number.isFinite(Number(sidebarRect.left))
      ? Number(sidebarRect.left)
      : viewportWidth - 360;
    const top = Math.max(8, sidebarRect && Number.isFinite(Number(sidebarRect.top)) ? Number(sidebarRect.top) : 8);

    popover.style.left = '8px';
    popover.style.top = `${top}px`;
    popover.style.width = `${Math.max(240, sidebarLeft - 16)}px`;
    popover.style.maxHeight = `${Math.max(160, viewportHeight - top - 8)}px`;
    previewPopover = popover;
  }

  function schedulePreview(trigger) {
    removePreviewPopover();
    previewTimer = setTimeout(() => showPreviewPopover(trigger), 500);
  }

  function openPreviewTab(trigger) {
    const src = trigger && trigger.getAttribute('data-ce-preview-src');
    if (!src || typeof window.open !== 'function') return;
    window.open(src, '_blank', 'noopener,noreferrer');
  }

  function renderMarketName(bookmark) {
    const fallback = `Item ${bookmark.id}`;
    const name = String(bookmark.marketName || fallback).trim() || fallback;
    const separator = name.indexOf('|');
    if (separator < 0) {
      return `<div class="ce-bookmark-name"><span class="ce-bookmark-name-main">${escapeText(name)}</span></div>`;
    }

    const muted = name.slice(0, separator).trim();
    const main = name.slice(separator + 1).trim() || name;
    return `
      <div class="ce-bookmark-name">
        ${muted ? `<span class="ce-bookmark-name-muted">${escapeText(muted)}</span>` : ''}
        <span class="ce-bookmark-name-main">${escapeText(main)}</span>
      </div>
    `;
  }

  function bookmarkRowHtml(bookmark) {
    const previewSrc = buildPreviewImageUrl(bookmark.previewId);
    let image = '<div class="ce-bookmark-image ce-bookmark-image-empty"></div>';
    if (bookmark.iconUrl && previewSrc) {
      image = `<div class="ce-bookmark-image-trigger" data-ce-preview-src="${escapeText(previewSrc)}"><img class="ce-bookmark-image" src="${escapeText(bookmark.iconUrl)}" alt=""><span class="ce-bookmark-zoom-icon" aria-hidden="true"></span></div>`;
    } else if (bookmark.iconUrl) {
      image = `<div class="ce-bookmark-image-frame"><img class="ce-bookmark-image" src="${escapeText(bookmark.iconUrl)}" alt=""></div>`;
    }
    return `
      <div class="ce-bookmark-item${bookmark.sold ? ' is-sold' : ''}" data-ce-bookmark-id="${escapeText(bookmark.id)}">
        ${image}
        <div class="ce-bookmark-body">
          ${renderMarketName(bookmark)}
          <div class="ce-bookmark-meta">${renderMeta(bookmark)}</div>
        </div>
        <button class="ce-bookmark-remove" type="button" data-ce-bookmark-remove="${escapeText(bookmark.id)}" aria-label="Remove like">×</button>
      </div>
    `;
  }

  function navigateToBookmark(id) {
    if (!id) return;
    history.pushState({}, '', `/item/${id}`);
    try {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (e) {
      window.dispatchEvent(new Event('popstate'));
    }
    window.dispatchEvent(new Event('ce:route'));
  }

  function bindListEvents(content) {
    content.querySelectorAll('.ce-bookmark-image-trigger').forEach(trigger => {
      if (trigger.dataset.cePreviewBound) return;
      trigger.dataset.cePreviewBound = 'true';
      trigger.addEventListener('mouseenter', () => schedulePreview(trigger));
      trigger.addEventListener('mouseleave', removePreviewPopover);
      trigger.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openPreviewTab(trigger);
      });
    });

    content.querySelectorAll('[data-ce-bookmark-id]').forEach(row => {
      if (row.dataset.ceBookmarksBound) return;
      row.dataset.ceBookmarksBound = 'true';
      row.addEventListener('click', event => {
        const removeButton = event.target && event.target.closest && event.target.closest('[data-ce-bookmark-remove]');
        if (removeButton) {
          event.preventDefault();
          event.stopPropagation();
          bookmarksApi().removeBookmark(removeButton.getAttribute('data-ce-bookmark-remove'));
          renderList();
          syncAllStates();
          return;
        }
        navigateToBookmark(row.getAttribute('data-ce-bookmark-id'));
      });
    });
  }

  function renderList() {
    const content = ensurePanel(true);
    if (!content) return;
    pricingSignature = readPricingSignature();

    const list = bookmarksApi().loadBookmarks()
      .slice()
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    content.innerHTML = list.length
      ? `<div class="ce-bookmarks-list">${list.map(bookmarkRowHtml).join('')}</div>`
      : '<div class="ce-bookmarks-empty">No likes yet.</div>';
    bindListEvents(content);
    updateTabState(activeHost);
  }

  function togglePanel(force) {
    if (force != null) writeOpenState(Boolean(force));
    const content = ensurePanel(true);
    if (!content || !activeHost) return;
    const open = force == null ? !activeHost.classList.contains('ce-bookmarks-sidebar-active') : Boolean(force);
    activeHost.classList.toggle('ce-bookmarks-sidebar-active', open);
    if (!open) {
      Array.from(document.querySelectorAll('.ce-bookmarks-sidebar-active'))
        .forEach(item => item.classList.remove('ce-bookmarks-sidebar-active'));
    }
    writeOpenState(open);
    updateTabState(activeHost);
    if (open) renderList();
  }

  async function ensureNavLink() {
    return ensurePanel();
  }

  function syncNativeButtonColor(button, saved) {
    if (!button || !button.classList) return;
    const usesNativeButtonColor = button.classList.contains('ce-similar-bookmark-button') ||
      button.classList.contains('btn-green') ||
      button.classList.contains('btn-red');
    if (!usesNativeButtonColor) return;
    button.classList.toggle('btn-green', !saved);
    button.classList.toggle('btn-red', saved);
  }

  function syncBookmarkVisual(button, saved) {
    syncNativeButtonColor(button, saved);
    const icon = button && button.querySelector &&
      button.querySelector('.ce-bookmark-heart-icon,.ce-bookmark-broken-heart-icon');
    if (!icon) return;
    const desiredClass = saved ? 'ce-bookmark-broken-heart-icon' : 'ce-bookmark-heart-icon';
    const desiredPath = saved ? BROKEN_HEART_PATH_HTML : HEART_PATH_HTML;
    if (!icon.classList.contains(desiredClass)) {
      icon.setAttribute('class', `${desiredClass} ms-h-full ms-w-full`);
    }
    if (icon.innerHTML !== desiredPath) icon.innerHTML = desiredPath;
  }

  function syncAllStates() {
    ensurePanel(true);
    updateTabState(activeHost);
    document.querySelectorAll('[data-ce-bookmark-id], .ce-card-bookmark-inline, .ce-main-bookmark-button').forEach(element => {
      const id = element.getAttribute('data-ce-bookmark-id');
      if (!id) return;
      const saved = bookmarksApi().hasBookmark(id);
      element.classList.toggle('saved', saved);
      element.classList.toggle('not-saved', !saved);
      syncBookmarkVisual(element, saved);
      element.setAttribute('aria-pressed', String(saved));
      element.title = saved ? 'Remove like' : 'Add like';
    });
  }

  function scheduleMountRefresh() {
    if (mountRefreshing) return;
    mountRefreshing = true;
    try {
      const content = ensurePanel(true);
      if (content && !content.innerHTML) renderList();
      else updateTabState(activeHost);
    } finally {
      mountRefreshing = false;
    }
  }

  function observeSidebarMount() {
    if (mountObserver || typeof MutationObserver !== 'function' || !document.documentElement) return;
    mountObserver = new MutationObserver(scheduleMountRefresh);
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function handlePricingStorageChange() {
    const next = readPricingSignature();
    if (next === pricingSignature) return;
    pricingSignature = next;
    if (activeHost && activeHost.classList && activeHost.classList.contains('ce-bookmarks-sidebar-active')) {
      renderList();
    }
  }

  function observePricingStorage() {
    pricingSignature = readPricingSignature();
    window.addEventListener('storage', event => {
      if (event && event.key && event.key !== 'currency' && event.key !== 'exchangeRates') return;
      handlePricingStorageChange();
    }, { passive: true });
    if (!pricingObserver && typeof setInterval === 'function') {
      pricingObserver = setInterval(handlePricingStorageChange, 1000);
    }
  }

  window.addEventListener('ce:bookmarks-changed', () => {
    renderList();
    syncAllStates();
  }, { passive: true });

  window.ensureBookmarksSidebar = ensurePanel;
  window.ensurePanel = ensurePanel;
  window.togglePanel = togglePanel;
  window.renderList = renderList;
  window.ensureNavLink = ensureNavLink;
  window.syncAllStates = syncAllStates;
  observeSidebarMount();
  observePricingStorage();
})();
