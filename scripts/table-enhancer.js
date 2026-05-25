// Optional table-row bookmark support. Safe no-op unless row selectors are stable.

(function () {
  'use strict';

  const HEART_ICON_HTML = '<div class="ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-[14px] cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="ce-bookmark-heart-icon ms-h-full ms-w-full" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 12.4 5.98 11.5C2.35 8.28.5 6.65.5 4.25.5 2.3 2.03.8 3.98.8 5.08.8 6.14 1.31 6.82 2.12L7 2.34l.18-.22A3.73 3.73 0 0 1 10.02.8c1.95 0 3.48 1.5 3.48 3.45 0 2.4-1.85 4.03-5.48 7.25z"></path></svg></div>';

  function setHeartIcon(button) {
    if (button && !(button.querySelector && button.querySelector('.ce-bookmark-heart-icon,.ce-bookmark-broken-heart-icon'))) {
      button.innerHTML = HEART_ICON_HTML;
    }
    if (button && button.classList) button.classList.add('hover:text-yellow-2');
  }

  function fallbackRowItemId(row) {
    const link = row && Array.from(row.querySelectorAll('a')).find(anchor => {
      const href = anchor.getAttribute('href') || anchor.href || '';
      return /\/item\/\d+/.test(href);
    });
    const match = link && (link.getAttribute('href') || link.href || '').match(/\/item\/(\d+)/);
    return match ? match[1] : null;
  }

  function getRowItemIdSafe(row) {
    if (typeof window.getRowItemId === 'function') return window.getRowItemId(row);
    return fallbackRowItemId(row);
  }

  function ensureRowStarSafe(row, id, item) {
    if (typeof window.ensureRowStar === 'function') {
      window.ensureRowStar(row, id, item);
      return;
    }
    if (!row) return;
    const existing = row.querySelector(`.ce-row-bookmark-button[data-ce-bookmark-id="${id}"]`);
    if (existing) {
      setHeartIcon(existing);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ce-row-bookmark-button';
    setHeartIcon(button);
    button.setAttribute('data-ce-bookmark-id', id);
    button.setAttribute('aria-label', 'Toggle like');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const entry = {
        id,
        marketName: item && (item.marketName || item.market_name || item.name),
        iconUrl: item && (item.iconUrl || item.icon_url || item.icon),
        price: item && (item.price || item.market_value || item.purchase_price),
        wear: item && (item.wear || item.float || item.float_value),
        previewId: item && (item.previewId || item.preview_id),
      };
      if (typeof window.toggleBookmarkWithItemData === 'function') window.toggleBookmarkWithItemData(entry);
      else if (typeof window.toggleBookmark === 'function') window.toggleBookmark(entry);
      if (typeof window.syncAllStates === 'function') window.syncAllStates();
    });
    row.appendChild(button);
  }

  function enhanceRowById(row, id, byId) {
    const item = byId && typeof byId.get === 'function' ? byId.get(String(id)) : null;
    if (!item) return false;
    if (typeof window.replaceLinkContentWithFloat === 'function') window.replaceLinkContentWithFloat(row, item);
    if (typeof window.ensureBadges === 'function') window.ensureBadges(row, item);
    ensureRowStarSafe(row, id, item);
    row.dataset.ceItemId = String(id);
    return true;
  }

  function enhanceRowIfNeeded(row, byId) {
    if (!(row instanceof HTMLElement)) return false;
    const id = getRowItemIdSafe(row);
    if (!id) return false;
    return enhanceRowById(row, id, byId);
  }

  window.enhanceRowById = enhanceRowById;
  window.enhanceRowIfNeeded = enhanceRowIfNeeded;
})();
