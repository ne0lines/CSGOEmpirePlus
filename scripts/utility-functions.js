// Shared utilities

const LOG = "[ce]";
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);
const error = (...a) => console.error(LOG, ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(selector, { timeout = 12000, poll = 100 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        const el = document.querySelector(selector);
        if (el) return el;
        await sleep(poll);
    }
    return null;
}

const debounce = (fn, delay = 120) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); }; };

function normalizeItemName(raw) {
    if (!raw) return "";
    let s = String(raw).trim();
    s = s.replace(/^[\s★☆]+/, "").trim();
    s = s.replace(/\s*\((?:Factory\s*New|Minimal\s*Wear|Field[-\s]*Tested|Well[-\s]*Worn|Battle[-\s]*Scarred)\)\s*/gi, " ");
    s = s.replace(/\s{2,}/g, " ").replace(/\s*\|\s*/g, " | ").replace(/\s*-\s*/g, " - ").trim();
    return s;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function formatEtaMinutesToHM(mins) {
    const m = Number(mins);
    if (!Number.isFinite(m) || m < 0) return null;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// Expose functions globally
window.log = log;
window.warn = warn;
window.error = error;
window.sleep = sleep;
window.waitFor = waitFor;
window.debounce = debounce;
window.normalizeItemName = normalizeItemName;
window.escapeHtml = escapeHtml;
window.formatEtaMinutesToHM = formatEtaMinutesToHM;

// Debug utilities for styled, focusable logs
// Usage: window.debugUtils.dbg('tag', 'message', obj)
// To highlight logs for a tag: window.debugUtils.setFocus(['tag'])
(function attachDebugUtils() {
  const styles = {
    default: 'font: 1em sans-serif; color: #fff; background-color: #444; padding:2px 6px; border-radius:2px;',
    background: 'font: 1em sans-serif; color: yellow; background-color: red; padding:2px 6px; border-radius:2px;',
    fetcher: 'font: 1em sans-serif; color: #fff; background-color: #1e90ff; padding:2px 6px; border-radius:2px;'
  };

  const focusTags = new Set();

  function applyStyle(tag, label, args) {
    const style = styles[tag] || styles.default;
    // First parameter is the formatted label
    return [`%c${label}`, style, ...args];
  }

  function dbg(tag, ...args) {
    try {
      const label = `[${tag}]`;
      if (focusTags.has(tag)) {
        const params = applyStyle(tag, label, args);
        console.log.apply(console, params);
      } else {
        console.log(label, ...args);
      }
    } catch (err) {
      console.log(`[debugUtils] ${tag}`, ...args);
    }
  }

  function setFocus(tags) {
    focusTags.clear();
    if (Array.isArray(tags)) {
      tags.forEach(t => { if (t) focusTags.add(String(t)); });
    } else if (typeof tags === 'string') {
      focusTags.add(tags);
    }
    // Persist for other contexts (background/service worker) to read if needed
    try { chrome && chrome.storage && chrome.storage.local && chrome.storage.local.set({ debugFocus: Array.from(focusTags) }); } catch (e) { /* ignore */ }
  }

  function loadFocus() {
    try {
      if (chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
        chrome.storage.local.get('debugFocus', res => {
          const arr = (res && res.debugFocus) || [];
          focusTags.clear();
          arr.forEach(t => focusTags.add(String(t)));
        });
      }
    } catch (e) { /* ignore */ }
  }

  function clearFocus() { focusTags.clear(); try { chrome && chrome.storage && chrome.storage.local && chrome.storage.local.remove('debugFocus'); } catch (e) {} }

  // Expose API
  window.debugUtils = {
    dbg,
    setFocus,
    clearFocus,
    _focusTags: focusTags // exposed for inspection
  };

  // Initially try to load persisted focus
  loadFocus();
})();
