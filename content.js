(() => {
  'use strict';

  const DEFAULTS = { enabled: true, highlight: true, hide: false };
  const TTL = 7 * 24 * 60 * 60 * 1000;     // ważność wpisu w cache
  const RETRY_AFTER = 10 * 60 * 1000;      // ponowna próba po błędzie
  const MIN_CONC = 2, MAX_CONC = 12;       // adaptacyjna liczba równoległych zapytań
  const TIMEOUT = 15000;                   // limit czasu jednego zapytania
  const MAX_ATTEMPTS = 2;
  const PAGE_APP = (location.pathname.match(/^\/app\/(\d+)/) || [])[1] || null;

  const CARD_SELECTORS = [
    'a.search_result_row',
    'a.match',
    '.store_capsule',
    '.tab_item',
    '.home_content_item',
    '.cluster_capsule',
    '.recommended_spotlight_ctn',
    '.small_cap',
    '.wishlist_row',
    '.dailydeal',
    '[class*="StoreSaleWidgetOuterContainer"]'
  ].join(',');

  let S = { ...DEFAULTS };
  let cache = {};                    // { appid: [1|0, timestamp] }
  const queue = [];                  // id-ki czekające na start
  const queued = new Set();          // czekające + w trakcie pobierania
  const attempts = {};
  const failedAt = {};
  const durations = [];
  let limit = 8, active = 0, okStreak = 0, backoffStep = 0;
  let pausedUntil = 0, pumpTimer = null, saveTimer = null, scanTimer = null;
  let started = false, io = null;

  const fresh = (e) => e && Date.now() - e[1] < TTL;

  function applyClasses() {
    const r = document.documentElement;
    r.classList.toggle('saih-mark', S.enabled && S.highlight);
    r.classList.toggle('saih-hide', S.enabled && S.hide);
  }

  /* ---------- Wykrywanie ---------- */

  const MARKER = 'AI Generated Content Disclosure</h2>';
  // Kolejność w HTML: opis gry → AI Disclosure → Mature Content → System Requirements.
  // Gdy dotrzemy do wymagań systemowych bez znacznika, gra nie ma oznaczenia AI.
  const STOP = 'class="game_page_autocollapse sys_req"';
  const MARKER_TEXT = 'AI Generated Content Disclosure';

  // Wersja dla bieżącego dokumentu (strona samej gry)
  function hasAiDisclosure(doc) {
    return [...doc.querySelectorAll('h2')].some((h) => h.textContent.trim() === MARKER_TEXT);
  }

  // Strumieniowo: szukamy nagłówka w surowym HTML i przerywamy pobieranie po trafieniu.
  const RE_APP = /id="appHubAppName"|class="apphub_AppName"/;
  const RE_GATE = /id="agegate_box"|class="agegate_birthday_selector/;

  async function fetchStatus(id, signal) {
    const res = await fetch(`/app/${id}/?l=english`, { credentials: 'include', signal });
    if (res.status === 429 || res.status === 503) {
      const e = new Error('rate');
      e.retryAfter = (parseInt(res.headers.get('Retry-After'), 10) || 0) * 1000;
      throw e;
    }
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let tail = '', sawApp = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = tail + dec.decode(value, { stream: true });
      if (RE_GATE.test(chunk)) { reader.cancel(); return null; }
      if (chunk.includes(MARKER)) { reader.cancel(); return true; }
      if (!sawApp && RE_APP.test(chunk)) sawApp = true;
      if (sawApp && chunk.includes(STOP)) { reader.cancel(); return false; }
      tail = chunk.slice(-200);
    }
    return sawApp ? false : null;
  }

  /* ---------- Kolejka z priorytetami ---------- */

  function enqueue(id, front, defer) {
    if (fresh(cache[id])) return;
    if (queued.has(id)) {
      if (front) { const i = queue.indexOf(id); if (i > 0) { queue.splice(i, 1); queue.unshift(id); } }
      if (!defer) pump();
      return;
    }
    if (failedAt[id] && Date.now() - failedAt[id] < RETRY_AFTER) return;
    queued.add(id);
    front ? queue.unshift(id) : queue.push(id);
    if (!defer) pump();
  }

  function pump() {
    const wait = pausedUntil - Date.now();
    if (wait > 0) {
      if (!pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, wait + 20);
      return;
    }
    while (active < limit && queue.length) run(queue.shift());
  }

  function run(id) {
    active++;
    const t0 = performance.now();
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), TIMEOUT);

    fetchStatus(id, ctl.signal)
      .then((ai) => {
        durations.push(performance.now() - t0);
        if (durations.length > 30) durations.shift();
        okStreak++; backoffStep = 0;
        if (okStreak % 10 === 0 && limit < MAX_CONC) limit++;
        queued.delete(id);
        if (ai === null) { failedAt[id] = Date.now(); return; }
        cache[id] = [ai ? 1 : 0, Date.now()];
        saveSoon();
        refreshId(id);
      })
      .catch((e) => {
        okStreak = 0;
        if (e && e.message === 'rate') {
          limit = Math.max(MIN_CONC, Math.floor(limit / 2));
          backoffStep++;
          pausedUntil = Date.now() + Math.max(e.retryAfter || 0, Math.min(120000, 5000 * 2 ** backoffStep));
          queue.unshift(id);
        } else {
          attempts[id] = (attempts[id] || 0) + 1;
          if (attempts[id] < MAX_ATTEMPTS) queue.push(id);
          else { failedAt[id] = Date.now(); queued.delete(id); }
        }
      })
      .finally(() => { clearTimeout(to); active--; pump(); });
  }

  /* ---------- Cache ---------- */

  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      chrome.storage.local.get('cache').then(({ cache: stored = {} }) => {
        const merged = { ...stored, ...cache };
        for (const k of Object.keys(merged)) if (!fresh(merged[k])) delete merged[k];
        return chrome.storage.local.set({ cache: merged });
      }).catch(() => {});
    } catch (_) { /* kontekst rozszerzenia zamknięty */ }
  }
  function saveSoon() {
    if (!saveTimer) saveTimer = setTimeout(saveNow, 500);
  }
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  /* ---------- Stan kafelków ---------- */

  function applyBox(box) {
    const id = box.dataset.saihId;
    const e = cache[id];
    const st = fresh(e) ? (e[0] ? 'ai' : 'ok') : 'pending';
    if (box.dataset.saih !== st) box.dataset.saih = st;
    if (st === 'ai' && getComputedStyle(box).position === 'static') box.style.position = 'relative';
    return st;
  }

  function refreshId(id) {
    document.querySelectorAll(`[data-saih-id="${id}"]`).forEach(applyBox);
  }

  function setupObserver() {
    // Kafelki widoczne (lub tuż pod ekranem) wskakują na początek kolejki, od góry do dołu
    io = new IntersectionObserver((entries) => {
      const vis = entries
        .filter((e) => e.isIntersecting && e.target.dataset.saih === 'pending')
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      for (let i = vis.length - 1; i >= 0; i--) enqueue(vis[i].target.dataset.saihId, true, true);
      pump();
    }, { rootMargin: '500px 0px' });
  }

  function scan() {
    if (!S.enabled) return;
    const seen = new Set();
    document.querySelectorAll('a[href*="/app/"]').forEach((a) => {
      if (a.hostname !== location.hostname) return;
      const m = /\/app\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) return;
      const id = m[1];
      if (id === PAGE_APP) return;
      const box = a.closest(CARD_SELECTORS) || (a.querySelector('img') ? a : null);
      if (!box || seen.has(box)) return;
      seen.add(box);
      if (box.dataset.saihId !== id) {
        box.dataset.saihId = id;
        delete box.dataset.saih;
        io.unobserve(box);
        io.observe(box);
      }
      if (applyBox(box) === 'pending') enqueue(id, false, true);
    });
    pump();
  }

  function scanSoon() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 80);
  }

  /* ---------- Strona samej gry ---------- */

  function handlePageApp() {
    if (!PAGE_APP) return;
    setTimeout(() => {
      if (!document.querySelector('#appHubAppName, .apphub_AppName')) return;
      const ai = hasAiDisclosure(document);
      cache[PAGE_APP] = [ai ? 1 : 0, Date.now()];
      saveSoon();
      const old = document.getElementById('saih-banner');
      if (old) old.remove();
      if (ai && S.enabled) {
        const b = document.createElement('div');
        b.id = 'saih-banner';
        b.textContent = '⚠ Ta gra ma oznaczenie: treści generowane z użyciem AI';
        (document.querySelector('.page_content') || document.body).prepend(b);
      }
    }, 300);
  }

  /* ---------- SteamID zalogowanego użytkownika (do linku do biblioteki) ---------- */

  function captureSteamId() {
    try {
      const raw = document.querySelector('#application_config')?.getAttribute('data-userinfo');
      if (!raw) return;
      const u = JSON.parse(raw);
      if (!u || !u.logged_in || !/^\d{17}$/.test(String(u.steamid))) return;
      chrome.storage.local.get('steamid').then(({ steamid }) => {
        if (steamid !== u.steamid) chrome.storage.local.set({ steamid: u.steamid });
      });
    } catch (_) { /* brak danych użytkownika na tej stronie */ }
  }

  /* ---------- Start / ustawienia ---------- */

  function start() {
    if (started) return;
    started = true;
    setupObserver();
    scan();
    handlePageApp();
    new MutationObserver(scanSoon).observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    const st = await chrome.storage.local.get(['settings', 'cache']);
    S = { ...DEFAULTS, ...(st.settings || {}) };
    cache = st.cache || {};
    applyClasses();
    captureSteamId();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) {
        S = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
        applyClasses();
        if (S.enabled) { start(); scan(); }
      }
      if (changes.cache && !changes.cache.newValue) {   // wyczyszczono pamięć
        cache = {};
        queue.length = 0; queued.clear();
        document.querySelectorAll('[data-saih]').forEach((el) => { el.dataset.saih = 'pending'; });
        scan();
      }
    });

    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (msg && msg.type === 'saih:stats') {
        const all = new Set(), ai = new Set();
        document.querySelectorAll('[data-saih-id]').forEach((el) => {
          all.add(el.dataset.saihId);
          if (el.dataset.saih === 'ai') ai.add(el.dataset.saihId);
        });
        const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
        sendResponse({ total: all.size, ai: ai.size, pending: queue.length + active, avgMs: Math.round(avg), conc: limit });
      }
    });

    if (S.enabled) start();
  }

  init();
})();
