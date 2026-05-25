const PROXY_URL = "https://extension.ne0lines.xyz/empire_proxy.php";
const PER_PAGE = 100;
const MAX_PAGES = 10;

async function fetchEmpireItemsByName(name) {
    const results = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = new URL(PROXY_URL);
        url.searchParams.set("per_page", String(PER_PAGE));
        url.searchParams.set("page", String(page));
        url.searchParams.set("search", name);
        const res = await fetch(url.toString(), { method: "GET", credentials: "omit" });
        if (!res.ok) throw new Error(`Proxy/API ${res.status}`);
        const json = await res.json();
        const pageData = Array.isArray(json?.data) ? json.data : [];
        results.push(...pageData);
        if (pageData.length < PER_PAGE) break;
    }
    const exact = results.filter(x => x?.market_name === name);
    return exact.length ? exact : results;
}

// Expose functions globally
window.fetchEmpireItemsByName = fetchEmpireItemsByName;
