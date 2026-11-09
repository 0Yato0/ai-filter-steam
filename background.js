// Service worker: sprawdza grę w sklepie na prośbę skryptu działającego na steamcommunity.com
// (skrypt z innej domeny nie może sam pobrać store.steampowered.com z powodu CORS).
const MARKER = 'AI Generated Content Disclosure</h2>';
const STOP = 'class="game_page_autocollapse sys_req"';
const RE_APP = /id="appHubAppName"|class="apphub_AppName"/;
const RE_GATE = /id="agegate_box"|class="agegate_birthday_selector/;

async function fetchStatus(id) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`https://store.steampowered.com/app/${id}/?l=english`,
      { credentials: 'include', signal: ctl.signal });
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
  } finally {
    clearTimeout(to);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'saih:check' || !/^\d+$/.test(String(msg.id))) return;
  fetchStatus(String(msg.id))
    .then((ai) => sendResponse({ ok: true, ai }))
    .catch((e) => sendResponse({ ok: false, rate: !!e && e.message === 'rate', retryAfter: (e && e.retryAfter) || 0 }));
  return true;
});
