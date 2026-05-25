(function () {
  'use strict';

  const API_KEY = 'ce_pricempire_api_key';
  const SETTINGS = 'ce_pricempire_settings';

  const $ = id => document.getElementById(id);
  const status = $('status');

  function setStatus(message, type) {
    status.textContent = message || '';
    status.className = type || '';
  }

  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(values) {
    return new Promise(resolve => chrome.storage.local.set(values, resolve));
  }

  function sendMessage(message) {
    return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
  }

  function readSettings() {
    return {
      currency: $('currency').value,
    };
  }

  async function load() {
    const utils = window.cePricempire;
    const data = await storageGet([API_KEY, SETTINGS]);
    const settings = utils.normalizeSettings(data[SETTINGS]);

    $('apiKey').value = data[API_KEY] || '';
    $('currency').value = settings.currency;
  }

  async function save() {
    const apiKey = $('apiKey').value.trim();
    const settings = window.cePricempire.normalizeSettings(readSettings());
    await storageSet({ [API_KEY]: apiKey, [SETTINGS]: settings });
    setStatus('Saved.', 'ok');
  }

  async function testConnection() {
    const apiKey = $('apiKey').value.trim();
    setStatus('Testing Pricempire connection...');
    const response = await sendMessage({ type: 'PRICEMPIRE_TEST_KEY', apiKey });
    if (response && response.success) {
      setStatus(response.warning || 'Pricempire connection works.', 'ok');
    } else {
      setStatus(response && response.error ? response.error.message : 'Pricempire connection failed.', 'error');
    }
  }

  async function clearCache() {
    const response = await sendMessage({ type: 'PRICEMPIRE_CLEAR_CACHE' });
    setStatus(response && response.success ? 'Cache cleared.' : 'Could not clear cache.', response && response.success ? 'ok' : 'error');
  }

  document.addEventListener('DOMContentLoaded', () => {
    load().catch(err => setStatus(err.message, 'error'));
    $('save').addEventListener('click', () => save().catch(err => setStatus(err.message, 'error')));
    $('test').addEventListener('click', () => testConnection().catch(err => setStatus(err.message, 'error')));
    $('clearCache').addEventListener('click', () => clearCache().catch(err => setStatus(err.message, 'error')));
  });
})();
