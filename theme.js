// Applies the Appearance settings to extension pages: dn_theme ('dark' default | 'light' | 'system')
// and dn_appearance (accent colour and display preferences, applied by prefs.js).
(function () {
  const light = window.matchMedia('(prefers-color-scheme: light)');
  let pref = 'dark';
  let appearance = null;
  const apply = () => {
    const html = document.documentElement;
    const isLight = pref === 'light' || (pref === 'system' && light.matches);
    if (isLight) html.dataset.dnTheme = 'light';
    else delete html.dataset.dnTheme;
    if (window.__dnPrefs) window.__dnPrefs.apply(html, appearance, isLight);
  };
  light.addEventListener('change', apply);
  if (typeof chrome === 'undefined' || !chrome.storage) return apply(); // opened as a plain file
  chrome.storage.local.get(['dn_theme', 'dn_appearance'], (res) => {
    pref = res.dn_theme || 'dark';
    appearance = res.dn_appearance || null;
    apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.dn_theme) pref = changes.dn_theme.newValue || 'dark';
    if (changes.dn_appearance) appearance = changes.dn_appearance.newValue || null;
    if (changes.dn_theme || changes.dn_appearance) apply();
  });
})();
