(function () {
  'use strict';

  const card = document.getElementById('pe-limits-card');
  if (!card || typeof chrome === 'undefined' || !chrome.runtime) return;

  function renderMessage(message, className) {
    card.textContent = '';
    const el = document.createElement('span');
    el.className = className || 'muted';
    el.textContent = message;
    card.appendChild(el);
  }

  function formatLabel(key) {
    return String(key || '')
      .replace(/_/g, ' ')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function formatValue(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    }
    return String(value);
  }

  function renderLimits(rows) {
    const list = document.createElement('ul');
    rows.slice(0, 8).forEach(([key, value]) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      const strong = document.createElement('strong');
      label.textContent = formatLabel(key);
      strong.textContent = formatValue(value);
      row.append(label, strong);
      list.appendChild(row);
    });

    card.textContent = '';
    if (list.children.length) card.appendChild(list);
    else renderMessage('No limit data returned.');
  }

  chrome.runtime.sendMessage({ type: 'PRICEMPIRE_GET_LIMITS' }, response => {
    if (chrome.runtime.lastError) {
      renderMessage(chrome.runtime.lastError.message, 'error');
      return;
    }
    if (!response || !response.success) {
      const message = response && response.error ? response.error.message : 'Could not load limits.';
      renderMessage(message, 'error');
      return;
    }
    renderLimits(response.data && Array.isArray(response.data.rows) ? response.data.rows : []);
  });
})();
