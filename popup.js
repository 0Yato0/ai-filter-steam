const DEFAULTS = { enabled: true, highlight: true, hide: false, libMark: true };
const ids = ['enabled', 'highlight', 'hide', 'libMark'];

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

async function init() {
  const s = await loadSettings();
  ids.forEach((id) => {
    const el = document.getElementById(id);
    el.checked = s[id];
    el.addEventListener('change', async () => {
      const cur = await loadSettings();
      cur[id] = el.checked;
      await chrome.storage.local.set({ settings: cur });
      refreshStats();
    });
  });

  document.getElementById('clear').addEventListener('click', async () => {
    await chrome.storage.local.remove('cache');
    refreshStats();
  });

  document.getElementById('openLib').addEventListener('click', async () => {
    const { steamid } = await chrome.storage.local.get('steamid');
    if (steamid) {
      chrome.tabs.create({ url: `https://steamcommunity.com/profiles/${steamid}/games/?tab=all` });
    } else {
      document.getElementById('stats').textContent =
        'Wejdź na store.steampowered.com będąc zalogowanym, aby rozszerzenie poznało Twoje konto.';
    }
  });

  refreshStats();
  setInterval(refreshStats, 1000);
}

async function refreshStats() {
  const box = document.getElementById('stats');
  const { cache = {} } = await chrome.storage.local.get('cache');
  const vals = Object.values(cache);
  document.getElementById('cacheInfo').textContent =
    `W pamięci: ${vals.length} gier (w tym AI: ${vals.filter((v) => v[0]).length})`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'saih:stats' });
    box.textContent = `Na tej stronie: ${r.total} gier, AI: ${r.ai}` +
      (r.pending ? ` • sprawdzam jeszcze: ${r.pending}` : '') +
      (r.avgMs ? `\nŚr. czas sprawdzenia gry: ${(r.avgMs / 1000).toFixed(1)} s (równolegle: ${r.conc})` : '');
  } catch (_) {
    box.textContent = 'Otwórz sklep Steam lub swoją bibliotekę, aby zobaczyć statystyki.';
  }
}

init();
