// Listing card bookmark controls

(function () {
  'use strict';

  const HEART_PATH_HTML = '<path d="M7 12.4 5.98 11.5C2.35 8.28.5 6.65.5 4.25.5 2.3 2.03.8 3.98.8 5.08.8 6.14 1.31 6.82 2.12L7 2.34l.18-.22A3.73 3.73 0 0 1 10.02.8c1.95 0 3.48 1.5 3.48 3.45 0 2.4-1.85 4.03-5.48 7.25z"></path>';
  const BROKEN_HEART_PATH_HTML = '<path d="M6.23 12.42 5.41 11.7C2.13 8.82.5 7.36.5 5.12.5 3.16 2.03 1.66 3.98 1.66c.91 0 1.79.35 2.45.94L5.3 5.08l1.46 1.14-1.13 2.14 1.32 1.03-.72 3.03Z"></path><path d="m7.64 11.95.95-.84c3.28-2.9 4.91-4.35 4.91-6.59 0-1.96-1.53-3.46-3.48-3.46-1.02 0-2.01.44-2.68 1.14L6.3 4.45l1.5 1.17-1.13 2.14 1.37 1.06-.4 3.13Z"></path>';
  const HEART_ICON_HTML = `<div class="ms-flex ms-flex-shrink-0 ms-items-center ms-justify-center ms-size-[14px] cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="ce-bookmark-heart-icon ms-h-full ms-w-full" viewBox="0 0 14 14" aria-hidden="true">${HEART_PATH_HTML}</svg></div>`;
  const SIMILAR_HEART_ICON_HTML = `<span class="front items-center justify-center"><div class="flex items-center">${HEART_ICON_HTML}</div></span>`;
  const PERCENTAGE_BADGE_BASE_CLASS = 'size-xs font-bold flex h-[14px] items-center justify-center rounded px-sm text-light-1';
  const FADE_BADGE_CLASS = `${PERCENTAGE_BADGE_BASE_CLASS} fade-percentage`;
  const BLUE_BADGE_CLASS = `${PERCENTAGE_BADGE_BASE_CLASS} blue-percentage`;
  const FADE_SORT_OPTION_CLASS = 'ce-fade-sort-native-option';
  let gridObserver = null;
  let activePercentageSortType = '';
  let activePercentageSortDirection = '';

  function getHref(element) {
    return element && (element.getAttribute('href') || element.href || '');
  }

  function getCardLink(card) {
    if (!card) return null;
    return Array.from(card.querySelectorAll('a')).find(link => /\/item\/\d+/.test(getHref(link))) || null;
  }

  function getCardId(card) {
    const link = getCardLink(card);
    const match = link && getHref(link).match(/\/item\/(\d+)/);
    return match ? match[1] : null;
  }

  function getTextCandidates(card) {
    return Array.from(card.querySelectorAll('h1,h2,h3,h4,p,span,div'))
      .map(element => (element.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function getCardName(card) {
    const candidates = getTextCandidates(card);
    return candidates.find(text => /\|/.test(text) && !/^\d/.test(text)) ||
      candidates.find(text => text.length > 3 && !/^\d/.test(text)) ||
      '';
  }

  function getCardIcon(card) {
    const image = card && card.querySelector('img');
    return image ? (image.getAttribute('src') || image.src || '') : '';
  }

  function getCardFloat(card) {
    const text = getTextCandidates(card).join(' ');
    const match = text.match(/\b(?:float|wear)\s*:?\s*(0?\.\d+)/i) || text.match(/\b0\.\d{3,}\b/);
    return match ? Number(match[1] || match[0]) : null;
  }

  function getCardPrice(card) {
    const text = getTextCandidates(card).join(' ');
    const match = text.match(/(?:\$|€|£)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    if (!match) return null;
    const price = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(price) ? price : null;
  }

  function parseNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function getCurrentItemId() {
    const match = window.location.pathname.match(/\/item\/(\d+)/);
    return match ? match[1] : null;
  }

  function isItemPage() {
    return /\/item\/\d+/.test(window.location.pathname || '');
  }

  function isInsideNativeSidebar(element) {
    return Boolean(element && element.closest && element.closest(
      '.sidebar,.sidebar__inner,.sidebar__component,[data-testid="trade-sidebar"],.ce-bookmarks-content'
    ));
  }

  function isBuyButton(element) {
    const text = (element && element.textContent || '').replace(/\s+/g, ' ').trim();
    return /^buy$/i.test(text) || /buy/i.test(element && element.getAttribute && (element.getAttribute('aria-label') || ''));
  }

  function findBuyButton(root) {
    return Array.from(root && root.querySelectorAll ? root.querySelectorAll('button,[role="button"]') : [])
      .find(isBuyButton) || null;
  }

  function hasDifferentItemLink(root, id) {
    return Array.from(root && root.querySelectorAll ? root.querySelectorAll('a') : [])
      .some(link => {
        const match = getHref(link).match(/\/item\/(\d+)/);
        return match && match[1] !== id;
      });
  }

  function hasMainItemHeading(root) {
    return Array.from(root && root.querySelectorAll ? root.querySelectorAll('h1,h2') : [])
      .some(element => {
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        return text && !/similar items/i.test(text);
      });
  }

  function isMainItemContainer(root) {
    if (!root || root === document.body) return true;
    if (root.classList && root.classList.contains('item-page')) return true;
    if (root.querySelector && root.querySelector('.ce-main-bookmark-button')) return true;
    return hasMainItemHeading(root);
  }

  function isInsideSimilarItemArea(element, id) {
    let current = element && element.parentElement;
    while (current && current !== document.body) {
      if (/similar/i.test(String(current.className || ''))) return true;
      if (hasDifferentItemLink(current, id)) return !isMainItemContainer(current);
      if (isMainItemContainer(current)) return false;
      current = current.parentElement;
    }
    return false;
  }

  function findMainBuyButton() {
    const id = getCurrentItemId();
    return Array.from(document.querySelectorAll('button,[role="button"]'))
      .find(button => isBuyButton(button) &&
        !isInsideNativeSidebar(button) &&
        !(button.classList && button.classList.contains('ce-similar-bookmark-button')) &&
        !isInsideSimilarItemArea(button, id)) || null;
  }

  function getItemPageName() {
    const selectors = ['.item-page h1', '.item-page h2', 'h1', 'h2'];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = element && element.textContent ? element.textContent.replace(/\s+/g, ' ').trim() : '';
      if (text && !/similar items/i.test(text)) return text;
    }
    return '';
  }

  function getItemPageIcon() {
    const image = document.querySelector('.item-page img') || document.querySelector('main img');
    return image ? (image.getAttribute('src') || image.src || '') : '';
  }

  function getItemPagePrice() {
    const candidates = Array.from(document.querySelectorAll('[data-testid="currency-value"], span, div'));
    for (const element of candidates) {
      const text = (element.textContent || '').replace(/,/g, '');
      const value = Number(text.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }

  function getItemPageWear() {
    const text = (document.body && document.body.textContent || '').replace(/\s+/g, ' ');
    const match = text.match(/\b(?:float|wear)\s*:?\s*(0?\.\d+)/i) || text.match(/\b0\.\d{3,}\b/);
    return match ? Number(match[1] || match[0]) : null;
  }

  function syncBookmarkButton(button, id) {
    const saved = typeof window.hasBookmark === 'function' && window.hasBookmark(id);
    button.classList.toggle('saved', saved);
    button.classList.toggle('not-saved', !saved);
    syncBookmarkVisual(button, saved);
    button.setAttribute('aria-pressed', String(saved));
    button.title = saved ? 'Remove like' : 'Add like';
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

  function setHeartIcon(button) {
    if (button && !(button.querySelector && button.querySelector('.ce-bookmark-heart-icon,.ce-bookmark-broken-heart-icon'))) {
      button.innerHTML = HEART_ICON_HTML;
    }
    if (button && button.classList) button.classList.add('hover:text-yellow-2');
  }

  function toggleBookmarkEntry(entry) {
    if (typeof window.toggleBookmarkWithItemData === 'function') return window.toggleBookmarkWithItemData(entry);
    if (typeof window.toggleBookmark === 'function') return window.toggleBookmark(entry);
    return null;
  }

  function syncAfterToggle(result, button, id) {
    syncBookmarkButton(button, id);
    if (typeof window.renderList === 'function') window.renderList();
    if (typeof window.syncAllStates === 'function') window.syncAllStates();
    if (result && typeof result.finally === 'function') {
      result.finally(() => {
        syncBookmarkButton(button, id);
        if (typeof window.renderList === 'function') window.renderList();
        if (typeof window.syncAllStates === 'function') window.syncAllStates();
      });
    }
  }

  function getPreviewPopoverMount(root) {
    const popover = root && root.querySelector ? root.querySelector('.popover-container.preview-popover') : null;
    const parent = popover && popover.parentElement;
    return parent ? { parent, popover } : null;
  }

  function isPlacedBefore(parent, node, reference) {
    if (!parent || node.parentElement !== parent) return false;
    const children = Array.from(parent.children || []);
    return children.indexOf(node) >= 0 && children.indexOf(node) + 1 === children.indexOf(reference);
  }

  function isPlacedAfter(parent, node, reference) {
    if (!parent || node.parentElement !== parent) return false;
    const children = Array.from(parent.children || []);
    return children.indexOf(reference) >= 0 && children.indexOf(reference) + 1 === children.indexOf(node);
  }

  function copyButtonClasses(source, target, baseClass) {
    target.className = baseClass || 'ce-card-bookmark-inline';
    String(source && source.className || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach(name => target.classList.add(name));
    target.classList.remove('btn-secondary', 'hover:text-yellow-2', 'stretch');
    target.classList.add('btn-green');
    if (typeof target.removeAttribute === 'function') target.removeAttribute('style');
    else if (target.attributes) delete target.attributes.style;
  }

  function copyVueScopeAttributes(source, target) {
    if (!source || !target) return;
    const names = typeof source.getAttributeNames === 'function'
      ? source.getAttributeNames()
      : Object.keys(source.attributes || {});
    names
      .filter(name => /^data-v-/.test(name))
      .forEach(name => target.setAttribute(name, source.getAttribute(name) || ''));
  }

  function setSimilarHeartIcon(button, buyButton) {
    if (!button || button.querySelector('.front')) return;
    button.innerHTML = SIMILAR_HEART_ICON_HTML;
    copyVueScopeAttributes(buyButton, button);
    copyVueScopeAttributes(buyButton, button.querySelector('.front'));
  }

  function normalizeEmpireItemResponse(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const item = (payload.data && payload.data.item) ||
      payload.item ||
      payload.data ||
      payload;
    return item && typeof item === 'object' ? item : null;
  }

  async function fetchEmpireItem(id) {
    if (window.ceBookmarks && typeof window.ceBookmarks.fetchEmpireItem === 'function') {
      return window.ceBookmarks.fetchEmpireItem(id);
    }
    const fetcher = window.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetcher) return null;
    const origin = String(window.location && window.location.origin || 'https://csgoempire.com').replace(/\/$/, '');
    const response = await fetcher(`${origin}/api/v2/trading/item/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (!response || response.ok === false) return null;
    return normalizeEmpireItemResponse(await response.json());
  }

  function getFadePercentage(item) {
    const raw = parseNumber(item && (item.fade_percentage ?? item.fadePercentage ?? item.fade));
    if (raw == null || raw < 0) return null;
    return raw > 0 && raw <= 1 ? raw * 100 : raw;
  }

  function getBluePercentage(item) {
    const raw = parseNumber(item && (item.blue_percentage ?? item.bluePercentage ?? item.blue));
    if (raw == null || raw < 0) return null;
    return raw > 0 && raw <= 1 ? raw * 100 : raw;
  }

  function formatPercentage(value) {
    return `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '')}%`;
  }

  function getSortOptionType(option) {
    if (!option) return '';
    if (option.getAttribute('data-ce-sort-type')) return option.getAttribute('data-ce-sort-type');
    if (option.getAttribute('data-ce-fade-sort') != null) return 'fade';
    if (option.getAttribute('data-ce-blue-sort') != null) return 'blue';
    return '';
  }

  function getSortOptionDirection(option) {
    if (!option) return '';
    return option.getAttribute('data-ce-sort-direction') ||
      option.getAttribute('data-ce-fade-sort') ||
      option.getAttribute('data-ce-blue-sort') ||
      '';
  }

  function setPercentageSortActive(type, direction) {
    activePercentageSortType = type === 'fade' || type === 'blue' ? type : '';
    activePercentageSortDirection = direction === 'asc' ? 'asc' : direction === 'desc' ? 'desc' : '';
    Array.from(document.querySelectorAll(`.${FADE_SORT_OPTION_CLASS}`)).forEach(button => {
      const active = getSortOptionType(button) === activePercentageSortType &&
        getSortOptionDirection(button) === activePercentageSortDirection;
      button.classList.toggle('is-active', active);
      button.classList.toggle('text-light-1', active);
      button.classList.toggle('text-light-2', !active);
      button.setAttribute('active', String(active));
      button.setAttribute('aria-selected', String(active));
      if (button.getAttribute('data-headlessui-state') != null) {
        button.setAttribute('data-headlessui-state', active ? 'selected' : '');
      }
    });
  }

  function getActiveFadeSortDirection() {
    return activePercentageSortType === 'fade' ? activePercentageSortDirection : '';
  }

  function getRowPercentageValue(row, type) {
    return parseNumber(row && row.getAttribute(`data-ce-similar-${type}-value`));
  }

  function ensureSimilarOriginalIndex(row) {
    if (!row || row.getAttribute('data-ce-similar-original-index') != null) return;
    const parent = row.parentElement;
    const index = parent ? Array.from(parent.children || []).indexOf(row) : 0;
    row.setAttribute('data-ce-similar-original-index', String(Math.max(0, index)));
  }

  function sortSimilarRowsByPercentage(type, direction) {
    const sortType = type === 'blue' ? 'blue' : 'fade';
    const dir = direction === 'asc' ? 'asc' : 'desc';
    const groups = new Map();
    Array.from(document.querySelectorAll('.ce-similar-row')).forEach(row => {
      if (!row.parentElement) return;
      ensureSimilarOriginalIndex(row);
      if (!groups.has(row.parentElement)) groups.set(row.parentElement, []);
      groups.get(row.parentElement).push(row);
    });

    for (const [parent, rows] of groups.entries()) {
      rows
        .slice()
        .sort((a, b) => {
          const av = getRowPercentageValue(a, sortType);
          const bv = getRowPercentageValue(b, sortType);
          if (av == null && bv == null) {
            return parseNumber(a.getAttribute('data-ce-similar-original-index')) -
              parseNumber(b.getAttribute('data-ce-similar-original-index'));
          }
          if (av == null) return 1;
          if (bv == null) return -1;
          if (av === bv) {
            return parseNumber(a.getAttribute('data-ce-similar-original-index')) -
              parseNumber(b.getAttribute('data-ce-similar-original-index'));
          }
          return dir === 'asc' ? av - bv : bv - av;
        })
        .forEach(row => parent.appendChild(row));
    }

    setPercentageSortActive(sortType, dir);
  }

  function sortSimilarRowsByFade(direction) {
    sortSimilarRowsByPercentage('fade', direction);
  }

  function sortSimilarRowsByBlue(direction) {
    sortSimilarRowsByPercentage('blue', direction);
  }

  function applyActiveSimilarPercentageSort() {
    if (activePercentageSortType && activePercentageSortDirection) {
      sortSimilarRowsByPercentage(activePercentageSortType, activePercentageSortDirection);
    }
  }

  function getElementText(element) {
    if (!element) return '';
    const own = element.textContent || '';
    const childText = Array.from(element.children || []).map(getElementText).join(' ');
    return `${own} ${childText}`.replace(/\s+/g, ' ').trim();
  }

  function isNativeSortText(text) {
    return /\b(lowest|highest)\b/i.test(text || '') &&
      /\b(price|float|wear)\b/i.test(text || '');
  }

  function containsItemLink(element) {
    return Array.from(element && element.querySelectorAll ? element.querySelectorAll('a') : [])
      .some(link => /\/item\/\d+/.test(getHref(link)));
  }

  function getNativeSortOptions(element) {
    return Array.from(element && element.querySelectorAll
      ? element.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],li,div')
      : [])
      .filter(option => isNativeSortText(getElementText(option)));
  }

  function hasNestedNativeMenu(element) {
    return Array.from(element && element.querySelectorAll
      ? element.querySelectorAll('[role="listbox"],[role="menu"],ul,ol')
      : [])
      .some(child => child !== element && getNativeSortOptions(child).length >= 2);
  }

  function isNativeSortMenuCandidate(element) {
    if (!element || containsItemLink(element)) return false;
    const role = element.getAttribute && element.getAttribute('role');
    const tag = String(element.tagName || '').toUpperCase();
    const roleLooksLikeMenu = /^(listbox|menu)$/i.test(role || '');
    const tagLooksLikeMenu = tag === 'UL' || tag === 'OL';

    if ((roleLooksLikeMenu || tagLooksLikeMenu) && getNativeSortOptions(element).length >= 2) {
      return true;
    }

    if (hasNestedNativeMenu(element)) return false;

    return Array.from(element.children || [])
      .filter(child => isNativeSortText(getElementText(child)))
      .length >= 2;
  }

  function findNativeSortMenu() {
    const candidates = Array.from(document.querySelectorAll('div,ul,li,[role="menu"],[role="listbox"]'))
      .filter(element => !(element.classList && element.classList.contains(FADE_SORT_OPTION_CLASS)))
      .filter(isNativeSortMenuCandidate);

    return candidates
      .sort((a, b) => {
        const aRole = a.getAttribute && /^(listbox|menu)$/i.test(a.getAttribute('role') || '');
        const bRole = b.getAttribute && /^(listbox|menu)$/i.test(b.getAttribute('role') || '');
        if (aRole !== bRole) return aRole ? -1 : 1;
        return getElementText(a).length - getElementText(b).length;
      })
      [0] || null;
  }

  function removeElement(element) {
    if (!element) return;
    if (typeof element.remove === 'function') element.remove();
    else if (element.parentNode) element.parentNode.removeChild(element);
  }

  function copySortOptionAttributes(source, target) {
    if (!source || !target) return;
    target.className = source.className || '';
    copyVueScopeAttributes(source, target);
    const role = source.getAttribute && source.getAttribute('role');
    if (role) target.setAttribute('role', role);
    if (source.getAttribute && source.getAttribute('data-headlessui-state') != null) {
      target.setAttribute('data-headlessui-state', source.getAttribute('data-headlessui-state') || '');
    }
  }

  function resetFadeSortOptionVisualState(option) {
    if (!option || !option.classList) return;
    option.classList.remove('is-active', 'selected', 'bg-dark-2', 'text-light-1');
    option.classList.add('text-light-2');
    option.setAttribute('active', 'false');
    option.setAttribute('aria-selected', 'false');
    if (option.getAttribute('data-headlessui-state') != null) option.setAttribute('data-headlessui-state', '');
  }

  function createPercentageSortOption(type, direction, label, reference) {
    const tagName = reference && /^(LI|DIV|BUTTON)$/i.test(reference.tagName || '')
      ? reference.tagName.toLowerCase()
      : 'button';
    const option = document.createElement(tagName);
    if (tagName === 'button') option.type = 'button';
    copySortOptionAttributes(reference, option);
    option.classList.add(FADE_SORT_OPTION_CLASS);
    option.setAttribute('data-ce-sort-type', type);
    option.setAttribute('data-ce-sort-direction', direction);
    option.setAttribute(type === 'blue' ? 'data-ce-blue-sort' : 'data-ce-fade-sort', direction);
    resetFadeSortOptionVisualState(option);

    const referenceText = reference && reference.querySelector && reference.querySelector('p');
    if (referenceText) {
      const text = document.createElement('p');
      text.className = referenceText.className || '';
      copyVueScopeAttributes(referenceText, text);
      text.textContent = label;
      option.appendChild(text);
    } else {
      option.textContent = label;
    }

    option.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      sortSimilarRowsByPercentage(type, direction);
    });
    return option;
  }

  function hasSimilarPercentageValues(type) {
    return Boolean(document.querySelector(`[data-ce-similar-${type}-value]`));
  }

  function ensureSimilarPercentageSortDropdown() {
    if (!isItemPage()) return;
    const menu = findNativeSortMenu();
    if (!menu) {
      setPercentageSortActive(activePercentageSortType, activePercentageSortDirection);
      return;
    }

    const reference = getNativeSortOptions(menu)[0] || null;
    const options = [
      ['fade', 'desc', 'Highest Fade First'],
      ['fade', 'asc', 'Lowest Fade First'],
      ['blue', 'desc', 'Highest Blue First'],
      ['blue', 'asc', 'Lowest Blue First'],
    ];

    options.forEach(([type, direction]) => {
      if (hasSimilarPercentageValues(type)) return;
      const attr = type === 'blue' ? 'data-ce-blue-sort' : 'data-ce-fade-sort';
      removeElement(document.querySelector(`[${attr}="${direction}"]`));
      if (activePercentageSortType === type) {
        activePercentageSortType = '';
        activePercentageSortDirection = '';
      }
    });

    options.filter(([type]) => hasSimilarPercentageValues(type)).forEach(([type, direction, label]) => {
      const attr = type === 'blue' ? 'data-ce-blue-sort' : 'data-ce-fade-sort';
      const existing = document.querySelector(`[${attr}="${direction}"]`);
      const sameTag = existing && reference && existing.tagName === reference.tagName;
      const option = existing && existing.parentElement === menu && (!reference || sameTag)
        ? existing
        : createPercentageSortOption(type, direction, label, reference);
      if (existing && existing !== option) removeElement(existing);
      if (option.parentElement !== menu) menu.appendChild(option);
    });
    setPercentageSortActive(activePercentageSortType, activePercentageSortDirection);
  }

  function ensureSimilarFadeSortDropdown() {
    ensureSimilarPercentageSortDropdown();
  }

  function findSimilarPercentageMount(row, buyButton) {
    const buyParent = buyButton && buyButton.parentElement;
    return Array.from(row && row.children || []).find(child => {
      if (child === buyParent) return false;
      if (child.tagName === 'A' || child.querySelector('a')) return false;
      if (child.querySelector('button,[role="button"]')) return false;
      return true;
    }) || row;
  }

  function upsertSimilarPercentageBadge(row, buyButton, percentage, config) {
    let badge = row.querySelector(config.selector);
    if (badge && !badge.getAttribute(config.dataAttr)) return;
    if (!badge) {
      badge = document.createElement('p');
      badge.className = config.className;
      badge.setAttribute(config.dataAttr, 'true');
    }
    badge.textContent = formatPercentage(percentage);

    const mount = findSimilarPercentageMount(row, buyButton);
    if (badge.parentElement !== mount) {
      if (mount === row && buyButton && buyButton.parentElement && buyButton.parentElement.parentElement === row) {
        row.insertBefore(badge, buyButton.parentElement);
      } else {
        mount.appendChild(badge);
      }
    }
  }

  function ensureSimilarPercentages(row, id, buyButton) {
    if (!isItemPage() || !row || !id || !buyButton) return;
    row.classList.add('ce-similar-row');
    ensureSimilarOriginalIndex(row);
    if (row.getAttribute('data-ce-similar-percent-id') === String(id) &&
      (row.getAttribute('data-ce-similar-fade-state') || row.getAttribute('data-ce-similar-blue-state'))) {
      if (row.getAttribute('data-ce-similar-fade-value') != null ||
        row.getAttribute('data-ce-similar-blue-value') != null) {
        ensureSimilarPercentageSortDropdown();
      }
      return;
    }

    row.setAttribute('data-ce-similar-percent-id', id);
    row.setAttribute('data-ce-similar-fade-id', id);
    row.setAttribute('data-ce-similar-fade-state', 'loading');
    row.setAttribute('data-ce-similar-blue-id', id);
    row.setAttribute('data-ce-similar-blue-state', 'loading');
    fetchEmpireItem(id)
      .then(item => {
        const fadePercentage = getFadePercentage(item);
        if (fadePercentage == null || row.querySelector('.fade-percentage:not([data-ce-similar-fade])')) {
          row.setAttribute('data-ce-similar-fade-state', 'empty');
        } else {
          upsertSimilarPercentageBadge(row, buyButton, fadePercentage, {
            selector: '.fade-percentage',
            className: FADE_BADGE_CLASS,
            dataAttr: 'data-ce-similar-fade',
          });
          row.setAttribute('data-ce-similar-fade-state', 'ready');
          row.setAttribute('data-ce-similar-fade-value', String(fadePercentage));
          ensureSimilarPercentageSortDropdown();
        }

        const bluePercentage = getBluePercentage(item);
        if (bluePercentage == null || row.querySelector('.blue-percentage:not([data-ce-similar-blue])')) {
          row.setAttribute('data-ce-similar-blue-state', 'empty');
        } else {
          upsertSimilarPercentageBadge(row, buyButton, bluePercentage, {
            selector: '.blue-percentage',
            className: BLUE_BADGE_CLASS,
            dataAttr: 'data-ce-similar-blue',
          });
          row.setAttribute('data-ce-similar-blue-state', 'ready');
          row.setAttribute('data-ce-similar-blue-value', String(bluePercentage));
          ensureSimilarPercentageSortDropdown();
        }

        applyActiveSimilarPercentageSort();
      })
      .catch(() => {
        row.setAttribute('data-ce-similar-fade-state', 'empty');
        row.setAttribute('data-ce-similar-blue-state', 'empty');
      });
  }

  function placeSimilarItemStar(row, button, buyButton) {
    const parent = buyButton && buyButton.parentElement;
    if (!parent) return false;
    parent.classList.add('gap-2', 'ce-similar-bookmark-actions');
    copyButtonClasses(buyButton, button);
    setSimilarHeartIcon(button, buyButton);
    button.classList.add('ce-similar-bookmark-button');
    if (!isPlacedBefore(parent, button, buyButton)) {
      parent.insertBefore(button, buyButton);
    }
    row.classList.add('ce-bookmark-card-host');
    return true;
  }

  function placeCardStar(card, button) {
    const buyButton = isItemPage() ? findBuyButton(card) : null;
    if (buyButton && placeSimilarItemStar(card, button, buyButton)) {
      ensureSimilarPercentages(card, getCardId(card), buyButton);
      return;
    }

    button.classList.remove('ce-similar-bookmark-button');
    const previewMount = getPreviewPopoverMount(card);
    if (previewMount) {
      previewMount.parent.classList.add('w-full', 'ce-card-like-preview-actions');
      if (!isPlacedBefore(previewMount.parent, button, previewMount.popover)) {
        previewMount.parent.insertBefore(button, previewMount.popover);
      }
      return;
    }

    if (button.parentElement !== card) card.appendChild(button);
  }

  function placeMainStar(button) {
    const buyButton = findMainBuyButton();
    const buyParent = buyButton && buyButton.parentElement;
    if (buyParent) {
      buyParent.classList.add('gap-2', 'ce-main-bookmark-actions');
      copyButtonClasses(buyButton, button, 'ce-main-bookmark-button');
      setSimilarHeartIcon(button, buyButton);
      button.classList.add('ce-main-bookmark-button-native');
      if (!isPlacedBefore(buyParent, button, buyButton)) {
        buyParent.insertBefore(button, buyButton);
      }
      return;
    }

    const title = document.querySelector('.item-page h1') ||
      document.querySelector('.item-page h2') ||
      document.querySelector('h1') ||
      document.querySelector('h2');
    const mount = title && title.parentElement ? title.parentElement : document.body;
    if (title) {
      if (!isPlacedAfter(mount, button, title)) {
        if (title.nextSibling) mount.insertBefore(button, title.nextSibling);
        else mount.appendChild(button);
      }
    } else if (button.parentElement !== mount) {
      mount.appendChild(button);
    }
  }

  function ensureCardStar(card) {
    if (!card || isInsideNativeSidebar(card)) return;
    const id = getCardId(card);
    if (!id) {
      return;
    }

    let button = card.querySelector('.ce-card-bookmark-inline');
    if (!button) {
      button = document.createElement('button');
      button.className = 'ce-card-bookmark-inline';
      button.type = 'button';
      button.setAttribute('aria-label', 'Toggle like');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const currentId = getCardId(card);
        if (!currentId) return;
        const entry = {
          id: currentId,
          marketName: getCardName(card),
          iconUrl: getCardIcon(card),
          price: getCardPrice(card),
          wear: getCardFloat(card),
        };
        syncAfterToggle(toggleBookmarkEntry(entry), button, currentId);
      });
    }

    setHeartIcon(button);
    placeCardStar(card, button);
    button.setAttribute('data-ce-bookmark-id', id);
    syncBookmarkButton(button, id);
    card.classList.add('ce-bookmark-card-host');
  }

  function getCardRoot(link) {
    if (isInsideNativeSidebar(link)) return null;
    const start = link && link.closest ? link.closest('div') : link && link.parentElement;
    if (isItemPage()) {
      let current = start;
      while (current && current !== document.body) {
        if (findBuyButton(current)) return isMainItemContainer(current) ? null : current;
        current = current.parentElement;
      }
      return null;
    }

    let current = start;
    while (current && current !== document.body) {
      if (current.querySelector && current.querySelector('.popover-container.preview-popover')) return current;
      current = current.parentElement;
    }
    return start || (link && link.parentElement);
  }

  function scanCards() {
    if (isItemPage()) ensureMainStar();
    Array.from(document.querySelectorAll('a')).forEach(link => {
      if (!/\/item\/\d+/.test(getHref(link))) return;
      const card = getCardRoot(link);
      if (card) ensureCardStar(card);
    });
  }

  function watchGrid() {
    scanCards();
    if (gridObserver || typeof MutationObserver !== 'function' || !document.body) return;
    gridObserver = new MutationObserver(scanCards);
    gridObserver.observe(document.body, { childList: true, subtree: true });
  }

  function ensureMainStar() {
    const id = getCurrentItemId();
    if (!id || !document.body) return null;
    const existing = document.querySelector('.ce-main-bookmark-button');
    if (existing) {
      existing.setAttribute('data-ce-bookmark-id', id);
      setHeartIcon(existing);
      placeMainStar(existing);
      syncBookmarkButton(existing, id);
      return existing;
    }

    const button = document.createElement('button');
    button.className = 'ce-main-bookmark-button';
    button.type = 'button';
    button.setAttribute('data-ce-bookmark-id', id);
    button.setAttribute('aria-label', 'Toggle like');
    setHeartIcon(button);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      syncAfterToggle(toggleBookmarkEntry({
        id,
        marketName: getItemPageName(),
        iconUrl: getItemPageIcon(),
        price: getItemPagePrice(),
        wear: getItemPageWear(),
      }), button, id);
    });

    placeMainStar(button);
    syncBookmarkButton(button, id);
    return button;
  }

  function runItemEnhancer() {
    ensureMainStar();
    watchGrid();
  }

  window.getCardId = getCardId;
  window.getCardName = getCardName;
  window.getCardIcon = getCardIcon;
  window.getCardFloat = getCardFloat;
  window.ensureCardStar = ensureCardStar;
  window.sortSimilarRowsByFade = sortSimilarRowsByFade;
  window.sortSimilarRowsByBlue = sortSimilarRowsByBlue;
  window.ensureSimilarFadeSortDropdown = ensureSimilarFadeSortDropdown;
  window.watchGrid = watchGrid;
  window.ensureMainStar = ensureMainStar;
  window.runItemEnhancer = runItemEnhancer;
})();
