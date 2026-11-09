(() => {
  'use strict';

  const DEFAULTS = { enabled: true, highlight: true, hide: false, libMark: true };
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const RETRY_AFTER = 10 * 60 * 1000;
  const MIN_CONC = 2, MAX_CONC = 10, MAX_ATTEMPTS = 2;

  // Wszystko, co niesie identyfikator gry
  const SEL = 'img[src*="/steam/apps/"], a[href*="/app/"], [data-appid]';
  const ID_RES = [/\/steam\/apps\/(\d+)\//, /\/app\/(\d+)/, /details\/(\d+)/];

  let S = { ...DEFAULTS };
  let cache = {};
  const queue = [], queued = new Set(), attempts = {}, failedAt = {};
  let limit = 6, active = 0, okStreak = 0, backoffStep = 0;
  let pausedUntil = 0, pumpTimer = null, saveTimer = null, scanTimer = null;
  let started = false, io = null, marked = new Set(), chip = null;

  const fresh = (e) => e && Date.now() - e[1] < TTL;

  /* ---------- Rozpoznawanie kafelków ---------- */

  function idOf(el) {
    if (!el || !el.getAttribute) return null;
    const d = el.getAttribute('data-appid');
    if (d && /^\d+$/.test(d)) return d;
    for (const attr of ['src', 'href']) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      for (const re of ID_RES) { const m = re.exec(v); if (m) return m[1]; }
    }
    return null;
  }

  function firstId(c) {
    return idOf(c.matches(SEL) ? c : c.querySelector(SEL));
  }

  // Wracamy do największego elementu
  function cardFor(node, id) {
    let el = node;
    for (let lvl = 0; lvl < 10; lvl++) {
      const p = el.parentElement;
      if (!p || p === document.body || p.offsetHeight > 420) break;
      let multi = false;
      for (const c of p.children) {
        if (c === el) continue;
        const f = firstId(c);
        if (f && f !== id) { multi = true; break; }
      }
      if (multi) break;
      el = p;
    }
    return el;
  }

  /* ---------- Stan / klasy ---------- */

  function applyClasses() {
    const r = document.documentElement;
    r.classList.toggle('saih-mark', S.enabled && S.libMark);
    r.classList.remove('saih-hide');   // w bibliotece oznaczamy
  }

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
    updateChip();
  }

  /* ---------- Kolejka (sprawdzanie przez service worker) ---------- */

  function check(id) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'saih:check', id }).then((r) => {
        if (!r) return reject(new Error('noresp'));
        if (r.ok) return resolve(r.ai);
        const e = new Error(r.rate ? 'rate' : 'fail');
        e.retryAfter = r.retryAfter || 0;
        reject(e);
      }).catch(reject);
    });
  }

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
    check(id)
      .then((ai) => {
        okStreak++; backoffStep = 0;
        if (okStreak % 10 === 0 && limit < MAX_CONC) limit++;
        queued.delete(id);
        if (ai === null) { failedAt[id] = Date.now(); updateChip(); return; }
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
      .finally(() => { active--; pump(); updateChip(); });
  }

  /* ---------- Cache (wspólny ze sklepem) ---------- */

  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      chrome.storage.local.get('cache').then(({ cache: stored = {} }) => {
        const merged = { ...stored, ...cache };
        for (const k of Object.keys(merged)) if (!fresh(merged[k])) delete merged[k];
        return chrome.storage.local.set({ cache: merged });
      }).catch(() => {});
    } catch (_) {}
  }
  function saveSoon() { if (!saveTimer) saveTimer = setTimeout(saveNow, 500); }
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

  /* ---------- Skanowanie biblioteki ---------- */

  function setupObserver() {
    io = new IntersectionObserver((entries) => {
      const vis = entries
        .filter((e) => e.isIntersecting && e.target.dataset.saih === 'pending')
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      for (let i = vis.length - 1; i >= 0; i--) enqueue(vis[i].target.dataset.saihId, true, true);
      pump();
    }, { rootMargin: '500px 0px' });
  }

  function scan() {
    if (!S.enabled || !S.libMark) { updateChip(); return; }
    const seen = new Map();
    document.querySelectorAll(SEL).forEach((n) => {
      if (n.closest('#saih-chip')) return;
      const id = idOf(n);
      if (!id) return;
      const el = cardFor(n, id);
      if (!seen.has(el)) seen.set(el, id);
    });
    // sprzątanie po elementach
    marked.forEach((el) => {
      if (!seen.has(el) || !el.isConnected) {
        delete el.dataset.saih; delete el.dataset.saihId;
        io.unobserve(el);
      }
    });
    marked = new Set(seen.keys());
    seen.forEach((id, el) => {
      if (el.dataset.saihId !== id) {
        el.dataset.saihId = id;
        delete el.dataset.saih;
        io.unobserve(el); io.observe(el);
      }
      if (applyBox(el) === 'pending') enqueue(id, false, true);
    });
    pump();
    updateChip();
  }

  function scanSoon() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 120);
  }

  /* ---------- Licznik postępu ---------- */

  function counts() {
    const all = new Set(), ai = new Set(), done = new Set();
    document.querySelectorAll('[data-saih-id]').forEach((el) => {
      const id = el.dataset.saihId;
      all.add(id);
      if (el.dataset.saih === 'ai') ai.add(id);
      if (el.dataset.saih === 'ai' || el.dataset.saih === 'ok') done.add(id);
    });
    return { total: all.size, ai: ai.size, done: done.size };
  }

  function updateChip() {
    const c = counts();
    const show = S.enabled && S.libMark && c.total > 0;
    if (!show) { if (chip) chip.style.display = 'none'; return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'saih-chip';
      chip.title = 'Kliknij, aby ukryć';
      chip.addEventListener('click', () => { chip.style.display = 'none'; });
      document.body.appendChild(chip);
    }
    chip.style.display = '';
    chip.textContent = c.done < c.total
      ? `AI Filter: sprawdzono ${c.done}/${c.total} • gry z AI: ${c.ai}`
      : `AI Filter: gry z AI w bibliotece: ${c.ai} (sprawdzono ${c.total})`;
  }

  /* ---------- Start ---------- */

  function start() {
    if (started) return;
    started = true;
    setupObserver();
    scan();
    new MutationObserver(scanSoon).observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    const st = await chrome.storage.local.get(['settings', 'cache']);
    S = { ...DEFAULTS, ...(st.settings || {}) };
    cache = st.cache || {};
    applyClasses();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) {
        S = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
        applyClasses();
        if (S.enabled && S.libMark) { start(); scan(); } else updateChip();
      }
      if (changes.cache && !changes.cache.newValue) {
        cache = {};
        queue.length = 0; queued.clear();
        document.querySelectorAll('[data-saih]').forEach((el) => { el.dataset.saih = 'pending'; });
        scan();
      }
    });

    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (msg && msg.type === 'saih:stats') {
        const c = counts();
        sendResponse({ total: c.total, ai: c.ai, pending: queue.length + active, avgMs: 0, conc: limit });
      }
    });

    if (S.enabled && S.libMark) start();
  }

  init();
})();
