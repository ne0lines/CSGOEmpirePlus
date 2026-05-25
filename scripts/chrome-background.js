chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type !== 'FETCH_EMPIRE') return;
    try {
      const u = new URL('https://extension.ne0lines.xyz/empire_proxy.php');
      for (const [k, v] of Object.entries(msg.params || {})) u.searchParams.set(k, v);
      const r = await fetch(u.toString(), { method: 'GET' });
      const data = await r.json();
      sendResponse({ ok: r.ok, status: r.status, data });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // respond asynchronously
});
