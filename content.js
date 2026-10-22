(function () {
  const STORAGE_PREFIX = 'dn_annotations::';
  const pageKey = () => STORAGE_PREFIX + location.href.split('#')[0];

  let annotateMode = false;
  let sidebarOpen = false;
  let hoveredEl = null;
  let annotations = [];

  // A copy injected before an extension reload/update is orphaned (its chrome.* calls
  // throw). When this script is injected again on demand, replace that dead UI.
  const staleRoot = document.getElementById('designnote-root');
  if (staleRoot) staleRoot.remove();

  const root = document.createElement('div');
  root.id = 'designnote-root';
  document.documentElement.appendChild(root);

  // An open modal <dialog> makes everything outside it inert: the UI would show but not
  // take clicks or typing. While one is open, keep the root inside the topmost one.
  // ponytail: polled (600ms, with the SPA check) + on Mark/form/sidebar open; a dialog that
  // centres itself with `transform` would clip our fixed UI — use a MutationObserver/popover if that bites.
  function placeRoot() {
    const modals = Array.from(document.querySelectorAll('dialog')).filter((d) => d.matches(':modal'));
    const host = modals[modals.length - 1] || document.documentElement;
    if (root.parentNode !== host) host.appendChild(root);
  }

  function extensionAlive() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
  }
  // Clicks on an orphaned copy would fail silently; say what to do instead.
  root.addEventListener('click', (e) => {
    if (extensionAlive()) return;
    e.preventDefault();
    e.stopPropagation();
    toast('Redlines was updated. Refresh this page to keep annotating.');
  }, true);

  // ---------- Appearance (Settings → dn_theme: 'dark' default | 'light' | 'system';
  // dn_appearance: accent colour, corners, text size, font, glass, motion, pins — see prefs.js) ----------
  const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
  let themePref = 'dark';
  let appearance = null;
  // The Inspect cursor and jump outline sit on host elements, outside the root's tokens
  const hostAccentStyle = document.createElement('style');
  root.appendChild(hostAccentStyle);
  function applyTheme() {
    const light = themePref === 'light' || (themePref === 'system' && lightQuery.matches);
    if (light) root.dataset.dnTheme = 'light';
    else delete root.dataset.dnTheme;
    window.__dnPrefs.apply(root, appearance, light);
    hostAccentStyle.textContent = window.__dnPrefs.hostCss(appearance);
  }
  // Settings → dn_show_categories: category picker in the annotation forms (off by default; notes save as "note")
  let showCategories = false;
  chrome.storage.local.get(['dn_theme', 'dn_appearance', 'dn_show_categories'], (res) => {
    themePref = res.dn_theme || 'dark';
    appearance = res.dn_appearance || null;
    applyTheme();
    showCategories = res.dn_show_categories === true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.dn_theme) { themePref = changes.dn_theme.newValue || 'dark'; applyTheme(); }
    if (changes.dn_appearance) { appearance = changes.dn_appearance.newValue || null; applyTheme(); }
    if (changes.dn_show_categories) showCategories = changes.dn_show_categories.newValue === true;
  });
  lightQuery.addEventListener('change', applyTheme);

  // ---------- Storage helpers ----------
  function loadAnnotations(cb) {
    chrome.storage.local.get([pageKey()], (res) => {
      annotations = res[pageKey()] || [];
      updateBadge(annotations);
      cb && cb(annotations);
    });
  }

  function saveAnnotations(cb) {
    chrome.storage.local.set({ [pageKey()]: annotations }, () => {
      if (chrome.runtime.lastError) {
        toast('Save failed: ' + chrome.runtime.lastError.message);
        return;
      }
      updateBadge(annotations); // callers update `annotations` before saving
      cb && cb();
    });
  }

  function uid() {
    return 'dn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Pill state persistence ----------
  const PILL_STATE_KEY = 'dn_pill_state';
  let pillState = {
    position: null, // { x, y }
    orientation: 'horizontal', // 'vertical' | 'horizontal'
    closed: false,
    dock: 'bottom' // 'right' | 'bottom' | 'left' | 'top'
  };

  function loadPillState(cb) {
    chrome.storage.local.get(PILL_STATE_KEY, (res) => {
      const saved = res[PILL_STATE_KEY];
      if (saved) {
        pillState = { ...pillState, ...saved };
      }
      cb && cb(pillState);
    });
  }

  function savePillState() {
    chrome.storage.local.set({ [PILL_STATE_KEY]: pillState });
  }

  function applyPillState(state) {
    if (state.closed) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    setOrientation(state.orientation);
    if (state.position) {
      pill.style.left = state.position.x + 'px';
      pill.style.top = state.position.y + 'px';
      pill.style.right = 'auto';
      pill.style.bottom = 'auto';
      pill.style.transform = 'none';
    } else {
      snapToNearestEdge();
    }
  }

  function setOrientation(orientation) {
    pill.dataset.orientation = orientation;
    pillState.orientation = orientation;
  }

  function snapToNearestEdge() {
    const rect = pill.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const padding = 12;

    const distRight = viewportW - centerX;
    const distBottom = viewportH - centerY;
    const distLeft = centerX;
    const distTop = centerY;

    const minDist = Math.min(distRight, distBottom, distLeft, distTop);

    if (minDist === distRight) {
      pill.style.right = padding + 'px';
      pill.style.top = Math.max(padding, Math.min(viewportH - rect.height - padding, rect.top)) + 'px';
      pill.style.left = 'auto';
      pill.style.bottom = 'auto';
      pill.style.transform = 'none';
      pill.dataset.dock = 'right';
      setOrientation('vertical');
    } else if (minDist === distBottom) {
      pill.style.bottom = padding + 'px';
      pill.style.left = Math.max(padding, Math.min(viewportW - rect.width - padding, rect.left)) + 'px';
      pill.style.right = 'auto';
      pill.style.top = 'auto';
      pill.style.transform = 'none';
      pill.dataset.dock = 'bottom';
      setOrientation('horizontal');
    } else if (minDist === distLeft) {
      pill.style.left = padding + 'px';
      pill.style.top = Math.max(padding, Math.min(viewportH - rect.height - padding, rect.top)) + 'px';
      pill.style.right = 'auto';
      pill.style.bottom = 'auto';
      pill.style.transform = 'none';
      pill.dataset.dock = 'left';
      setOrientation('vertical');
    } else {
      pill.style.top = padding + 'px';
      pill.style.left = Math.max(padding, Math.min(viewportW - rect.width - padding, rect.left)) + 'px';
      pill.style.right = 'auto';
      pill.style.bottom = 'auto';
      pill.style.transform = 'none';
      pill.dataset.dock = 'top';
      setOrientation('horizontal');
    }
    pillState.dock = pill.dataset.dock;
    savePillState();
  }

  // Keep the dock on screen when the window shrinks (its left/top are absolute pixels).
  function clampPill() {
    if (pill.hidden) return;
    const r = pill.getBoundingClientRect();
    const pad = 12;
    if (r.left < pad || r.right > innerWidth - pad) pill.style.left = Math.max(pad, Math.min(innerWidth - r.width - pad, r.left)) + 'px';
    if (pill.style.top && pill.style.top !== 'auto' && (r.top < pad || r.bottom > innerHeight - pad)) {
      pill.style.top = Math.max(pad, Math.min(innerHeight - r.height - pad, r.top)) + 'px';
    }
  }
  window.addEventListener('resize', () => requestAnimationFrame(clampPill), { passive: true });

  // ---------- Toast ----------
  // action: optional { label, onClick } — shows a button and keeps the toast up longer
  function toast(msg, action) {
    const t = document.createElement('div');
    t.className = 'dn-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dn-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        t.remove();
        action.onClick();
      });
      t.appendChild(btn);
    }
    root.appendChild(t);
    setTimeout(() => t.remove(), action ? 6000 : 2000);
  }

  // ---------- Icon helper ----------
  // Hugeicons free set (hugeicons.com, MIT), stroke-rounded, 1.5px stroke: the wrapper in
  // dnIcon() supplies fill/stroke defaults, so only per-element overrides stay inline.
  // Generated from @hugeicons/core-free-icons@4.3.4.
  const DN_ICONS = {
    target: '<path d="M17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7"/><path d="M14 2.20004C13.3538 2.06886 12.6849 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 11.3151 21.9311 10.6462 21.8 10"/><path d="M12.0303 11.9625L16.5832 7.4096M19.7404 4.34462L19.1872 2.35748C19.0853 2.03011 18.6914 1.89965 18.4259 2.11662C16.9898 3.29018 15.4254 4.87091 16.703 7.36419C19.2771 8.56455 20.7466 6.94584 21.8733 5.5853C22.0975 5.3146 21.9623 4.90767 21.6247 4.81005L19.7404 4.34462Z"/>',
    pointer: '<path d="M9.80282 4.62973L15.8364 6.99069C19.3164 8.35243 21.0564 9.03329 20.9987 10.1133C20.941 11.1934 19.1251 11.6886 15.4933 12.6791C14.412 12.974 13.8713 13.1215 13.4964 13.4963C13.1215 13.8712 12.9741 14.4119 12.6791 15.4933C11.6887 19.125 11.1934 20.9409 10.1134 20.9986C9.03335 21.0563 8.35249 19.3163 6.99075 15.8363L4.62979 9.80276C3.20411 6.15934 2.49127 4.33764 3.41448 3.41442C4.3377 2.49121 6.15941 3.20405 9.80282 4.62973Z"/>',
    message: '<path d="M8.5 14.5H15.5M8.5 9.5H12"/><path d="M14.1706 20.8905C18.3536 20.6125 21.6856 17.2332 21.9598 12.9909C22.0134 12.1607 22.0134 11.3009 21.9598 10.4707C21.6856 6.22838 18.3536 2.84913 14.1706 2.57107C12.7435 2.47621 11.2536 2.47641 9.8294 2.57107C5.64639 2.84913 2.31441 6.22838 2.04024 10.4707C1.98659 11.3009 1.98659 12.1607 2.04024 12.9909C2.1401 14.536 2.82343 15.9666 3.62791 17.1746C4.09501 18.0203 3.78674 19.0758 3.30021 19.9978C2.94941 20.6626 2.77401 20.995 2.91484 21.2351C3.05568 21.4752 3.37026 21.4829 3.99943 21.4982C5.24367 21.5285 6.08268 21.1757 6.74868 20.6846C7.1264 20.4061 7.31527 20.2668 7.44544 20.2508C7.5756 20.2348 7.83177 20.3403 8.34401 20.5513C8.8044 20.7409 9.33896 20.8579 9.8294 20.8905C11.2536 20.9852 12.7435 20.9854 14.1706 20.8905Z"/>',
    arrowRight: '<path d="M18.5 12L4.99997 12"/><path d="M13 18C13 18 19 13.5811 19 12C19 10.4188 13 6 13 6"/>',
    x: '<path d="M18 6L6.00081 17.9992M17.9992 18L6 6.00085"/>',
    plus: '<path d="M12.001 5.00003V19.002"/><path d="M19.002 12.002L4.99998 12.002"/>',
    copy: '<path d="M7.5 14.5C7.5 11.2002 7.5 9.55025 8.52513 8.52513C9.55025 7.5 11.2002 7.5 14.5 7.5C17.7998 7.5 19.4497 7.5 20.4749 8.52513C21.5 9.55025 21.5 11.2002 21.5 14.5C21.5 17.7998 21.5 19.4497 20.4749 20.4749C19.4497 21.5 17.7998 21.5 14.5 21.5C11.2002 21.5 9.55025 21.5 8.52513 20.4749C7.5 19.4497 7.5 17.7998 7.5 14.5Z"/><path d="M7.5 16.5C6.10355 16.5 5.40533 16.5 4.84402 16.3036C3.83866 15.9518 3.0482 15.1613 2.69641 14.156C2.5 13.5947 2.5 12.8964 2.5 11.5V9.5C2.5 6.20017 2.5 4.55025 3.52513 3.52513C4.55025 2.5 6.20017 2.5 9.5 2.5H11.5C12.8964 2.5 13.5947 2.5 14.156 2.69641C15.1613 3.0482 15.9518 3.83866 16.3036 4.84402C16.5 5.40533 16.5 6.10355 16.5 7.5"/>',
    sparkles: '<path d="M15 2L15.5387 4.39157C15.9957 6.42015 17.5798 8.00431 19.6084 8.46127L22 9L19.6084 9.53873C17.5798 9.99569 15.9957 11.5798 15.5387 13.6084L15 16L14.4613 13.6084C14.0043 11.5798 12.4202 9.99569 10.3916 9.53873L8 9L10.3916 8.46127C12.4201 8.00431 14.0043 6.42015 14.4613 4.39158L15 2Z"/><path d="M7 12L7.38481 13.7083C7.71121 15.1572 8.84275 16.2888 10.2917 16.6152L12 17L10.2917 17.3848C8.84275 17.7112 7.71121 18.8427 7.38481 20.2917L7 22L6.61519 20.2917C6.28879 18.8427 5.15725 17.7112 3.70827 17.3848L2 17L3.70827 16.6152C5.15725 16.2888 6.28879 15.1573 6.61519 13.7083L7 12Z"/>',
    trash: '<path d="M19.5 5.5L18.8803 15.5251C18.7219 18.0864 18.6428 19.3671 18.0008 20.2879C17.6833 20.7431 17.2747 21.1273 16.8007 21.416C15.8421 22 14.559 22 11.9927 22C9.42312 22 8.1383 22 7.17905 21.4149C6.7048 21.1257 6.296 20.7408 5.97868 20.2848C5.33688 19.3626 5.25945 18.0801 5.10461 15.5152L4.5 5.5"/><path d="M3 5.5H21M16.0557 5.5L15.3731 4.09173C14.9196 3.15626 14.6928 2.68852 14.3017 2.39681C14.215 2.3321 14.1231 2.27454 14.027 2.2247C13.5939 2 13.0741 2 12.0345 2C10.9688 2 10.436 2 9.99568 2.23412C9.8981 2.28601 9.80498 2.3459 9.71729 2.41317C9.32164 2.7167 9.10063 3.20155 8.65861 4.17126L8.05292 5.5"/><path d="M9.5 16.5L9.5 10.5"/><path d="M14.5 16.5L14.5 10.5"/>',
    edit: '<path d="M16.4249 4.60509L17.4149 3.6151C18.2351 2.79497 19.5648 2.79497 20.3849 3.6151C21.205 4.43524 21.205 5.76493 20.3849 6.58507L19.3949 7.57506M16.4249 4.60509L9.76558 11.2644C9.25807 11.772 8.89804 12.4078 8.72397 13.1041L8 16L10.8959 15.276C11.5922 15.102 12.228 14.7419 12.7356 14.2344L19.3949 7.57506M16.4249 4.60509L19.3949 7.57506"/><path d="M18.9999 13.5C18.9999 16.7875 18.9999 18.4312 18.092 19.5376C17.9258 19.7401 17.7401 19.9258 17.5375 20.092C16.4312 21 14.7874 21 11.4999 21H11C7.22876 21 5.34316 21 4.17159 19.8284C3.00003 18.6569 3 16.7712 3 13V12.5C3 9.21252 3 7.56879 3.90794 6.46244C4.07417 6.2599 4.2599 6.07417 4.46244 5.90794C5.56879 5 7.21252 5 10.5 5"/>',
    table: '<path d="M3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28248 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28248 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088Z"/><path d="M2.5 9L21.5 9"/><path d="M16 21.5L16 2.5"/><path d="M8 21.4998L8 2.49976"/>',
    download: '<path d="M16.9504 12.1817C17.1981 12.814 16.5076 13.5726 15.1267 15.0899C13.6702 16.6902 12.9201 17.4904 12 17.5C11.0799 17.4904 10.3298 16.6902 8.87331 15.0899C7.49239 13.5726 6.80193 12.814 7.04964 12.1817C7.05868 12.1586 7.06851 12.1359 7.0791 12.1135C7.34928 11.542 8.24477 11.5029 10 11.5002V4.99998C10 4.53501 10 4.30253 10.0511 4.11179C10.1898 3.59414 10.5941 3.1898 11.1118 3.05111C11.3025 3 11.535 3 12 3C12.4649 3 12.6974 3 12.8882 3.05111C13.4058 3.1898 13.8102 3.59414 13.9489 4.11179C14 4.30253 14 4.53501 14 4.99998V11.5002C15.7552 11.5029 16.6507 11.542 16.9209 12.1135C16.9315 12.1359 16.9413 12.1586 16.9504 12.1817Z"/><path d="M5.00006 21H19.0001"/>',
    image: '<circle cx="7.5" cy="7.5" r="1.5"/><path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z"/><path d="M5 21C9.37246 15.775 14.2741 8.88406 21.4975 13.5424"/>',
    sheet: '<path d="M4 22V9.45584C4 6.21082 4 4.58831 4.88607 3.48933C5.06508 3.26731 5.26731 3.06508 5.48933 2.88607C6.58831 2 8.21082 2 11.4558 2C12.1614 2 12.5141 2 12.8372 2.11401C12.9044 2.13772 12.9702 2.165 13.0345 2.19575C13.3436 2.34355 13.593 2.593 14.0919 3.09188L18.8284 7.82843C19.4065 8.40649 19.6955 8.69552 19.8478 9.06306C20 9.4306 20 9.83935 20 10.6569V14C20 17.7712 20 19.6569 18.8284 20.8284C17.8971 21.7598 16.5144 21.9508 14.0919 21.9899M13 2.5V3C13 5.82843 13 7.24264 13.8787 8.12132C14.7574 9 16.1716 9 19 9H19.5"/><path d="M7.5 5.5H7M10 7.5H9.5M7.5 9.5H7M10 11.5226H9.5M7.5 13.5H7"/><path d="M11 22.0001V19C11 17.8954 10.1046 17 9 17C7.89543 17 7 17.8954 7 19V22.0001H11Z"/>',
    fileText: '<path d="M8 7L16 7"/><path d="M8 11L12 11"/><path d="M13 21.5V21C13 18.1716 13 16.7574 13.8787 15.8787C14.7574 15 16.1716 15 19 15H19.5M20 13.3431V10C20 6.22876 20 4.34315 18.8284 3.17157C17.6569 2 15.7712 2 12 2C8.22877 2 6.34315 2 5.17157 3.17157C4 4.34314 4 6.22876 4 10L4 14.5442C4 17.7892 4 19.4117 4.88607 20.5107C5.06508 20.7327 5.26731 20.9349 5.48933 21.1139C6.58831 22 8.21082 22 11.4558 22C12.1614 22 12.5141 22 12.8372 21.886C12.9044 21.8623 12.9702 21.835 13.0345 21.8043C13.3436 21.6564 13.593 21.407 14.0919 20.9081L18.8284 16.1716C19.4065 15.5935 19.6955 15.3045 19.8478 14.9369C20 14.5694 20 14.1606 20 13.3431Z"/>',
    braces: '<path d="M8 3C7.5355 3 7.30325 3 7.10891 3.03078C6.03918 3.20021 5.20021 4.03918 5.03078 5.10891C5 5.30325 5 5.5355 5 6L5 10C5 11.1046 4.10457 12 3 12C4.10406 11.9982 5 12.8928 5 13.9968V18C5 18.4645 5 18.6968 5.03078 18.8911C5.20021 19.9608 6.03918 20.7998 7.10891 20.9692C7.30325 21 7.5355 21 8 21"/><path d="M16 3C16.4645 3 16.6968 3 16.8911 3.03078C17.9608 3.20021 18.7998 4.03918 18.9692 5.10891C19 5.30325 19 5.5355 19 6L19 10C19 11.1046 19.8954 12 21 12C19.8959 11.9982 19 12.8928 19 13.9968V18C19 18.4645 19 18.6968 18.9692 18.8911C18.7998 19.9608 17.9608 20.7998 16.8911 20.9692C16.6968 21 16.4645 21 16 21"/>',
    code: '<path d="M17 8L18.8398 9.85008C19.6133 10.6279 20 11.0168 20 11.5C20 11.9832 19.6133 12.3721 18.8398 13.1499L17 15"/><path d="M7 8L5.16019 9.85008C4.38673 10.6279 4 11.0168 4 11.5C4 11.9832 4.38673 12.3721 5.16019 13.1499L7 15"/><path d="M14.5 4L9.5 20"/>',
    cloudUpload: '<path d="M17.4776 9.01106C17.485 9.01102 17.4925 9.01101 17.5 9.01101C19.9853 9.01101 22 11.0294 22 13.5193C22 15.8398 20.25 17.7508 18 18M17.4776 9.01106C17.4924 8.84606 17.5 8.67896 17.5 8.51009C17.5 5.46695 15.0376 3 12 3C9.12324 3 6.76233 5.21267 6.52042 8.03192M17.4776 9.01106C17.3753 10.1476 16.9286 11.1846 16.2428 12.0165M6.52042 8.03192C3.98398 8.27373 2 10.4139 2 13.0183C2 15.4417 3.71776 17.4632 6 17.9273M6.52042 8.03192C6.67826 8.01687 6.83823 8.00917 7 8.00917C8.12582 8.00917 9.16474 8.38194 10.0005 9.01101"/><path d="M12 13L12 21M12 13C11.2998 13 9.99153 14.9943 9.5 15.5M12 13C12.7002 13 14.0085 14.9943 14.5 15.5"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z"/><path d="M21 15H3"/><path d="M21 9H3"/>',
    search: '<path d="M17 17L21 21"/><path d="M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z"/>',
    check: '<path d="M5 14L8.5 17.5L19 6.5"/>',
    rail: '<path d="M2 12C2 8.3109 2 6.46633 2.81382 5.1588C3.1149 4.67505 3.48891 4.2543 3.91891 3.91557C5.08116 3.00003 6.72077 3.00003 10 3.00003H14C17.2792 3.00003 18.9188 3.00003 20.0811 3.91557C20.5111 4.2543 20.8851 4.67505 21.1862 5.1588C22 6.46633 22 8.3109 22 12C22 15.6892 22 17.5337 21.1862 18.8413C20.8851 19.325 20.5111 19.7458 20.0811 20.0845C18.9188 21 17.2792 21 14 21H10C6.72077 21 5.08116 21 3.91891 20.0845C3.48891 19.7458 3.1149 19.325 2.81382 18.8413C2 17.5337 2 15.6892 2 12Z"/><path d="M14.5 3.00003L14.5 21"/><path d="M18 7.00006H19M18 10.0001H19"/>',
    chevronDown: '<path d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9"/>',
    csv: '<path d="M7.5 17.2196C7.44458 16.0292 6.62155 16 5.50505 16C3.78514 16 3.5 16.406 3.5 18V20C3.5 21.594 3.78514 22 5.50505 22C6.62154 22 7.44458 21.9708 7.5 20.7804M20.5 16L18.7229 20.6947C18.3935 21.5649 18.2288 22 17.968 22C17.7071 22 17.5424 21.5649 17.213 20.6947L15.4359 16M12.876 16H11.6951C11.2231 16 10.9872 16 10.8011 16.0761C10.1672 16.3354 10.1758 16.9448 10.1758 17.5C10.1758 18.0553 10.1672 18.6647 10.8011 18.9239C10.9872 19 11.2232 19 11.6951 19C12.167 19 12.4029 19 12.5891 19.0761C13.2229 19.3354 13.2143 19.9447 13.2143 20.5C13.2143 21.0553 13.2229 21.6647 12.5891 21.9239C12.4029 22 12.167 22 11.6951 22H10.4089"/><path d="M20 13V10.6569C20 9.83935 20 9.4306 19.8478 9.06306C19.6955 8.69552 19.4065 8.40649 18.8284 7.82843L14.0919 3.09188C13.593 2.593 13.3436 2.34355 13.0345 2.19575C12.9702 2.165 12.9044 2.13772 12.8372 2.11401C12.5141 2 12.1614 2 11.4558 2C8.21082 2 6.58831 2 5.48933 2.88607C5.26731 3.06508 5.06508 3.26731 4.88607 3.48933C4 4.58831 4 6.21082 4 9.45584V13M13 2.5V3C13 5.82843 13 7.24264 13.8787 8.12132C14.7574 9 16.1716 9 19 9H19.5"/>',
    pdf: '<path d="M20 13V10.6569C20 9.83935 20 9.4306 19.8478 9.06306C19.6955 8.69552 19.4065 8.40649 18.8284 7.82843L14.0919 3.09188C13.593 2.593 13.3436 2.34355 13.0345 2.19575C12.9702 2.165 12.9044 2.13772 12.8372 2.11401C12.5141 2 12.1614 2 11.4558 2C8.21082 2 6.58831 2 5.48933 2.88607C5.26731 3.06508 5.06508 3.26731 4.88607 3.48933C4 4.58831 4 6.21082 4 9.45584V13M13 2.5V3C13 5.82843 13 7.24264 13.8787 8.12132C14.7574 9 16.1716 9 19 9H19.5"/><path d="M19.75 16H17.25C16.6977 16 16.25 16.4477 16.25 17V19M16.25 19V22M16.25 19H19.25M4.25 22V19.5M4.25 19.5V16H6C6.9665 16 7.75 16.7835 7.75 17.75C7.75 18.7165 6.9665 19.5 6 19.5H4.25ZM10.25 16H11.75C12.8546 16 13.75 16.8954 13.75 18V20C13.75 21.1046 12.8546 22 11.75 22H10.25V16Z"/>',
    notion: '<path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z"/><path d="M8.42857 10L13.5196 16.3964C13.716 16.6432 13.9002 16.8767 14.2159 16.9639C14.3466 17 14.4882 17 14.7714 17C15.0515 17 15.1915 17 15.2984 16.9455C15.5894 16.7973 15.5714 16.4841 15.5714 16.2V13.4286M8.42857 10V7M8.42857 10V17M8.42857 7H9.53035C10.0067 7 10.2448 7 10.4514 7.10018C10.6581 7.20035 10.8056 7.38733 11.1006 7.76128L15.5714 13.4286M8.42857 7H7M8.42857 17H7M8.42857 17H10M15.5714 7V13.4286M15.5714 7H14M15.5714 7H17"/>',
    slack: '<path d="M13 9.25V3.75C13 2.7835 13.7835 2 14.75 2C15.7165 2 16.5 2.7835 16.5 3.75V9.25C16.5 10.2165 15.7165 11 14.75 11C13.7835 11 13 10.2165 13 9.25Z"/><path d="M7.5 20.25V14.75C7.5 13.7835 8.2835 13 9.25 13C10.2165 13 11 13.7835 11 14.75V20.25C11 21.2165 10.2165 22 9.25 22C8.2835 22 7.5 21.2165 7.5 20.25Z"/><path d="M14.75 13L20.25 13C21.2165 13 22 13.7835 22 14.75C22 15.7165 21.2165 16.5 20.25 16.5L14.75 16.5C13.7835 16.5 13 15.7165 13 14.75C13 13.7835 13.7835 13 14.75 13Z"/><path d="M3.75 7.5L9.25 7.5C10.2165 7.5 11 8.2835 11 9.25C11 10.2165 10.2165 11 9.25 11L3.75 11C2.7835 11 2 10.2165 2 9.25C2 8.2835 2.7835 7.5 3.75 7.5Z"/><path d="M7 3.75C7 4.7165 7.7835 5.5 8.75 5.5H10.5V3.75C10.5 2.7835 9.7165 2 8.75 2C7.7835 2 7 2.7835 7 3.75Z"/><path d="M17 20.25C17 19.2835 16.2165 18.5 15.25 18.5H13.5V20.25C13.5 21.2165 14.2835 22 15.25 22C16.2165 22 17 21.2165 17 20.25Z"/><path d="M20.25 7C19.2835 7 18.5 7.7835 18.5 8.75L18.5 10.5H20.25C21.2165 10.5 22 9.7165 22 8.75C22 7.7835 21.2165 7 20.25 7Z"/><path d="M3.75 17C4.7165 17 5.5 16.2165 5.5 15.25V13.5L3.75 13.5C2.7835 13.5 2 14.2835 2 15.25C2 16.2165 2.7835 17 3.75 17Z"/>',
    github: '<path d="M10 20.5675C6.57143 21.7248 3.71429 20.5675 2 17"/><path d="M10 22V18.7579C10 18.1596 10.1839 17.6396 10.4804 17.1699C10.6838 16.8476 10.5445 16.3904 10.1771 16.2894C7.13394 15.4528 5 14.1077 5 9.64606C5 8.48611 5.38005 7.39556 6.04811 6.4464C6.21437 6.21018 6.29749 6.09208 6.31748 5.9851C6.33746 5.87813 6.30272 5.73852 6.23322 5.45932C5.95038 4.32292 5.96871 3.11619 6.39322 2.02823C6.39322 2.02823 7.27042 1.74242 9.26698 2.98969C9.72282 3.27447 9.95075 3.41686 10.1515 3.44871C10.3522 3.48056 10.6206 3.41384 11.1573 3.28041C11.8913 3.09795 12.6476 3 13.5 3C14.3524 3 15.1087 3.09795 15.8427 3.28041C16.3794 3.41384 16.6478 3.48056 16.8485 3.44871C17.0493 3.41686 17.2772 3.27447 17.733 2.98969C19.7296 1.74242 20.6068 2.02823 20.6068 2.02823C21.0313 3.11619 21.0496 4.32292 20.7668 5.45932C20.6973 5.73852 20.6625 5.87813 20.6825 5.9851C20.7025 6.09207 20.7856 6.21019 20.9519 6.4464C21.6199 7.39556 22 8.48611 22 9.64606C22 14.1077 19.8661 15.4528 16.8229 16.2894C16.4555 16.3904 16.3162 16.8476 16.5196 17.1699C16.8161 17.6396 17 18.1596 17 18.7579V22"/>',
    gitlab: '<path d="M21.7976 13.0838C21.9702 13.7157 22.0566 14.0317 21.9594 14.3228C21.8621 14.6139 21.6031 14.815 21.0851 15.2172L13.2468 21.3025C12.6478 21.7675 12.3484 22 12 22C11.6516 22 11.3522 21.7675 10.7532 21.3025L2.91487 15.2172C2.39687 14.815 2.13787 14.6139 2.04065 14.3228C1.94343 14.0317 2.02976 13.7157 2.20243 13.0838L5.23081 2L8.08792 8.65441C8.34375 9.25025 8.47166 9.54818 8.72598 9.71557C8.98031 9.88296 9.30503 9.88296 9.95448 9.88296H14.0455C14.695 9.88296 15.0197 9.88296 15.274 9.71557C15.5283 9.54818 15.6563 9.25025 15.9121 8.65441L18.7692 2L21.7976 13.0838Z" fill-rule="evenodd" clip-rule="evenodd"/>',
    trello: '<path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z"/><path d="M6 8C6 7.05719 6 6.58579 6.29289 6.29289C6.58579 6 7.05719 6 8 6H8.5C9.44281 6 9.91421 6 10.2071 6.29289C10.5 6.58579 10.5 7.05719 10.5 8V15C10.5 15.9428 10.5 16.4142 10.2071 16.7071C9.91421 17 9.44281 17 8.5 17H8C7.05719 17 6.58579 17 6.29289 16.7071C6 16.4142 6 15.9428 6 15V8Z"/><path d="M13.5 8C13.5 7.05719 13.5 6.58579 13.7929 6.29289C14.0858 6 14.5572 6 15.5 6H16C16.9428 6 17.4142 6 17.7071 6.29289C18 6.58579 18 7.05719 18 8V10C18 10.9428 18 11.4142 17.7071 11.7071C17.4142 12 16.9428 12 16 12H15.5C14.5572 12 14.0858 12 13.7929 11.7071C13.5 11.4142 13.5 10.9428 13.5 10V8Z"/>',
    discord: '<path d="M15.5 17.5C16.5 19 17.3333 19.6667 18 20C19.3333 19.6667 22 18.2 22 15C22 11.8 20.6667 7.33333 20 5.5C18 4.3 15.8333 4 15 4L14.198 5.60393C13.4135 5.28708 12.4058 5.25438 12 5.27763C11.5942 5.25438 10.5865 5.28708 9.80197 5.60393L9 4C8.16667 4 6 4.3 4 5.5C3.33333 7.33333 2 11.8 2 15C2 18.2 4.66667 19.6667 6 20C6.66667 19.6667 7.5 19 8.5 17.5"/><path d="M17.3652 11.5C17.3652 12.6046 16.5817 13.5 15.6152 13.5C14.6487 13.5 13.8652 12.6046 13.8652 11.5C13.8652 10.3954 14.6487 9.5 15.6152 9.5C16.5817 9.5 17.3652 10.3954 17.3652 11.5Z"/><path d="M10 11.5C10 12.6046 9.2165 13.5 8.25 13.5C7.2835 13.5 6.5 12.6046 6.5 11.5C6.5 10.3954 7.2835 9.5 8.25 9.5C9.2165 9.5 10 10.3954 10 11.5Z"/><path d="M17.5 16.5C16.4022 17.3967 14.3502 18 12 18C9.64981 18 7.59785 17.3967 6.5 16.5"/>',
    googleDrive: '<path d="M20.0165 19.4118L21.4236 16.8293C21.811 16.1181 22.0048 15.7625 21.9999 15.3776C21.995 14.9927 21.7923 14.642 21.3869 13.9404L15.9448 4.52296C15.5155 3.78003 15.3009 3.40856 14.9431 3.20428C14.5852 3 14.1493 3 13.2773 3H10.7227C9.85074 3 9.41475 3 9.05694 3.20428C8.69913 3.40856 8.48447 3.78003 8.05515 4.52296L2.61306 13.9404C2.20767 14.642 2.00497 14.9927 2.00009 15.3776C1.99521 15.7625 2.18895 16.1181 2.57643 16.8293L3.98351 19.4118C4.40512 20.1856 4.61592 20.5725 4.97988 20.7862C5.34384 21 5.7918 21 6.68772 21H17.3123C18.2082 21 18.6562 21 19.0201 20.7862C19.3841 20.5725 19.5949 20.1856 20.0165 19.4118Z"/><path d="M9 4L16 15"/><path d="M5.5 20.5L12 9"/><path d="M21 15H9"/>',
    mail: '<path d="M2 6L8.91302 9.91697C11.4616 11.361 12.5384 11.361 15.087 9.91697L22 6"/><path d="M2.01577 13.4756C2.08114 16.5412 2.11383 18.0739 3.24496 19.2094C4.37608 20.3448 5.95033 20.3843 9.09883 20.4634C11.0393 20.5122 12.9607 20.5122 14.9012 20.4634C18.0497 20.3843 19.6239 20.3448 20.7551 19.2094C21.8862 18.0739 21.9189 16.5412 21.9842 13.4756C22.0053 12.4899 22.0053 11.5101 21.9842 10.5244C21.9189 7.45886 21.8862 5.92609 20.7551 4.79066C19.6239 3.65523 18.0497 3.61568 14.9012 3.53657C12.9607 3.48781 11.0393 3.48781 9.09882 3.53656C5.95033 3.61566 4.37608 3.65521 3.24495 4.79065C2.11382 5.92608 2.08114 7.45885 2.01576 10.5244C1.99474 11.5101 1.99475 12.4899 2.01577 13.4756Z"/>',
  };
  function dnIcon(name) {
    return `<svg class="dn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${DN_ICONS[name]}</svg>`;
  }

  // Brand marks Hugeicons free lacks (simple-icons, CC0): solid-fill logos for Linear, Jira, Excel.
  const DN_BRAND_ICONS = {
    linear: '<path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"/>',
    jira: '<path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z"/>',
    excel: '<path d="M23 1.5q.41 0 .7.3.3.29.3.7v19q0 .41-.3.7-.29.3-.7.3H7q-.41 0-.7-.3-.3-.29-.3-.7V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h5V2.5q0-.41.3-.7.29-.3.7-.3zM6 13.28l1.42 2.66h2.14l-2.38-3.87 2.34-3.8H7.46l-1.3 2.4-.05.08-.04.09-.64-1.28-.66-1.29H2.59l2.27 3.82-2.48 3.85h2.16zM14.25 21v-3H7.5v3zm0-4.5v-3.75H12v3.75zm0-5.25V7.5H12v3.75zm0-5.25V3H7.5v3zm8.25 15v-3h-6.75v3zm0-4.5v-3.75h-6.75v3.75zm0-5.25V7.5h-6.75v3.75zm0-5.25V3h-6.75v3Z"/>',
  };
  function dnBrandIcon(name) {
    return `<svg class="dn-icon dn-brand-icon" viewBox="0 0 24 24" fill="currentColor">${DN_BRAND_ICONS[name]}</svg>`;
  }

  // Redlines brand mark (Burst), from brand/logo/burst/redlines-burst.svg. Fixed brand
  // colours: on the dark dock its ink outline reads as a knockout.
  const DN_MARK = `<svg class="dn-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><path d="M22.9458 5.08569C23.8776 4.07538 25.3776 3.70134 26.7218 4.25862L33.0551 6.88095C33.501 7.06553 33.8857 7.33531 34.1994 7.66271L36.2172 9.68044C36.475 9.92953 36.6886 10.2164 36.8537 10.5281C37.1664 10.6933 37.4536 10.9082 37.7034 11.1667L39.7253 13.1886C40.0511 13.5017 40.319 13.8855 40.5029 14.3298L43.1263 20.6631C43.6836 22.0076 43.3069 23.5053 42.2961 24.437L42.3733 24.5142C43.3258 25.4499 43.6692 26.9053 43.1263 28.2149L40.5029 34.5483C40.2569 35.1424 39.8581 35.6249 39.374 35.9779L41.055 38.1697L41.1528 38.3036C42.1179 39.7037 41.8266 41.6301 40.4596 42.679L40.4607 42.68L39.6078 43.3351C38.195 44.42 36.1773 44.1456 35.0986 42.7428L35.0965 42.7408L33.4506 40.5964L33.1293 40.7292C32.5207 41.3302 31.7321 41.6244 30.9416 41.6346L28.8312 42.5101C27.5215 43.053 26.0662 42.7095 25.1304 41.7571L25.0532 41.6799C24.1215 42.6907 22.6238 43.0674 21.2793 42.5101L14.946 39.8867C14.5017 39.7028 14.1179 39.4349 13.8048 39.1091L11.7829 37.0872C11.5244 36.8374 11.3095 36.5502 11.1443 36.2375C10.8326 36.0724 10.5457 35.8588 10.2966 35.6009L8.27892 33.5832C7.95152 33.2695 7.68174 32.8848 7.49716 32.4389L4.87483 26.1055C4.31756 24.7613 4.69159 23.2614 5.7019 22.3296L5.60509 22.2328C4.66892 21.2964 4.33595 19.8536 4.87483 18.5537L7.49716 12.2204C8.05382 10.8757 9.37975 10.0815 10.754 10.1378C10.6978 8.76354 11.4919 7.43761 12.8366 6.88095L19.1699 4.25862C20.4698 3.71974 21.9126 4.05374 22.849 4.98991L22.9458 5.08569Z" fill="#0B0B0B"/><path d="M24.4544 6.97172C24.677 6.43396 25.2937 6.17874 25.8325 6.40111L32.1659 9.02551C32.7038 9.24805 32.959 9.86469 32.7365 10.4026L31.2255 14.0467L34.8716 12.5377C35.4095 12.3152 36.0262 12.5705 36.2487 13.1084L38.8731 19.4417C39.0955 19.9806 38.8403 20.5973 38.3025 20.8198L34.6584 22.3287L38.3025 23.8387C38.8403 24.0612 39.0955 24.6779 38.8731 25.2168L36.2487 31.5502C36.0262 32.0881 35.4095 32.3433 34.8716 32.1208L31.2265 30.6108L32.7365 34.2559C32.959 34.7938 32.7038 35.4105 32.1659 35.633L25.8325 38.2574C25.2937 38.4798 24.677 38.2246 24.4544 37.6868L22.9445 34.0427L21.4355 37.6868C21.213 38.2246 20.5963 38.4798 20.0574 38.2574L13.7241 35.633C13.1862 35.4105 12.9309 34.7938 13.1535 34.2559L14.6624 30.6108L11.0183 32.1208C10.4804 32.3433 9.86377 32.0881 9.64123 31.5502L7.01684 25.2168C6.79447 24.6779 7.04969 24.0612 7.58745 23.8387L11.2315 22.3287L7.58745 20.8198C7.04968 20.5973 6.79446 19.9806 7.01684 19.4417L9.64123 13.1084C9.86377 12.5705 10.4804 12.3152 11.0183 12.5377L14.6624 14.0467L13.1535 10.4026C12.9309 9.86469 13.1862 9.24805 13.7241 9.02551L20.0574 6.40111C20.5963 6.17873 21.213 6.43396 21.4355 6.97172L22.9445 10.6158L24.4544 6.97172Z" fill="white"/><path d="M13.7365 22.3293C15.3245 18.6552 18.9442 16.2772 22.9458 16.2769C26.9474 16.2767 30.5675 18.6554 32.1548 22.329C30.5668 26.0031 26.9471 28.381 22.9455 28.3813C18.9438 28.3816 15.3237 26.0029 13.7365 22.3293Z" fill="#0B0B0B"/><path d="M22.9454 18.7432C23.3282 20.7513 24.5232 21.9463 26.5313 22.3291C24.5232 22.712 23.3282 23.907 22.9454 25.9151C22.5625 23.907 21.3675 22.712 19.3594 22.3291C21.3675 21.9463 22.5625 20.7513 22.9454 18.7432Z" fill="white"/><path d="M28.132 25.8421C27.2423 25.3141 26.1751 26.1562 26.4408 27.1775L29.3484 38.3394C29.5699 39.1909 30.6801 39.341 31.1085 38.5779L32.2345 36.5714C32.4402 36.205 32.9411 36.1713 33.192 36.5063L36.761 41.2928C37.0843 41.7255 37.688 41.8081 38.1085 41.4754L39.0231 40.7531C39.4447 40.4204 39.5239 39.8004 39.2005 39.3665L35.6576 34.6149C35.401 34.2706 35.5785 33.7681 35.99 33.6751L37.4743 33.3377C38.3142 33.147 38.4872 31.9943 37.7422 31.5522L28.132 25.8421Z" style="fill: var(--dn-accent)"/></svg>`;

  // ---------- Generic dropdown action menu (Copy/Export triggers) ----------
  // The trigger whose menu is open. Every close path resets it — previously picking an
  // item left aria-expanded="true", so the next click on that trigger did nothing.
  let menuAnchor = null;
  function closeActionMenu() {
    const existing = root.querySelector('.dn-action-menu');
    if (existing) existing.remove();
    if (menuAnchor) menuAnchor.setAttribute('aria-expanded', 'false');
    menuAnchor = null;
    document.removeEventListener('click', dnMenuOutsideClick, true);
  }
  function dnMenuOutsideClick(e) {
    const menu = root.querySelector('.dn-action-menu');
    // Clicks on the trigger itself are left to its own handler (which toggles)
    if (menu && !menu.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeActionMenu();
  }
  // items: [{ icon, label, onClick, checked? }]; heading: optional non-clickable scope line
  function openActionMenu(anchorBtn, items, heading) {
    const wasOpenForThisAnchor = menuAnchor === anchorBtn;
    closeActionMenu();
    if (wasOpenForThisAnchor) return; // click on same trigger toggles closed

    const menu = document.createElement('div');
    menu.className = 'dn-action-menu';
    menu.innerHTML = (heading ? `<div class="dn-action-menu-heading">${escapeHtml(heading)}</div>` : '') + items
      .map((it, i) => `<button type="button" class="dn-action-menu-item" data-idx="${i}"${'checked' in it ? ` role="menuitemradio" aria-checked="${!!it.checked}"` : ''}>${it.icon}<span>${escapeHtml(it.label)}</span>${it.checked ? `<span class="dn-menu-check">${dnIcon('check')}</span>` : ''}</button>`)
      .join('');
    root.appendChild(menu);

    const rect = anchorBtn.getBoundingClientRect();
    const menuWidth = 200;
    let left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
    left = Math.max(12, left);
    let top = rect.bottom + 6;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.maxHeight = Math.max(120, window.innerHeight - top - 12) + 'px'; // long menus scroll at high zoom

    menu.querySelectorAll('.dn-action-menu-item').forEach((btn, i) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Actions that send data out need a real user click/keypress, not a page script's .click()
        if (items[i].userOnly && !e.isTrusted) return;
        closeActionMenu();
        anchorBtn.focus();
        items[i].onClick();
      });
    });

    menuAnchor = anchorBtn;
    anchorBtn.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.dn-action-menu-item')).focus();
    requestAnimationFrame(() => menu.classList.add('open'));
    setTimeout(() => document.addEventListener('click', dnMenuOutsideClick, true), 0);
  }

  // ---------- Tooltips ----------
  // One floating tip for every [data-tip] control: a sentence saying what the button does.
  // Lives outside the panels, so their shapes and overflow never clip it.
  const tip = document.createElement('div');
  tip.className = 'dn-tip';
  tip.setAttribute('role', 'tooltip');
  root.appendChild(tip);
  let tipFor = null;
  function hideTip() {
    tip.classList.remove('show');
    tipFor = null;
  }
  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return hideTip();
    tipFor = target;
    tip.textContent = text;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.add('show');
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8; // no room above: go below
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }
  root.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return hideTip();
    if (t !== tipFor) showTip(t);
  });
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t && e.target.matches(':focus-visible')) showTip(t);
  });
  root.addEventListener('focusout', hideTip);
  root.addEventListener('pointerdown', hideTip, true);
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });

  // ---------- Screenshot, full size ----------
  let lightboxOpener = null;
  function closeLightbox() {
    const lb = root.querySelector('.dn-lightbox');
    if (!lb) return;
    lb.remove();
    if (lightboxOpener && lightboxOpener.isConnected) lightboxOpener.focus({ preventScroll: true });
    lightboxOpener = null;
  }
  function openLightbox(a, opener) {
    closeLightbox();
    lightboxOpener = opener || null;
    const fig = document.createElement('figure');
    fig.className = 'dn-lightbox';
    fig.tabIndex = -1;
    fig.setAttribute('role', 'dialog');
    fig.setAttribute('aria-label', 'Screenshot');
    const img = document.createElement('img');
    img.alt = 'Screenshot of the annotated element';
    img.src = a.screenshot; // property, not markup: never parsed as HTML
    const cap = document.createElement('figcaption');
    cap.textContent = (a.anchor && a.anchor.describe) || a.selector || 'General note';
    fig.append(img, cap);
    fig.addEventListener('click', closeLightbox);
    root.appendChild(fig);
    fig.focus({ preventScroll: true });
  }

  // ---------- Note actions (sidebar cards and table rows share these) ----------
  function agoLabel(ts) {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
  }
  // Colour = meaning (see --dn-act-* in design-tokens.css). `table`: icon-only; `offPage`: the row is on another page.
  function actionsHtml(a, opt) {
    const { lost, table, offPage } = opt;
    const resolved = a.status === 'resolved';
    const needsPage = ['copy', 'copy-image', 'edit', 'enhance', 'repin'];
    const btn = (act, label, text, inner, cls, pressed) =>
      `<button type="button" class="dn-act${cls || ''}" data-act="${act}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`} aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(text)}"${offPage && needsPage.includes(act) ? ' disabled' : ''}>${inner}</button>`;
    const labelled = !table && !lost;
    const agentIcon = agentIconHtml(a.assignee || { id: 'agent' });
    return [
      btn('resolve', resolved ? 'Reopen' : 'Mark resolved',
        resolved ? 'Reopen: move it back to Open' : 'Mark as resolved: moves it to Done',
        dnIcon('check') + (labelled ? (resolved ? 'Reopen' : 'Resolve') : ''), labelled ? ' dn-act-label' : '', resolved),
      lost && !resolved ? btn('repin', 'Re-pin', 'Re-pin: click the element this note belongs to',
        dnIcon('target') + (table ? '' : 'Re-pin'), table ? '' : ' dn-act-label') : '',
      '<span class="dn-act-sep" aria-hidden="true"></span>',
      btn('copy', 'Copy', `Copy this note as ${findFormat(copyFormat).label}`, dnIcon('copy')),
      a.screenshot ? btn('copy-image', 'Copy image', 'Copy the screenshot as an image', dnIcon('image')) : '',
      btn('edit', 'Edit', 'Edit the note text', dnIcon('edit')),
      btn('enhance', 'Enhance', 'Rewrite this note as an AI prompt with your AI provider (asks first)', dnIcon('sparkles')),
      btn('agent', a.assignee ? `Sent to ${a.assignee.name}` : 'Send to an AI agent',
        a.assignee ? `Sent to ${a.assignee.name}. Click to take it back.` : 'Send to an AI agent so it can pick this up', agentIcon, '', !!a.assignee),
      btn('delete', 'Delete', 'Delete this note. You can undo right after.', dnIcon('trash')),
    ].join('');
  }
  function noteAction(act, a, btn, e) {
    switch (act) {
      case 'resolve': toggleResolved(a); break;
      case 'repin': startRepin(a); break;
      case 'copy': copyAnnotation(a); break;
      case 'copy-image': copyAnnotationWithImage(a); break;
      case 'edit': editAnnotation(a); break;
      case 'enhance': if (e && e.isTrusted) enhanceAnnotation(a); break; // sends data out: real user input only
      case 'agent': sendToAgent(a, btn); break;
      case 'delete': deleteAnnotation(a); break;
      case 'peek': openLightbox(a, btn); break;
    }
  }
  // Toggle the note's AI agent. One connected agent: assign directly; several: pick from a menu.
  function sendToAgent(a, btn) {
    const assign = (ag) => updateAnnotation(a, (t) => { if (ag) t.assignee = { id: ag.id, name: ag.name }; else delete t.assignee; },
      () => toast(ag ? `Sent to ${ag.name}` : `Took the note back from ${a.assignee ? a.assignee.name : 'the agent'}`));
    if (a.assignee) return assign(null);
    getAgents((agents) => {
      if (!agents.length) return toast('No AI agent is connected. Connect one in Settings → Connect to AI agents.');
      if (agents.length === 1) return assign(agents[0]);
      openActionMenu(btn, agents.map((ag) => ({ icon: agentIconHtml(ag), label: ag.name, onClick: () => assign(ag) })), 'Send to');
    });
  }

  // ---------- Floating dock (Inspect + Notes + Table + Settings) ----------
  const MARK_TITLE = 'Inspect Mode: click an element to annotate it (Alt+Shift+M)';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionReduced = () => reducedMotion.matches || root.dataset.dnMotion === 'reduce'; // OS or Settings → Motion
  const scrollBehavior = () => (motionReduced() ? 'auto' : 'smooth');
  const pill = document.createElement('div');
  pill.id = 'designnote-pill';
  pill.dataset.orientation = 'horizontal';
  pill.dataset.dock = 'bottom';
  pill.innerHTML = `
    <button class="dn-drag-handle" aria-label="Drag to move the dock (or Enter, then arrow keys)" data-tip="Drag to move" tabindex="0" draggable="false">${DN_MARK}</button>
    <button id="designnote-mode-btn" class="dn-pill-btn" title="${MARK_TITLE}" aria-pressed="false">${dnIcon('pointer')}<span class="dn-pill-label">Inspect</span></button>
    <button id="designnote-toggle-btn" class="dn-pill-btn" title="Annotations sidebar (Alt+Shift+D)" aria-label="Annotations sidebar" aria-expanded="false">
      ${dnIcon('message')}
      <span id="designnote-badge" class="dn-badge" hidden>0</span>
    </button>
    <button id="dn-pill-table-btn" class="dn-pill-btn" title="Table view" aria-label="Table view" aria-expanded="false">${dnIcon('table')}</button>
    <button class="dn-close-pill" aria-label="Hide floating dock" title="Hide dock" tabindex="0">${dnIcon('x')}</button>
  `;
  root.appendChild(pill);

  const modeBtn = pill.querySelector('#designnote-mode-btn');
  const toggleBtn = pill.querySelector('#designnote-toggle-btn');
  const pillTableBtn = pill.querySelector('#dn-pill-table-btn');
  pillTableBtn.addEventListener('click', () => {
    tableOverlay.classList.contains('open') ? hideTableView() : showTableView();
  });
  const badgeEl = pill.querySelector('#designnote-badge');
  const dragHandle = pill.querySelector('.dn-drag-handle');
  const closePillBtn = pill.querySelector('.dn-close-pill');

  function updateBadge(list) {
    const n = list.length;
    badgeEl.textContent = n > 99 ? '99+' : String(n);
    badgeEl.hidden = n === 0;
  }

  // Sidebar and table view are mutually exclusive full panels — opening one closes the other.
  function showSidebar() {
    placeRoot();
    tableOverlay.classList.remove('open');
    sidebarOpen = true;
    sidebar.classList.add('open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    renderSidebar();
  }
  function hideSidebar() {
    sidebarOpen = false;
    sidebar.classList.remove('open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    renderPins([]);
  }
  let tableFromDock = false; // focus goes back to whichever control opened it
  function showTableView() {
    tableFromDock = document.activeElement === pillTableBtn;
    hideSidebar();
    tableOverlay.classList.add('open');
    pillTableBtn.setAttribute('aria-expanded', 'true');
    tableOverlay.querySelector('#dn-table-search').focus();
    renderTableView();
  }
  function hideTableView() {
    tableOverlay.classList.remove('open');
    pillTableBtn.setAttribute('aria-expanded', 'false');
    (tableFromDock ? pillTableBtn : toggleBtn).focus();
  }

  toggleBtn.addEventListener('click', () => {
    sidebarOpen ? hideSidebar() : showSidebar();
  });

  modeBtn.addEventListener('click', () => {
    annotateMode ? exitMarkMode() : enterMarkMode();
  });

  // ---------- Pill drag & close handlers ----------
  let dragState = { active: false, startX: 0, startY: 0, startLeft: 0, startTop: 0 };
  let keyboardDrag = { active: false, startLeft: 0, startTop: 0 };

  function updatePillPosition(left, top) {
    const maxX = window.innerWidth - pill.offsetWidth - 8;
    const maxY = window.innerHeight - pill.offsetHeight - 8;
    const newLeft = Math.max(8, Math.min(maxX, left));
    const newTop = Math.max(8, Math.min(maxY, top));
    pill.style.left = newLeft + 'px';
    pill.style.top = newTop + 'px';
    pill.style.right = 'auto';
    pill.style.bottom = 'auto';
    pill.style.transform = 'none';
  }

  // Mouse drag
  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragState = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pill.offsetLeft,
      startTop: pill.offsetTop
    };
    pill.classList.add('dragging');
    dragHandle.classList.add('dragging');
    dragHandle.setAttribute('aria-grabbed', 'true');
    document.body.style.userSelect = 'none';
  });

  dragHandle.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !keyboardDrag.active) {
      e.preventDefault();
      e.stopPropagation(); // else the document listener below sees this same Enter and ends the drag at once
      keyboardDrag = {
        active: true,
        startLeft: pill.offsetLeft,
        startTop: pill.offsetTop
      };
      pill.classList.add('dragging', 'keyboard-drag');
      dragHandle.classList.add('dragging');
      dragHandle.setAttribute('aria-grabbed', 'true');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState.active) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    updatePillPosition(dragState.startLeft + dx, dragState.startTop + dy);
  });

  document.addEventListener('keydown', (e) => {
    if (!keyboardDrag.active) return;
    const step = e.shiftKey ? 50 : 10;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      keyboardDrag.active = false;
      pill.classList.remove('dragging', 'keyboard-drag');
      dragHandle.classList.remove('dragging');
      dragHandle.setAttribute('aria-grabbed', 'false');
      snapToNearestEdge();
      savePillState();
      return;
    } else if (e.key === 'Escape') {
      keyboardDrag.active = false;
      pill.classList.remove('dragging', 'keyboard-drag');
      dragHandle.classList.remove('dragging');
      dragHandle.setAttribute('aria-grabbed', 'false');
      updatePillPosition(keyboardDrag.startLeft, keyboardDrag.startTop);
      return;
    } else {
      return;
    }
    e.preventDefault();
    updatePillPosition(keyboardDrag.startLeft + dx, keyboardDrag.startTop + dy);
  });

  document.addEventListener('mouseup', () => {
    if (!dragState.active) return;
    dragState.active = false;
    pill.classList.remove('dragging');
    dragHandle.classList.remove('dragging');
    dragHandle.setAttribute('aria-grabbed', 'false');
    document.body.style.userSelect = '';
    snapToNearestEdge();
    savePillState();
  });

  // Close button
  closePillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pillState.closed = true;
    pill.hidden = true;
    savePillState();
    toast('Dock hidden. Press Alt+Shift+H, or use the toolbar icon → Open sidebar, to bring it back.');
  });

  // Also hide close button on Escape
  closePillBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePillBtn.blur();
    }
  });

  // ---------- Sidebar ----------
  const sidebar = document.createElement('div');
  sidebar.id = 'designnote-sidebar';
  sidebar.innerHTML = `
    <div id="designnote-sidebar-header">
      <div>
        <h2>Annotations</h2>
        <div class="dn-header-count" id="dn-header-count">0 annotations on this page</div>
      </div>
      <div class="dn-rail-count" id="dn-rail-count">0</div>
      <div class="actions">
        <button id="dn-compact-btn" class="dn-icon-btn" title="Compact view (collapse to a rail)" aria-pressed="false">${dnIcon('rail')}</button>
        <button id="dn-table-btn" class="dn-icon-btn" title="View as table">${dnIcon('table')}</button>
        <button id="dn-copy-format-btn" class="dn-menu-trigger dn-menu-trigger-compact" title="Copy button format: JSON" aria-haspopup="true" aria-expanded="false">${dnIcon('copy')}<span class="dn-copy-format-label">JSON</span>${dnIcon('chevronDown')}</button>
        <button id="dn-export-menu-btn" class="dn-menu-trigger" title="Export" aria-haspopup="true" aria-expanded="false">${dnIcon('download')}<span>Export</span>${dnIcon('chevronDown')}</button>
        <button id="dn-add-note-btn" class="dn-icon-btn" title="Add a general note without a specific location">${dnIcon('plus')}</button>
        <button id="dn-close-btn" class="dn-icon-btn" title="Close">${dnIcon('x')}</button>
      </div>
    </div>
    <div id="dn-filters" class="dn-filters" role="group" aria-label="Show notes" hidden></div>
    <div id="designnote-list"></div>
  `;
  root.appendChild(sidebar);

  // Compact = 56px rail of numbered dots that expands on hover; remembered across pages.
  const compactBtn = sidebar.querySelector('#dn-compact-btn');
  function setCompact(on) {
    sidebar.classList.toggle('dn-compact', on);
    compactBtn.setAttribute('aria-pressed', String(on));
    compactBtn.title = on ? 'Expand to full sidebar' : 'Compact view (collapse to a rail)';
  }
  chrome.storage.local.get(['dn_sidebar_compact'], (res) => setCompact(res.dn_sidebar_compact !== false));
  chrome.storage.onChanged.addListener((changes, area) => { // Settings → Sidebar
    if (area === 'local' && changes.dn_sidebar_compact) setCompact(changes.dn_sidebar_compact.newValue !== false);
  });
  compactBtn.addEventListener('click', () => {
    const on = !sidebar.classList.contains('dn-compact');
    setCompact(on);
    chrome.storage.local.set({ dn_sidebar_compact: on });
  });

  // ---------- Page pins (numbered markers on annotated elements, shown while the sidebar is open) ----------
  const pinLayer = document.createElement('div');
  pinLayer.id = 'dn-pins';
  root.appendChild(pinLayer);
  let pinTargets = []; // [{ pin, el }]
  let pinRAF = 0;
  let pendingFlashId = null;

  function positionPins() {
    pinRAF = 0;
    // Read every rect first, then write: interleaving forces a layout per pin.
    const vh = window.innerHeight;
    const rects = pinTargets.map(({ el }) => (el.isConnected ? el.getBoundingClientRect() : null));
    pinTargets.forEach(({ pin }, i) => {
      const r = rects[i];
      const visible = r && (r.width || r.height) && r.bottom > 0 && r.top < vh;
      pin.hidden = !visible;
      if (visible) pin.style.transform = `translate(${Math.max(4, r.left)}px, ${Math.max(4, r.top - 26)}px)`;
    });
  }
  function schedulePins() {
    if (!pinRAF && pinTargets.length) pinRAF = requestAnimationFrame(positionPins);
  }
  window.addEventListener('scroll', schedulePins, { passive: true, capture: true });
  window.addEventListener('resize', schedulePins, { passive: true });

  // Returns the ids of notes whose element can't be found any more (cards offer Re-pin).
  function renderPins(list) {
    pinLayer.innerHTML = '';
    pinTargets = [];
    const lost = new Set();
    if (!sidebarOpen) return lost;
    list.forEach((a, i) => {
      const { el } = findAnnotationEl(a);
      if (!el) {
        if (a.selector) lost.add(a.id);
        return;
      }
      const pin = document.createElement('button');
      pin.className = 'dn-pin';
      pin.style.setProperty('--type-color', getTypeColor(a.type));
      pin.textContent = String(i + 1);
      pin.title = `${i + 1}. ${a.text || ''}`.slice(0, 140);
      pin.setAttribute('aria-label', `Annotation ${i + 1}: ${a.text || ''}`.slice(0, 140));
      pin.addEventListener('click', (e) => { e.stopPropagation(); jumpToAnnotation(a); });
      pinLayer.appendChild(pin);
      pinTargets.push({ pin, el });
    });
    positionPins();
    return lost;
  }

  sidebar.querySelector('#dn-close-btn').addEventListener('click', () => { hideSidebar(); toggleBtn.focus(); });
  sidebar.querySelector('#dn-add-note-btn').addEventListener('click', () => {
    openForm(null, { x: window.scrollX + 100, y: window.scrollY + 100 });
  });
  sidebar.querySelector('#dn-table-btn').addEventListener('click', () => {
    showTableView();
  });
  sidebar.querySelector('#dn-export-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openActionMenu(e.currentTarget, exportMenuItems('current'), 'This page');
  });
  sidebar.querySelector('#dn-copy-format-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openActionMenu(e.currentTarget, copyFormatOptions().map((f) => ({
      icon: f.icon(), label: f.label, checked: f.id === copyFormat, onClick: () => setCopyFormat(f.id),
    })), 'Copy button format');
  });

  // ---------- Table view overlay ----------
  let tableViewMode = 'current'; // 'current' | 'all'
  let tableSearchQuery = '';
  let tableTypeFilter = 'all'; // 'all' | 'bug' | 'suggestion' | 'text' | 'note'

  const tableOverlay = document.createElement('div');
  tableOverlay.id = 'designnote-table-overlay';
  tableOverlay.innerHTML = `
    <div id="designnote-table-header">
      <div id="designnote-table-header-top">
        <h2>Annotations · table</h2>
        <div class="dn-header-actions">
          <div class="dn-view-toggle" id="dn-view-toggle" role="group" aria-label="Annotation view">
            <button class="dn-view-btn active" data-mode="current" aria-pressed="true" title="Show annotations on this page only">
              ${dnIcon('fileText')} <span>This page</span>
            </button>
            <button class="dn-view-btn" data-mode="all" aria-pressed="false" title="Show all annotations across all pages, grouped by domain">
              ${dnIcon('globe')} <span>All pages</span>
            </button>
          </div>
          <span class="dn-header-sep"></span>
          <button id="dn-copy-menu-btn" class="dn-menu-trigger" title="Copy as" aria-haspopup="true" aria-expanded="false">${dnIcon('copy')}<span>Copy as</span>${dnIcon('chevronDown')}</button>
          <button id="dn-export-menu-btn-table" class="dn-menu-trigger" title="Export" aria-haspopup="true" aria-expanded="false">${dnIcon('download')}<span>Export</span>${dnIcon('chevronDown')}</button>
          <span class="dn-header-sep"></span>
          <button id="dn-table-close-btn" class="dn-icon-btn" title="Close">${dnIcon('x')}</button>
        </div>
      </div>
      <div id="designnote-table-header-bottom">
        <div class="dn-search-box">
          ${dnIcon('search')}
          <input type="search" id="dn-table-search" aria-label="Search annotations" placeholder="Search notes, selectors, pages…" />
        </div>
        <div class="dn-filter-chips" id="dn-filter-chips" role="group" aria-label="Filter by category"></div>
      </div>
    </div>
    <div id="designnote-table-body"></div>
  `;
  root.appendChild(tableOverlay);

  tableOverlay.querySelector('#dn-table-close-btn').addEventListener('click', hideTableView);

  // Escape closes the innermost open layer while focus is in DesignNote's UI (the forms and
  // Mark mode handle their own Escape). Scoped to our UI so the host page's Escape still works.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || keyboardDrag.active || root.querySelector('#designnote-popup-form, #designnote-edit-form')) return;
    if (root.querySelector('.dn-lightbox')) { closeLightbox(); e.stopPropagation(); return; }
    if (menuAnchor) { const a = menuAnchor; closeActionMenu(); a.focus(); }
    else if (tableOverlay.classList.contains('open')) hideTableView();
    else if (sidebarOpen) { hideSidebar(); toggleBtn.focus(); }
    else return;
    e.stopPropagation();
  });
  tableOverlay.querySelector('#dn-copy-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const scope = tableViewMode;
    // Picking a format copies every note in it and makes it the per-note copy format too.
    openActionMenu(e.currentTarget, [
      ...copyFormatOptions().map((f) => ({
        icon: f.icon(), label: f.label, checked: f.id === copyFormat, onClick: () => { setCopyFormat(f.id); copyAllAs(f.id, scope); },
      })),
      { icon: dnIcon('plus'), label: 'Add apps…', onClick: () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS', hash: 'share-apps' }) },
    ], tableScopeHeading());
  });
  tableOverlay.querySelector('#dn-export-menu-btn-table').addEventListener('click', (e) => {
    e.stopPropagation();
    const scope = tableViewMode;
    openActionMenu(e.currentTarget, exportMenuItems(scope), tableScopeHeading());
  });
  tableOverlay.querySelectorAll('#dn-view-toggle .dn-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      tableViewMode = btn.dataset.mode;
      tableOverlay.querySelectorAll('#dn-view-toggle .dn-view-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderTableView();
    });
  });
  
  // Search input handler
  const searchInput = tableOverlay.querySelector('#dn-table-search');
  let searchDebounce = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      tableSearchQuery = e.target.value.toLowerCase().trim();
      renderTableView();
    }, 150);
  });
  
  // Filter chips: All + your categories + any other type in the loaded notes (keys are lowercase)
  const filterChipsEl = tableOverlay.querySelector('#dn-filter-chips');
  function renderFilterChips(list) {
    const cats = new Map(categoryList.map((c) => [c.toLowerCase(), c]));
    list.forEach((a) => { const k = (a.type || '').toLowerCase(); if (k && !cats.has(k)) cats.set(k, a.type); });
    if (!cats.has(tableTypeFilter)) tableTypeFilter = 'all';
    filterChipsEl.innerHTML = [['all', 'All'], ...[...cats].map(([k, c]) => [k, typeLabel(c)])].map(([k, label]) => {
      const dot = k === 'all' ? '' : ` style="--type-color:${getTypeColor(k === label.toLowerCase() ? label : k)}"`;
      return `<button class="dn-filter-chip" data-type="${escapeHtml(k)}" aria-pressed="${k === tableTypeFilter}"${dot}>${escapeHtml(label)}</button>`;
    }).join('');
  }
  filterChipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.dn-filter-chip');
    if (!chip) return;
    tableTypeFilter = chip.dataset.type;
    renderTableView();
  });
  
  function renderTableView() {
    const loader = tableViewMode === 'all' ? loadAllAnnotations : loadAnnotations;
    loader((list) => {
      renderFilterChips(list);
      // Apply search filter
      let filtered = list;
      if (tableSearchQuery) {
        const q = tableSearchQuery;
        filtered = filtered.filter(a => 
          (a.text && a.text.toLowerCase().includes(q)) ||
          (a.selector && a.selector.toLowerCase().includes(q)) ||
          (a.pageUrl && a.pageUrl.toLowerCase().includes(q)) ||
          typeLabel(a.type).toLowerCase().includes(q)
        );
      }
      // Apply type filter
      if (tableTypeFilter !== 'all') {
        filtered = filtered.filter(a => (a.type || '').toLowerCase() === tableTypeFilter);
      }
      
      const body = tableOverlay.querySelector('#designnote-table-body');
      body.innerHTML = renderAnnotationsTable(filtered, { interactive: true, showPage: tableViewMode === 'all' });
      
      // Update button counts
      const currentCount = annotations.length;
      const allCount = tableViewMode === 'all' ? list.length : '...';
      const currentBtn = tableOverlay.querySelector('#dn-view-toggle [data-mode="current"]');
      const allBtn = tableOverlay.querySelector('#dn-view-toggle [data-mode="all"]');
      if (currentBtn) currentBtn.querySelector('span').textContent = `This page (${currentCount})`;
      if (allBtn && tableViewMode === 'all') allBtn.querySelector('span').textContent = `All pages (${allCount})`;
      
      // Update search input value (preserve during re-render)
      const searchInput = tableOverlay.querySelector('#dn-table-search');
      if (searchInput && searchInput.value !== tableSearchQuery) {
        searchInput.value = tableSearchQuery;
      }
      
      const byId = new Map();
      for (const x of filtered) if (!byId.has(x.id)) byId.set(x.id, x); // first match, like .find()
      body.querySelectorAll('tr[data-id]').forEach((row) => {
        const a = byId.get(row.dataset.id);
        if (!a) return;
        const isCurrentPage = !a.pageUrl || a.pageUrl === location.href.split('#')[0];
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-act]')) return;
          if (isCurrentPage) {
            jumpToAnnotation(a);
          }
        });
        row.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', (e) => {
          e.stopPropagation();
          noteAction(btn.dataset.act, a, btn, e);
        }));
        // Disable jump for other pages
        if (!isCurrentPage) {
          row.style.cursor = 'default';
          row.title = 'Annotation on another page';
        }
      });
      // Initialize column resizing after table is rendered
      initColumnResizing(body.querySelector('.dn-table'));
    });
  }

  // ---------- Column resizing ----------
  // Widths per table mode live in extension storage, never in the host page's localStorage
  // (which the site can read). Old builds wrote dn-col-widths-* there; remove those leftovers.
  let colWidths = {};
  chrome.storage.local.get('dn_col_widths', (res) => { colWidths = res.dn_col_widths || {}; });
  const saveColWidths = () => chrome.storage.local.set({ dn_col_widths: colWidths });
  try { ['current', 'all'].forEach((m) => localStorage.removeItem('dn-col-widths-' + m)); } catch (e) { /* storage blocked */ }

  function initColumnResizing(table) {
    if (!table) return;
    const ths = table.querySelectorAll('th');
    ths.forEach((th, index) => {
      const resizer = th.querySelector('.dn-col-resizer');
      if (!resizer) return;
      
      let startX, startWidth;
      
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.pageX;
        startWidth = th.offsetWidth;
        resizer.classList.add('dragging');
        table.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        const onMouseMove = (e) => {
          const diff = e.pageX - startX;
          const newWidth = Math.max(40, Math.min(600, startWidth + diff));
          th.style.width = newWidth + 'px';
          th.style.minWidth = newWidth + 'px';
          th.style.maxWidth = newWidth + 'px';
          // Apply to corresponding td columns as well
          const colIndex = index + 1;
          table.querySelectorAll(`tbody td:nth-child(${colIndex})`).forEach(td => {
            td.style.width = newWidth + 'px';
            td.style.minWidth = newWidth + 'px';
            td.style.maxWidth = newWidth + 'px';
            td.style.overflow = 'hidden';
            td.style.textOverflow = 'ellipsis';
          });
        };
        
        const onMouseUp = () => {
          resizer.classList.remove('dragging');
          table.classList.remove('resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          colWidths[tableViewMode] = Array.from(ths).map(t => t.style.width || '');
          saveColWidths();
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      
      // Double-click to auto-fit column to content
      resizer.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        th.style.width = '';
        th.style.minWidth = '';
        th.style.maxWidth = '';
        const colIndex = index + 1;
        table.querySelectorAll(`tbody td:nth-child(${colIndex})`).forEach(td => {
          td.style.width = '';
          td.style.minWidth = '';
          td.style.maxWidth = '';
        });
        delete colWidths[tableViewMode];
        saveColWidths();
        toast('Column width reset');
      });
    });
    
    // Restore saved widths if available
    {
      const widths = colWidths[tableViewMode];
      if (widths) {
        widths.forEach((w, i) => {
          if (w && ths[i]) {
            ths[i].style.width = w;
            ths[i].style.minWidth = w;
            ths[i].style.maxWidth = w;
            const colIndex = i + 1;
            table.querySelectorAll(`tbody td:nth-child(${colIndex})`).forEach(td => {
              td.style.width = w;
              td.style.minWidth = w;
              td.style.maxWidth = w;
            });
          }
        });
      }
    }
  }

  // ---------- Export scope ----------
  // Every exporter takes its scope explicitly: the sidebar always passes 'current'; the
  // table passes its visible This page / All pages toggle. (Reading the toggle inside the
  // exporters let a stale table setting silently change what the sidebar exported.)
  const currentUrl = () => location.href.split('#')[0];
  const pageOf = (a) => a.pageUrl || currentUrl();
  function loadForScope(scope, cb) { (scope === 'all' ? loadAllAnnotations : loadAnnotations)(cb); }
  function scopeSlug(scope) { return scope === 'all' ? 'all-pages' : 'current-page'; }
  function scopeSource(scope) { return scope === 'all' ? 'All pages' : currentUrl(); }
  function emptyScopeMsg(scope) { return scope === 'all' ? 'No annotations across all pages.' : 'No annotations to export on this page.'; }
  function tableScopeHeading() {
    const filtered = tableSearchQuery || tableTypeFilter !== 'all';
    return (tableViewMode === 'all' ? 'All pages' : 'This page') + (filtered ? ' · search/filter not applied' : '');
  }

  function exportAnnotationsHtml(scope) {
    loadForScope(scope, (list) => {
      const tableHtml = renderAnnotationsTable(list, { interactive: false, showPage: scope === 'all' });
      const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Redlines export — ${escapeHtml(location.hostname)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #37352f; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #5f5e5b; font-size: 13px; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  th, td { border-bottom: 1px solid #e9e9e7; padding: 8px 10px; text-align: left; vertical-align: top; }
  th:nth-child(1), td:nth-child(1) { width: 32px; }
  th:nth-child(2), td:nth-child(2) { width: 100px; }
  th:nth-child(3), td:nth-child(3) { width: 110px; }
  th:nth-child(5), td:nth-child(5) { width: 200px; }
  th:nth-child(6), td:nth-child(6) { width: 140px; }
  td.dn-table-note { white-space: pre-wrap; word-break: break-word; }
  img { max-width: 96px; max-height: 72px; display: block; border-radius: 6px; }
  code { font-size: 12px; word-break: break-all; }
  .dn-type { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; }
  .dn-type-bug { background: #ffe2dd; color: #a8443d; }
  .dn-type-suggestion { background: #d3e5ef; color: #0a6690; }
  .dn-type-text { background: #eae4f2; color: #6940a5; }
  .dn-type-note { background: #fbecdd; color: #8a5c12; }
</style>
</head>
<body>
  <h1>Redlines export</h1>
  <p class="sub">${escapeHtml(scopeSource(scope))} — exported ${new Date().toLocaleString()}</p>
  ${tableHtml}
</body>
</html>`;

      const blob = new Blob([doc], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const hostSlug = location.hostname.replace(/[^a-z0-9.-]/gi, '-');
      const dateSlug = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `redlines-${hostSlug}-${scopeSlug(scope)}-${dateSlug}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Exported ' + list.length + (list.length === 1 ? ' annotation' : ' annotations'));
    });
  }

  // ---------- CSV Export ----------
  // RFC 4180 quoting for every cell, plus a leading ' on values a spreadsheet would
  // run as a formula (=, +, -, @, tab, CR) — user notes and custom categories are free text.
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportAnnotationsCsv(scope) {
    loadForScope(scope, (list) => {
      if (!list.length) {
        toast(emptyScopeMsg(scope));
        return;
      }
      const rows = [
        ['#', 'Type', 'Note', 'Selector', 'Page', 'Marked At', 'Has Screenshot']
      ];
      list.slice().reverse().forEach((a, i) => {
        rows.push([
          String(i + 1),
          typeLabel(a.type),
          a.text || '',
          a.selector || 'No location',
          pageOf(a),
          new Date(a.timestamp).toISOString(),
          a.screenshot ? 'Yes' : 'No'
        ]);
      });
      const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const hostSlug = location.hostname.replace(/[^a-z0-9.-]/gi, '-');
      const dateSlug = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `redlines-${hostSlug}-${scopeSlug(scope)}-${dateSlug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${list.length} annotation${list.length === 1 ? '' : 's'} as CSV`);
    });
  }

  // ---------- PDF Export ----------
  function exportAnnotationsPdf(scope) {
    loadForScope(scope, (list) => {
      if (!list.length) {
        toast(emptyScopeMsg(scope));
        return;
      }
      const tableHtml = renderAnnotationsTable(list, { interactive: false, showPage: scope === 'all' });
      const hostSlug = location.hostname.replace(/[^a-z0-9.-]/gi, '-');
      const dateSlug = new Date().toISOString().slice(0, 10);
      const title = `Redlines Export — ${scopeSlug(scope)}`;
      
      const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 20mm; size: A4; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; color: #1a1a1a; line-height: 1.5; }
  .header { text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e0e0e0; }
  .header h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #1a1a1a; }
  .header .meta { color: #666; font-size: 13px; }
  .stats { display: flex; justify-content: center; gap: 24px; margin-top: 12px; font-size: 12px; color: #666; }
  .stat { display: flex; align-items: center; gap: 6px; }
  .stat-dot { width: 8px; height: 8px; border-radius: 50%; }
  .stat-dot.bug { background: #a8443d; }
  .stat-dot.suggestion { background: #0a6690; }
  .stat-dot.text { background: #6940a5; }
  .stat-dot.note { background: #8a5c12; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; page-break-inside: auto; }
  thead { display: table-header-group; }
  th, td { border-bottom: 1px solid #e9e9e7; padding: 8px 10px; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #f8f8f8; font-weight: 600; color: #333; position: sticky; top: 0; }
  th:nth-child(1), td:nth-child(1) { width: 40px; }
  th:nth-child(2), td:nth-child(2) { width: 100px; }
  th:nth-child(3), td:nth-child(3) { width: 100px; }
  th:nth-child(4), td:nth-child(4) { width: 40%; }
  th:nth-child(5), td:nth-child(5) { width: 18%; }
  th:nth-child(6), td:nth-child(6) { width: 12%; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .dn-table-note { white-space: pre-wrap; word-break: break-word; }
  img { max-width: 80px; max-height: 60px; display: block; border-radius: 4px; border: 1px solid #eee; }
  code { font-size: 10px; word-break: break-all; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
  .dn-type { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; }
  .dn-type-bug { background: #ffe2dd; color: #a8443d; }
  .dn-type-suggestion { background: #d3e5ef; color: #0a6690; }
  .dn-type-text { background: #eae4f2; color: #6940a5; }
  .dn-type-note { background: #fbecdd; color: #8a5c12; }
  .dn-domain-header td { background: #f0f0f0; font-weight: 600; font-size: 11px; padding: 10px; }
  @media print {
    .no-print { display: none !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      ${escapeHtml(scopeSource(scope))} — Exported ${new Date().toLocaleString()}
    </div>
    <div class="stats">
      ${(() => {
        const counts = { bug: 0, suggestion: 0, text: 0, note: 0 };
        list.forEach(a => counts[a.type]++);
        return Object.entries(counts).filter(([,v]) => v > 0).map(([t,v]) => 
          `<span class="stat"><span class="stat-dot ${t}"></span>${typeLabel(t)}: ${v}</span>`
        ).join('');
      })()}
    </div>
  </div>
  ${tableHtml}
  <script>
    window.onload = () => {
      setTimeout(() => window.print(), 500);
    };
  </script>
</body>
</html>`;

      const blob = new Blob([doc], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `redlines-${hostSlug}-${scopeSlug(scope)}-${dateSlug}-print.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Downloaded a print-ready page. Open it and choose "Save as PDF".');
    });
  }

  // ---------- ZIP Bundle Export ----------
  function exportAnnotationsZip(scope) {
    loadForScope(scope, async (list) => {
      if (!list.length) {
        toast(emptyScopeMsg(scope));
        return;
      }
      toast('Building ZIP bundle…');

      const hostSlug = location.hostname.replace(/[^a-z0-9.-]/gi, '-');
      const dateSlug = new Date().toISOString().slice(0, 10);

      // Build annotations.json
      const jsonData = {
        scope: scopeSlug(scope),
        page: scopeSource(scope),
        exportedAt: new Date().toISOString(),
        count: list.length,
        annotations: list.map((a, i) => ({
          index: i + 1,
          type: a.type,
          typeLabel: typeLabel(a.type),
          note: a.text,
          selector: a.selector || null,
          pageUrl: pageOf(a),
          markedAt: new Date(a.timestamp).toISOString(),
          hasScreenshot: !!a.screenshot,
        })),
      };

      // Build report.html (same as HTML export but with all images embedded)
      const tableHtml = renderAnnotationsTable(list, { interactive: false, showPage: scope === 'all' });
      const reportHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Redlines export — ${escapeHtml(location.hostname)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #37352f; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #5f5e5b; font-size: 13px; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  th, td { border-bottom: 1px solid #e9e9e7; padding: 8px 10px; text-align: left; vertical-align: top; }
  th:nth-child(1), td:nth-child(1) { width: 32px; }
  th:nth-child(2), td:nth-child(2) { width: 100px; }
  th:nth-child(3), td:nth-child(3) { width: 110px; }
  th:nth-child(5), td:nth-child(5) { width: 200px; }
  th:nth-child(6), td:nth-child(6) { width: 140px; }
  td.dn-table-note { white-space: pre-wrap; word-break: break-word; }
  img { max-width: 96px; max-height: 72px; display: block; border-radius: 6px; }
  code { font-size: 12px; word-break: break-all; }
  .dn-type { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; }
  .dn-type-bug { background: #ffe2dd; color: #a8443d; }
  .dn-type-suggestion { background: #d3e5ef; color: #0a6690; }
  .dn-type-text { background: #eae4f2; color: #6940a5; }
  .dn-type-note { background: #fbecdd; color: #8a5c12; }
</style>
</head>
<body>
  <h1>Redlines export</h1>
  <p class="sub">${escapeHtml(scopeSource(scope))} — exported ${new Date().toLocaleString()}</p>
  ${tableHtml}
</body>
</html>`;

      // Collect screenshots
      const screenshots = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.screenshot) {
          screenshots.push({
            name: `screenshot-${i + 1}.png`,
            data: a.screenshot,
          });
        }
      }
      
      // Build ZIP using existing dnZipStore
      const files = [
        { name: 'annotations.json', data: JSON.stringify(jsonData, null, 2) },
        { name: 'report.html', data: reportHtml },
      ];
      screenshots.forEach(s => {
        files.push({ name: `screenshots/${s.name}`, data: dataUrlToBytes(s.data) });
      });
      
      const zipBytes = dnZipStore(files);
      const blob = new Blob([zipBytes], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `redlines-${hostSlug}-${scopeSlug(scope)}-${dateSlug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ZIP bundle (${list.length} annotations, ${screenshots.length} screenshots)`);
    });
  }

  // ---------- Copy all (structured formats) ----------
  // Text formats omit the raw base64 screenshot (clipboard bloat / unreadable);
  // the actual images live in the Excel and HTML exports. hasScreenshot flags presence.
  function annotationsToJson(list, scope) {
    return JSON.stringify(
      {
        scope: scopeSlug(scope),
        page: scopeSource(scope),
        exportedAt: new Date().toISOString(),
        count: list.length,
        annotations: list.map((a, i) => ({
          index: i + 1,
          type: a.type,
          typeLabel: typeLabel(a.type),
          note: a.text,
          selector: a.selector || null,
          pageUrl: pageOf(a),
          markedAt: new Date(a.timestamp).toISOString(),
          hasScreenshot: !!a.screenshot,
        })),
      },
      null,
      2
    );
  }

  function annotationsToMarkdown(list, scope) {
    const lines = [
      '# Redlines annotations',
      '',
      `- **Page:** ${scopeSource(scope)}`,
      `- **Exported:** ${new Date().toLocaleString()}`,
      `- **Count:** ${list.length}`,
      '',
    ];
    list.forEach((a, i) => {
      lines.push(`## ${i + 1}. ${typeLabel(a.type)}`);
      lines.push('');
      lines.push(`- **Note:** ${a.text || ''}`);
      lines.push(`- **Location:** ${a.selector ? '`' + a.selector + '`' : 'No location'}`);
      lines.push(`- **Page:** ${pageOf(a)}`);
      lines.push(`- **Marked at:** ${new Date(a.timestamp).toISOString()}`);
      lines.push(`- **Screenshot:** ${a.screenshot ? 'yes' : 'no'}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function annotationsToXml(list, scope) {
    const items = list
      .map((a, i) => {
        return (
          `  <annotation index="${i + 1}" type="${xmlEscape(a.type)}">\n` +
          `    <typeLabel>${xmlEscape(typeLabel(a.type))}</typeLabel>\n` +
          `    <note>${xmlEscape(a.text)}</note>\n` +
          `    <location>${a.selector ? xmlEscape(a.selector) : ''}</location>\n` +
          `    <pageUrl>${xmlEscape(pageOf(a))}</pageUrl>\n` +
          `    <markedAt>${xmlEscape(new Date(a.timestamp).toISOString())}</markedAt>\n` +
          `    <hasScreenshot>${a.screenshot ? 'true' : 'false'}</hasScreenshot>\n` +
          `  </annotation>`
        );
      })
      .join('\n');
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<annotations scope="${scopeSlug(scope)}" page="${xmlEscape(scopeSource(scope))}" exportedAt="${xmlEscape(new Date().toISOString())}" count="${list.length}">\n` +
      items +
      `\n</annotations>`
    );
  }

  // Text formats shared by Copy as, the per-note copy button and the .json/.md/.xml/.txt exports.
  // Share apps (below) are text formats too; menus list only the ones enabled in Settings.
  const TEXT_FORMATS = [
    { id: 'json', label: 'JSON', icon: () => dnIcon('braces'), format: (l, s) => annotationsToJson(l, s) },
    { id: 'md', label: 'Markdown', short: 'MD', icon: () => dnIcon('fileText'), format: (l, s) => annotationsToMarkdown(l, s) },
    { id: 'xml', label: 'XML', icon: () => dnIcon('code'), format: (l, s) => annotationsToXml(l, s) },
    { id: 'txt', label: 'Plain text', short: 'Text', icon: () => dnIcon('fileText'), format: (l, s) => markdownToPlain(annotationsToMarkdown(l, s)) },
  ];
  const findFormat = (id) => TEXT_FORMATS.find((f) => f.id === id) || SHARE_APPS.find((f) => f.id === id) || TEXT_FORMATS[0];
  const copyFormatOptions = () => [...TEXT_FORMATS, ...SHARE_APPS.filter((app) => shareApps.includes(app.id) || app.id === copyFormat)];

  // Format every per-note copy button uses (dn_copy_format); picked in the sidebar header or
  // the table's Copy as, so both views always copy the same way.
  let copyFormat = 'json';
  function applyCopyFormat(id) {
    copyFormat = findFormat(id).id;
    const f = findFormat(copyFormat);
    const btn = sidebar.querySelector('#dn-copy-format-btn');
    btn.querySelector('.dn-copy-format-label').textContent = f.short || f.label;
    btn.title = `Copy button format: ${f.label}`;
    tableOverlay.querySelector('#dn-copy-menu-btn span').textContent = `Copy as ${f.short || f.label}`;
    if (sidebarOpen) renderSidebar();
    if (tableOverlay.classList.contains('open')) renderTableView();
  }
  function setCopyFormat(id) {
    applyCopyFormat(id);
    chrome.storage.local.set({ dn_copy_format: copyFormat });
  }
  chrome.storage.local.get('dn_copy_format', (res) => { if (res.dn_copy_format) applyCopyFormat(res.dn_copy_format); });
  chrome.storage.onChanged.addListener((changes, area) => { // picked in another tab
    if (area === 'local' && changes.dn_copy_format && changes.dn_copy_format.newValue !== copyFormat) applyCopyFormat(changes.dn_copy_format.newValue);
  });

  function copyAllAs(format, scope) {
    loadForScope(scope, (list) => {
      if (!list.length) {
        toast(scope === 'all' ? 'No annotations across all pages.' : 'No annotations to copy on this page.');
        return;
      }
      const f = findFormat(format);
      navigator.clipboard.writeText(f.format(list, scope)).then(
        () => toast(`Copied ${list.length} annotation${list.length === 1 ? '' : 's'} as ${f.label}`),
        () => toast('Copy failed')
      );
    });
  }

  const TEXT_EXPORT_TYPES = { json: ['json', 'application/json'], md: ['md', 'text/markdown'], xml: ['xml', 'application/xml'], txt: ['txt', 'text/plain'] };
  function exportAnnotationsText(format, scope) {
    loadForScope(scope, (list) => {
      if (!list.length) {
        toast(emptyScopeMsg(scope));
        return;
      }
      const f = findFormat(format);
      const [ext, mime] = TEXT_EXPORT_TYPES[f.id];
      const url = URL.createObjectURL(new Blob([f.format(list, scope)], { type: mime + ';charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `redlines-${location.hostname.replace(/[^a-z0-9.-]/gi, '-')}-${scopeSlug(scope)}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${list.length} annotation${list.length === 1 ? '' : 's'} as ${f.label}`);
    });
  }

  // One export list for the sidebar (always this page) and the table (its scope toggle).
  function exportMenuItems(scope) {
    return [
      { icon: dnBrandIcon('excel'), label: 'Excel (.xlsx)', onClick: () => downloadXlsx(scope) },
      { icon: dnIcon('pdf'), label: 'PDF (print-ready page)', onClick: () => exportAnnotationsPdf(scope) },
      { icon: dnIcon('download'), label: 'HTML report', onClick: () => exportAnnotationsHtml(scope) },
      { icon: dnIcon('csv'), label: 'CSV', onClick: () => exportAnnotationsCsv(scope) },
      { icon: dnIcon('fileText'), label: 'Markdown (.md)', onClick: () => exportAnnotationsText('md', scope) },
      { icon: dnIcon('braces'), label: 'JSON (.json)', onClick: () => exportAnnotationsText('json', scope) },
      { icon: dnIcon('code'), label: 'XML (.xml)', onClick: () => exportAnnotationsText('xml', scope) },
      { icon: dnIcon('fileText'), label: 'Plain text (.txt)', onClick: () => exportAnnotationsText('txt', scope) },
      { icon: dnIcon('sheet'), label: 'ZIP bundle (with screenshots)', onClick: () => exportAnnotationsZip(scope) },
      { icon: dnIcon('googleDrive'), label: 'Send to Google Drive', userOnly: true, onClick: () => sendXlsxToDrive(scope) },
    ];
  }

  // ---------- Share-to apps (table → Copy as) ----------
  // Settings → dn_share_apps picks which of these the menu offers. Each copies text formatted for
  // that app (no accounts, nothing sent). Keep ids/labels in sync with settings.html's list.
  const SHARE_APPS = [
    { id: 'notion', label: 'Notion', icon: () => dnIcon('notion'), format: (l, s) => annotationsToNotion(l, s) },
    { id: 'linear', label: 'Linear', icon: () => dnBrandIcon('linear'), format: (l, s) => annotationsToLinear(l, s) },
    { id: 'jira', label: 'Jira', icon: () => dnBrandIcon('jira'), format: (l, s) => annotationsToJira(l, s) },
    { id: 'github', label: 'GitHub issue', icon: () => dnIcon('github'), format: (l, s) => annotationsToMarkdown(l, s) },
    { id: 'gitlab', label: 'GitLab issue', icon: () => dnIcon('gitlab'), format: (l, s) => annotationsToMarkdown(l, s) },
    { id: 'slack', label: 'Slack', icon: () => dnIcon('slack'), format: (l, s) => markdownToSlack(annotationsToMarkdown(l, s)) },
    { id: 'discord', label: 'Discord', icon: () => dnIcon('discord'), format: (l, s) => annotationsToMarkdown(l, s) },
    { id: 'trello', label: 'Trello', icon: () => dnIcon('trello'), format: (l, s) => annotationsToMarkdown(l, s) },
    { id: 'email', label: 'Email', icon: () => dnIcon('mail'), format: (l, s) => markdownToPlain(annotationsToMarkdown(l, s)) },
  ];
  let shareApps = ['notion', 'linear', 'jira'];
  chrome.storage.local.get('dn_share_apps', (res) => { if (Array.isArray(res.dn_share_apps)) shareApps = res.dn_share_apps; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dn_share_apps) shareApps = changes.dn_share_apps.newValue || [];
  });
  // Slack mrkdwn: *bold*, and headings become bold lines
  function markdownToSlack(md) {
    return md.replace(/^#+ (.*)$/gm, '*$1*').replace(/\*\*(.+?)\*\*/g, '*$1*');
  }
  function markdownToPlain(md) {
    return md.replace(/^#+ /gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
  }

  // ---------- Quick-export format converters ----------
  function annotationsToNotion(list, scope) {
    // Notion-compatible markdown with callout blocks for each annotation
    const lines = [
      '# Redlines Annotations',
      '',
      `**Page:** ${scopeSource(scope)}`,
      `**Exported:** ${new Date().toLocaleString()}`,
      `**Count:** ${list.length}`,
      '',
    ];
    list.forEach((a, i) => {
      const typeEmoji = { bug: '🐛', suggestion: '💡', text: '📝', note: '📌' }[a.type] || '📌';
      lines.push(`## ${i + 1}. ${typeEmoji} ${typeLabel(a.type)}`);
      lines.push('');
      lines.push(`> **Note:** ${a.text || ''}`);
      lines.push(`> **Location:** ${a.selector ? '`' + a.selector + '`' : 'No location'}`);
      lines.push(`> **Page:** ${pageOf(a)}`);
      lines.push(`> **Marked at:** ${new Date(a.timestamp).toISOString()}`);
      lines.push(`> **Screenshot:** ${a.screenshot ? 'Yes' : 'No'}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  function annotationsToLinear(list, scope) {
    // Linear-compatible markdown for issue creation
    const lines = [
      '# Redlines Annotations for Linear',
      '',
      `**Source:** ${scopeSource(scope)}`,
      `**Exported:** ${new Date().toLocaleString()}`,
      '',
    ];
    list.forEach((a, i) => {
      const typeLabelMap = { bug: 'Bug', suggestion: 'Improvement', text: 'Task', note: 'Note' };
      const linearType = typeLabelMap[a.type] || 'Task';
      lines.push(`## ${i + 1}. [${linearType}] ${typeLabel(a.type)}: ${a.text.slice(0, 80)}${a.text.length > 80 ? '…' : ''}`);
      lines.push('');
      lines.push(`**Description:**`);
      lines.push(a.text || '');
      lines.push('');
      lines.push(`**Location:** ${a.selector || 'No location'}`);
      lines.push(`**Page:** ${pageOf(a)}`);
      lines.push(`**Marked at:** ${new Date(a.timestamp).toISOString()}`);
      lines.push(`**Screenshot:** ${a.screenshot ? 'Yes' : 'No'}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    return lines.join('\n');
  }

  function annotationsToJira(list, scope) {
    // Jira-compatible markdown (ADF-compatible simple markup)
    const lines = [
      'h1. Redlines Annotations for Jira',
      '',
      `*Source:* ${scopeSource(scope)}`,
      `*Exported:* ${new Date().toLocaleString()}`,
      '',
    ];
    list.forEach((a, i) => {
      const typeLabelMap = { bug: 'Bug', suggestion: 'Improvement', text: 'Task', note: 'Note' };
      const jiraType = typeLabelMap[a.type] || 'Task';
      lines.push(`h2. [${jiraType}] ${typeLabel(a.type)}: ${a.text.slice(0, 80)}${a.text.length > 80 ? '…' : ''}`);
      lines.push('');
      lines.push('*Description:*');
      lines.push(a.text || '');
      lines.push('');
      lines.push(`*Location:* ${a.selector || 'No location'}`);
      lines.push(`*Page:* ${pageOf(a)}`);
      lines.push(`*Marked at:* ${new Date(a.timestamp).toISOString()}`);
      lines.push(`*Screenshot:* ${a.screenshot ? 'Yes' : 'No'}`);
      lines.push('');
      lines.push('----');
      lines.push('');
    });
    return lines.join('\n');
  }

  // ---------- Excel (.xlsx) export with embedded images ----------
  // Hand-rolled OOXML (no libraries — must stay offline). Store-only ZIP + a drawing
  // layer that anchors each screenshot into the Screenshot column. Byte format validated
  // against Expand-Archive (CRC + structure) and a strict XML parse; see scratchpad test.
  const DN_CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function dnCrc32(u8) {
    let crc = 0xffffffff;
    for (let i = 0; i < u8.length; i++) crc = DN_CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dnZipStore(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const DOS_DATE = 0x21; // 1980-01-01
    const push = (u8) => { parts.push(u8); offset += u8.length; };
    const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
    const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
      const crc = dnCrc32(data);
      const localOffset = offset;
      push(u32(0x04034b50));
      push(u16(20)); push(u16(0)); push(u16(0));
      push(u16(0)); push(u16(DOS_DATE));
      push(u32(crc)); push(u32(data.length)); push(u32(data.length));
      push(u16(nameBytes.length)); push(u16(0));
      push(nameBytes);
      push(data);
      central.push({ nameBytes, crc, size: data.length, localOffset });
    }

    const cdStart = offset;
    for (const c of central) {
      push(u32(0x02014b50));
      push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0));
      push(u16(0)); push(u16(DOS_DATE));
      push(u32(c.crc)); push(u32(c.size)); push(u32(c.size));
      push(u16(c.nameBytes.length)); push(u16(0)); push(u16(0));
      push(u16(0)); push(u16(0)); push(u32(0));
      push(u32(c.localOffset));
      push(c.nameBytes);
    }
    const cdSize = offset - cdStart;
    push(u32(0x06054b50));
    push(u16(0)); push(u16(0));
    push(u16(central.length)); push(u16(central.length));
    push(u32(cdSize)); push(u32(cdStart)); push(u16(0));

    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // Load an image's natural size, capped for display, from a data URL.
  function dnLoadImageInfo(dataUrl) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const maxW = 200;
        const maxH = 150;
        let w = im.naturalWidth || 1;
        let h = im.naturalHeight || 1;
        const scale = Math.min(1, maxW / w, maxH / h);
        resolve({ wPx: Math.max(1, Math.round(w * scale)), hPx: Math.max(1, Math.round(h * scale)) });
      };
      im.onerror = () => resolve(null);
      im.src = dataUrl;
    });
  }

  const DN_PX_TO_EMU = 9525;
  function dnBuildXlsxParts(rows, images) {
    const hasPage = rows.length > 0 && 'page' in rows[0];
    const colLetters = hasPage ? ['A', 'B', 'C', 'D', 'E', 'F', 'G'] : ['A', 'B', 'C', 'D', 'E', 'F'];
    const cell = (col, r, val, numeric) => {
      const ref = col + r;
      if (numeric) return `<c r="${ref}"><v>${val}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`;
    };
    const header = hasPage ? ['#', 'Screenshot', 'Type', 'Note', 'Page', 'Location', 'Marked at'] : ['#', 'Screenshot', 'Type', 'Note', 'Location', 'Marked at'];
    let sheetRows = `<row r="1">${header.map((h, i) => cell(colLetters[i], 1, h)).join('')}</row>`;
    rows.forEach((row, idx) => {
      const r = idx + 2;
      const img = images.find((im) => im.rowIndex0 === idx);
      const ht = img ? Math.max(15, img.hPx * 0.75) : 15;
      let cells =
        cell('A', r, row.num, true) +
        cell('B', r, img ? '' : '—') +
        cell('C', r, row.type) +
        cell('D', r, row.note);
      if (hasPage) {
        cells += cell('E', r, row.page) +
                 cell('F', r, row.selector || 'No location') +
                 cell('G', r, row.when);
      } else {
        cells += cell('E', r, row.selector || 'No location') +
                 cell('F', r, row.when);
      }
      sheetRows += `<row r="${r}" ht="${ht.toFixed(2)}" customHeight="1">${cells}</row>`;
    });

    const anchors = images
      .map((im, i) => {
        const id = i + 1;
        const cx = Math.round(im.wPx * DN_PX_TO_EMU);
        const cy = Math.round(im.hPx * DN_PX_TO_EMU);
        const colOffset = hasPage ? 1 : 0;
        return `<xdr:oneCellAnchor>
<xdr:from><xdr:col>${1 + colOffset}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${im.rowIndex0 + 1}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>
<xdr:ext cx="${cx}" cy="${cy}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="${id}" name="Image ${id}"/><xdr:cNvPicPr/></xdr:nvPicPr>
<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>`;
      })
      .join('');

    const drawingRels = images
      .map((im, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.png"/>`
      )
      .join('');

    const colDefs = hasPage
      ? '<cols><col min="2" max="2" width="30" customWidth="1"/><col min="4" max="4" width="55" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/><col min="6" max="6" width="30" customWidth="1"/><col min="7" max="7" width="22" customWidth="1"/></cols>'
      : '<cols><col min="2" max="2" width="30" customWidth="1"/><col min="4" max="4" width="55" customWidth="1"/><col min="5" max="5" width="30" customWidth="1"/><col min="6" max="6" width="22" customWidth="1"/></cols>';

    const files = [
      { name: '[Content_Types].xml', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>` },
      { name: '_rels/.rels', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
      { name: 'xl/workbook.xml', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Annotations" sheetId="1" r:id="rId1"/></sheets>
</workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>` },
      { name: 'xl/worksheets/sheet1.xml', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${colDefs}
<sheetData>${sheetRows}</sheetData>
<drawing r:id="rId1"/>
</worksheet>` },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>` },
      { name: 'xl/drawings/drawing1.xml', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>` },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data:
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels}</Relationships>` },
    ];
    images.forEach((im, i) => files.push({ name: `xl/media/image${i + 1}.png`, data: im.bytes }));
    return files;
  }

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Builds the .xlsx byte payload once, shared by the download and the Drive upload.
  // Returns null when there's nothing to export.
  async function buildXlsxBytes(scope) {
    const list = await new Promise((resolve) => loadForScope(scope, resolve));
    if (!list.length) return null;
    const rows = list.map((a, i) => ({
      num: i + 1,
      type: typeLabel(a.type),
      note: a.text,
      selector: a.selector,
      page: pageOf(a),
      when: new Date(a.timestamp).toLocaleString(),
    }));
    const images = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.screenshot) continue;
      try {
        const info = await dnLoadImageInfo(a.screenshot);
        if (!info) continue;
        images.push({ rowIndex0: i, wPx: info.wPx, hPx: info.hPx, bytes: dataUrlToBytes(a.screenshot) });
      } catch (e) {
        /* skip an image that fails to decode; the row still exports */
      }
    }
    const zipBytes = dnZipStore(dnBuildXlsxParts(rows, images));
    const hostSlug = location.hostname.replace(/[^a-z0-9.-]/gi, '-');
    const dateSlug = new Date().toISOString().slice(0, 10);
    return { zipBytes, filename: `redlines-${hostSlug}-${scopeSlug(scope)}-${dateSlug}.xlsx`, count: list.length, imageCount: images.length };
  }

  async function downloadXlsx(scope) {
    toast('Building spreadsheet…');
    const built = await buildXlsxBytes(scope);
    if (!built) {
      toast(emptyScopeMsg(scope));
      return;
    }
    const blob = new Blob([built.zipBytes], { type: XLSX_MIME });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = built.filename;
    link.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${built.count} annotation${built.count === 1 ? '' : 's'} (${built.imageCount} image${built.imageCount === 1 ? '' : 's'})`);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000; // avoid "too many arguments" on String.fromCharCode for big files
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  let driveBusy = false;
  function setDriveBusy(busy) {
    driveBusy = busy;
    root.querySelectorAll('#dn-drive-btn, [data-drive="1"]').forEach((el) => {
      el.classList.toggle('dn-busy', busy);
      el.disabled = busy;
    });
  }

  function sendXlsxToDrive(scope) {
    if (driveBusy) return;
    confirmOnce('dn_consent_drive',
      'Send to Google Drive uploads an Excel file of these notes, including their screenshots, ' +
      'page addresses and element selectors, to your Google Drive. Redlines can only see files it creates there.',
      () => uploadXlsxToDrive(scope));
  }

  async function uploadXlsxToDrive(scope) {
    if (driveBusy) return; // one upload at a time — avoids duplicate files on double-click
    toast('Building spreadsheet…');
    const built = await buildXlsxBytes(scope);
    if (!built) {
      toast(emptyScopeMsg(scope));
      return;
    }
    setDriveBusy(true);
    toast('Connecting to Google Drive…');
    chrome.runtime.sendMessage(
      { type: 'UPLOAD_TO_DRIVE', payload: { filename: built.filename, base64: bytesToBase64(built.zipBytes), mimeType: XLSX_MIME } },
      (res) => {
        setDriveBusy(false);
        if (!res || res.error) {
          toast('Drive upload failed: ' + ((res && res.error) || 'no response'));
          return;
        }
        toast(`Saved to Google Drive ✓ — ${built.count} annotation${built.count === 1 ? '' : 's'}`);
        if (res.link) window.open(res.link, '_blank', 'noopener');
      }
    );
  }

  function dataUrlToBytes(dataUrl) {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Only the 4 legacy canonical types get a fixed palette class; any custom
  // category (the norm now that there are no baked-in defaults) falls back to
  // dn-type-custom, colored via the same deterministic hash as its pill (getTypeColor).
  function typeClass(type) {
    const key = (type || '').toLowerCase();
    return { bug: 'dn-type-bug', suggestion: 'dn-type-suggestion', text: 'dn-type-text', note: 'dn-type-note' }[key] || 'dn-type-custom';
  }
  function typeLabel(type) {
    const key = (type || '').toLowerCase();
    return { bug: 'Layout Bug', suggestion: 'Suggestion', text: 'Text Annotation', note: 'General Note' }[key] || type || 'Note';
  }
  function copiedTag(a) {
    return a.copiedAt
      ? `<span class="dn-copied" title="Copied ${escapeHtml(new Date(a.copiedAt).toLocaleString())}">${dnIcon('check')}Copied</span>`
      : '';
  }
  function typeBadge(type) {
    return `<span class="dn-type ${typeClass(type)}" style="--type-color:${getTypeColor(type)}">${escapeHtml(typeLabel(type))}</span>`;
  }

  // Status filters. "Re-pin" = the note's element can't be found on this page.
  let sidebarFilter = 'all';
  let activeCardId = null;
  const SF_DEFS = [
    ['all', 'All', 'Show every note on this page'],
    ['open', 'Open', 'Show notes that are still open'],
    ['agent', 'Agent', 'Show open notes sent to an AI agent'],
    ['lost', 'Re-pin', 'Show notes whose element was not found'],
    ['done', 'Done', 'Show resolved notes'],
  ];
  function noteInFilter(a, lost, f) {
    const done = a.status === 'resolved';
    return f === 'all' || (f === 'open' && !done && !lost) || (f === 'agent' && !done && !!a.assignee) || (f === 'lost' && !done && lost) || (f === 'done' && done);
  }
  sidebar.querySelector('#dn-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-sf]');
    if (!chip) return;
    sidebarFilter = chip.dataset.sf;
    renderSidebar();
  });

  function cardHtml(a, n, lost) {
    const resolved = a.status === 'resolved';
    return `
      <div class="dn-card-head">
        <button type="button" class="dn-card-num" style="--type-color:${getTypeColor(a.type)}" aria-label="Go to annotation ${n} on the page" data-tip="Go to this element on the page">${n}</button>
        ${typeBadge(a.type)}
        ${a.source === 'ai' ? '<span class="dn-tag" data-tip="Added by an AI agent">AI</span>' : ''}
        ${a.assignee ? `<span class="dn-tag dn-tag-agent" data-tip="Sent to ${escapeHtml(a.assignee.name)}">${agentIconHtml(a.assignee)}${escapeHtml(a.assignee.name)}</span>` : ''}
        ${resolved ? `<span class="dn-tag dn-tag-done">${dnIcon('check')}Resolved</span>` : ''}
        ${lost ? '<span class="dn-tag dn-tag-lost" data-tip="The page changed and this note\'s element can\'t be found. Re-pin it.">Element not found</span>' : ''}
        <span class="dn-meta" data-tip="Marked ${escapeHtml(new Date(a.timestamp).toLocaleString())}">${agoLabel(a.timestamp)}${copiedTag(a)}</span>
      </div>
      <p>${escapeHtml(a.text)}</p>
      ${(a.replies || []).map((r) => `<div class="dn-reply"><span class="dn-reply-by">${r.by === 'ai' ? 'AI' : 'You'}</span>${escapeHtml(r.text)}</div>`).join('')}
      ${a.screenshot ? `<button type="button" class="dn-shot" data-act="peek" aria-label="Open the screenshot larger" data-tip="Open the screenshot larger"><img src="${escapeHtml(a.screenshot)}" alt="" /></button>` : ''}
      <div class="dn-card-actions">${actionsHtml(a, { lost, table: false, offPage: false })}</div>
    `;
  }

  function renderSidebar() {
    loadAnnotations((list) => {
      hideTip();
      sidebar.querySelector('#dn-header-count').textContent =
        list.length + (list.length === 1 ? ' annotation on this page' : ' annotations on this page');
      sidebar.querySelector('#dn-rail-count').textContent = list.length;
      const lostIds = renderPins(list);
      const filters = sidebar.querySelector('#dn-filters');
      filters.hidden = !list.length;
      filters.innerHTML = SF_DEFS.map(([k, label, text]) =>
        `<button type="button" class="dn-sf-chip" data-sf="${k}" aria-pressed="${sidebarFilter === k}" data-tip="${text}">${label}<b>${list.filter((a) => noteInFilter(a, lostIds.has(a.id), k)).length}</b></button>`).join('');
      const container = sidebar.querySelector('#designnote-list');
      if (!list.length) {
        container.innerHTML = `<div id="designnote-empty">${dnIcon('pointer')}<strong>No annotations on this page yet</strong>Turn on Inspect in the dock (or press <kbd>Alt+Shift+M</kbd>) and click any element. Use + above for a general note without a location. <a href="https://redlines.design/docs/quickstart" target="_blank" rel="noopener">Quickstart guide</a></div>`;
        return;
      }
      // n = chronological number, matches the page pin; newest first
      const shown = list.map((a, i) => ({ a, n: i + 1 })).filter(({ a }) => noteInFilter(a, lostIds.has(a.id), sidebarFilter)).reverse();
      container.innerHTML = '';
      if (!shown.length) {
        container.innerHTML = '<div class="dn-sf-empty">No notes match this filter.</div>';
        return;
      }
      const frag = document.createDocumentFragment(); // one insert instead of one per card
      shown.forEach(({ a, n }) => {
        const resolved = a.status === 'resolved';
        const lost = lostIds.has(a.id);
        const card = document.createElement('div');
        card.className = 'dn-card' + (resolved ? ' dn-card-resolved' : '') + (lost ? ' dn-card-lost' : '') + (a.id === activeCardId ? ' dn-card-active' : '');
        card.dataset.id = a.id;
        card.innerHTML = cardHtml(a, n, lost);
        card.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (btn) {
            e.stopPropagation();
            noteAction(btn.dataset.act, a, btn, e);
            return;
          }
          activeCardId = a.id;
          container.querySelectorAll('.dn-card').forEach((c) => c.classList.toggle('dn-card-active', c === card));
          jumpToAnnotation(a);
        });
        frag.appendChild(card);
      });
      container.appendChild(frag);
      if (pendingFlashId) {
        const card = container.querySelector(`.dn-card[data-id="${CSS.escape(pendingFlashId)}"]`);
        pendingFlashId = null;
        if (card) {
          card.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
          card.classList.add('dn-card-flash');
          setTimeout(() => card.classList.remove('dn-card-flash'), 1600);
        }
      }
    });
  }

  // Safe for text *and* quoted attribute values. (The old textContent→innerHTML trick
  // left quotes alone, so a category like `x" onmouseover="…` broke out of data-type="".)
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const rowClass = (a, onPage) => [onPage ? '' : 'dn-other-page', a.status === 'resolved' ? 'dn-row-done' : ''].filter(Boolean).join(' ');
  const tableTags = (a) => (a.status === 'resolved' ? '<span class="dn-tag dn-tag-done">Resolved</span>' : '')
    + (a.assignee ? `<span class="dn-tag dn-tag-agent">${agentIconHtml(a.assignee)}${escapeHtml(a.assignee.name)}</span>` : '');
  function renderAnnotationsTable(list, opts) {
    const interactive = !!(opts && opts.interactive);
    const showPage = !!(opts && opts.showPage);
    const colCount = interactive ? (showPage ? 8 : 7) : (showPage ? 7 : 6);

    if (showPage && list.length) {
      // Group by domain for "All pages" view
      const groups = {};
      for (const a of list) {
        const domain = extractMainDomain(a.pageUrl || location.href.split('#')[0]);
        if (!groups[domain]) groups[domain] = [];
        groups[domain].push(a);
      }

      const sortedDomains = Object.keys(groups).sort();
      let allRows = '';
      let globalIndex = 0;
      for (const domain of sortedDomains) {
        const domainAnnotations = groups[domain].slice().reverse();
        // Domain header row
        allRows += `
          <tr class="dn-domain-header">
            <td colspan="${colCount}">
              <div class="dn-domain-label">
                ${dnIcon('globe')} ${escapeHtml(domain)}
                <span class="dn-domain-count">${domainAnnotations.length} annotation${domainAnnotations.length !== 1 ? 's' : ''}</span>
              </div>
            </td>
          </tr>`;
        // Annotation rows for this domain
        for (const a of domainAnnotations) {
          globalIndex++;
          const thumb = a.screenshot
            ? `<img class="dn-table-thumb" src="${a.screenshot}" alt="" />`
            : '—';
          const loc = a.selector ? `<code>${escapeHtml(a.selector)}</code>` : 'No location';
          const pageCell = `<td title="${escapeHtml(a.pageUrl)}">${escapeHtml(new URL(a.pageUrl).hostname)}</td>`;
          const isCurrentPage = a.pageUrl === location.href.split('#')[0];
          const actionsCell = interactive
            ? `<td><div class="dn-table-actions">${actionsHtml(a, { table: true, offPage: !isCurrentPage, lost: false })}</div></td>`
            : '';
          allRows += `
            <tr data-id="${escapeHtml(a.id)}" class="${rowClass(a, isCurrentPage)}">
              <td><span class="dn-num">${globalIndex}</span></td>
              <td>${thumb}</td>
              <td>${typeBadge(a.type)}</td>
              <td class="dn-table-note">${escapeHtml(a.text)}${copiedTag(a)}${tableTags(a)}</td>
              ${pageCell}
              <td>${loc}</td>
              <td class="dn-table-time">${new Date(a.timestamp).toLocaleString()}</td>
              ${actionsCell}
            </tr>`;
        }
      }

      return `
        <table class="dn-table">
          <thead>
            <tr>
              <th>#<div class="dn-col-resizer"></div></th>
              <th>Screenshot<div class="dn-col-resizer"></div></th>
              <th>Type<div class="dn-col-resizer"></div></th>
              <th>Note<div class="dn-col-resizer"></div></th>
              <th>Page<div class="dn-col-resizer"></div></th>
              <th>Location<div class="dn-col-resizer"></div></th>
              <th>Marked at<div class="dn-col-resizer"></div></th>
              ${interactive ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>${allRows}</tbody>
        </table>
      `;
    }

    // Regular single-page view
    const rows = list.length
      ? list
          .slice()
          .reverse()
          .map((a, i) => {
            const thumb = a.screenshot
              ? `<img class="dn-table-thumb" src="${a.screenshot}" alt="" />`
              : '—';
            const loc = a.selector ? `<code>${escapeHtml(a.selector)}</code>` : 'No location';
            const pageCell = showPage ? `<td title="${escapeHtml(a.pageUrl || location.href.split('#')[0])}">${escapeHtml(a.pageUrl ? new URL(a.pageUrl).hostname : location.hostname)}</td>` : '';
            const isCurrentPage = !a.pageUrl || a.pageUrl === location.href.split('#')[0];
            const actionsCell = interactive
            ? `<td><div class="dn-table-actions">${actionsHtml(a, { table: true, offPage: !isCurrentPage, lost: false })}</div></td>`
            : '';
            return `
              <tr data-id="${escapeHtml(a.id)}" class="${rowClass(a, isCurrentPage)}">
                <td><span class="dn-num">${annotations.findIndex((x) => x.id === a.id) + 1 || list.length - i}</span></td>
                <td>${thumb}</td>
                <td>${typeBadge(a.type)}</td>
                <td class="dn-table-note">${escapeHtml(a.text)}${copiedTag(a)}${tableTags(a)}</td>
                ${pageCell}
                <td>${loc}</td>
                <td class="dn-table-time">${new Date(a.timestamp).toLocaleString()}</td>
                ${actionsCell}
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="${colCount}">No annotations${showPage ? ' across all pages' : ' on this page'}.</td></tr>`;

    // Add resizers to headers - last column has no resizer
    const headersShowPage = showPage ? ['#','Screenshot','Type','Note','Page','Location','Marked at'] : ['#','Screenshot','Type','Note','Location','Marked at'];
    if (interactive) headersShowPage.push('Actions');
    const headerHtml = headersShowPage.map((h,i) => {
      const isLast = i === headersShowPage.length - 1;
      return `<th>${h}${isLast ? '' : '<div class="dn-col-resizer"></div>'}</th>`;
    }).join('');

    return `
      <table class="dn-table">
        <thead>
          <tr>
            ${headerHtml}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function refreshAfterChange() {
    renderSidebar(); // also reloads `annotations` + badge
    if (tableOverlay.classList.contains('open')) renderTableView();
  }

  // Works on any page's annotation (All-pages table rows carry pageUrl), and offers Undo.
  function deleteAnnotation(a) {
    const key = STORAGE_PREFIX + pageOf(a);
    chrome.storage.local.get([key], (res) => {
      const list = res[key] || [];
      const idx = list.findIndex((x) => x.id === a.id);
      if (idx === -1) return;
      const [removed] = list.splice(idx, 1);
      chrome.storage.local.set({ [key]: list }, () => {
        if (chrome.runtime.lastError) {
          toast('Delete failed: ' + chrome.runtime.lastError.message);
          return;
        }
        refreshAfterChange();
        toast('Annotation deleted', { label: 'Undo', onClick: () => restoreAnnotation(key, removed, idx) });
      });
    });
  }

  function restoreAnnotation(key, annotation, idx) {
    chrome.storage.local.get([key], (res) => {
      const list = res[key] || [];
      if (!list.some((x) => x.id === annotation.id)) list.splice(Math.min(idx, list.length), 0, annotation);
      chrome.storage.local.set({ [key]: list }, () => {
        if (chrome.runtime.lastError) {
          toast('Undo failed: ' + chrome.runtime.lastError.message);
          return;
        }
        refreshAfterChange();
        toast('Annotation restored');
      });
    });
  }

  // Enter saves a form's note; Shift+Enter adds a line break. Skipped mid IME composition.
  function submitOnEnter(e, saveBtn) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    saveBtn.click();
  }

  function editAnnotation(a) {
    // Remove any existing edit form
    const existing = root.querySelector('#designnote-edit-form');
    if (existing) existing._dispose();

    // Same categories as the create form, plus this note's own (custom ones may not be listed)
    const editCategories = categoryList.slice();
    if (a.type && !editCategories.some((c) => c.toLowerCase() === a.type.toLowerCase())) editCategories.push(a.type);

    const form = document.createElement('div');
    form.id = 'designnote-edit-form';
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', 'Edit annotation');
    form.innerHTML = `
      <div class="dn-edit-head">
        <h3>Edit annotation</h3>
        <button class="dn-icon-btn dn-close-edit" aria-label="Close" title="Close">${dnIcon('x')}</button>
      </div>
      <div class="dn-form-pickers">
        <div class="dn-type-picker" id="dn-edit-type-picker"${showCategories ? '' : ' style="display:none;"'}>
          ${categoryPillsHtml(editCategories, a.type)}
        </div>
      </div>
      <textarea id="dn-edit-text-input" aria-label="Annotation text" placeholder="What should change here?">${escapeHtml(a.text)}</textarea>
      <div class="dn-form-actions">
        <button class="dn-text-btn dn-cancel" title="Cancel (Esc)">Cancel</button>
        <button class="dn-text-btn dn-save" title="Save (Enter)">Save</button>
      </div>
    `;
    const opener = document.activeElement;
    root.appendChild(form);
    form.querySelector('textarea').focus();
    form.querySelector('textarea').addEventListener('keydown', (e) => submitOnEnter(e, form.querySelector('.dn-save')));
    form._dispose = () => { form.remove(); document.removeEventListener('keydown', escHandler); };
    const close = () => {
      form._dispose();
      if (opener && opener.isConnected) opener.focus();
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    form.querySelectorAll('.dn-type-pill').forEach((pillBtn) => {
      pillBtn.addEventListener('click', () => {
        form.querySelectorAll('.dn-type-pill').forEach((b) => b.classList.remove('selected'));
        pillBtn.classList.add('selected');
      });
    });

    // Change or clear the AI agent this note was sent to
    getAgents((agents) => {
      const html = form.isConnected && agentPickerHtml(agents, a.assignee);
      if (!html) return;
      form.querySelector('.dn-form-pickers').insertAdjacentHTML('beforeend', html);
      bindAgentPicker(form);
    });

    form.querySelector('.dn-cancel').addEventListener('click', close);
    form.querySelector('.dn-close-edit').addEventListener('click', close);
    form.querySelector('.dn-save').addEventListener('click', () => {
      const selected = form.querySelector('.dn-type-pill.selected');
      let type = selected ? selected.dataset.type : a.type;
      // Unchanged category (ignoring case) keeps its stored spelling, e.g. a legacy "Bug"
      if (a.type && type.toLowerCase() === a.type.toLowerCase()) type = a.type;
      const text = form.querySelector('#dn-edit-text-input').value.trim();
      if (!text) {
        toast('Please add a comment before saving.');
        return;
      }
      // No picker shown (no agent connected, none assigned) = leave the assignment alone
      const agent = form.querySelector('.dn-agent-picker') ? pickedAgent(form) : a.assignee;
      close();
      saveEditedAnnotation(a.id, type, text, agent);
    });
  }

  function saveEditedAnnotation(id, type, text, agent) {
    loadAnnotations((list) => {
      const idx = list.findIndex((a) => a.id === id);
      if (idx === -1) return;
      list[idx].type = type;
      list[idx].text = text;
      if (agent) list[idx].assignee = agent;
      else delete list[idx].assignee;
      list[idx].updatedAt = Date.now(); // keep `timestamp` as the original "Marked at"
      annotations = list;
      saveAnnotations(() => {
        toast('Annotation updated');
        if (sidebarOpen) renderSidebar();
        if (tableOverlay.classList.contains('open')) renderTableView();
      });
    });
  }

  // Copies one note in the format picked in the sidebar header / table Copy as.
  function copyAnnotation(a) {
    const f = findFormat(copyFormat);
    const text = f.id === 'json'
      ? JSON.stringify({ type: a.type, text: a.text, selector: a.selector || null, url: currentUrl(), timestamp: a.timestamp }, null, 2)
      : f.format([a], 'current');
    navigator.clipboard.writeText(text).then(() => {
      toast(`Copied annotation as ${f.label}`);
      markCopied(a);
    }, () => toast('Copy failed: the clipboard is blocked on this page.'));
  }

  // Persists a "Copied" flag so cards/rows show what's already been handed off.
  // Copy buttons are only enabled for current-page annotations, so pageKey() is right.
  function markCopied(a) {
    const target = annotations.find((x) => x.id === a.id);
    if (!target) return;
    target.copiedAt = Date.now();
    saveAnnotations(() => {
      if (sidebarOpen) renderSidebar();
      if (tableOverlay.classList.contains('open')) renderTableView();
    });
  }

  // data: URL -> Blob, decoded synchronously (no fetch/await) so the clipboard
  // write below still runs inside the click's user-activation window — an
  // async hop here (e.g. fetch().then()) makes Chrome treat the click as stale
  // and reject navigator.clipboard.write() with NotAllowedError.
  function dataUrlToBlobSync(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // Image only: bundling text/plain alongside made Figma/Slack/Docs paste the
  // JSON instead of the picture (they prefer text when both are offered).
  function copyAnnotationWithImage(a) {
    if (!a.screenshot) {
      copyAnnotation(a);
      return;
    }
    const fail = (e) => toast('Image copy failed: ' + ((e && e.message) || 'clipboard blocked on this page'));
    try {
      const blob = dataUrlToBlobSync(a.screenshot);
      navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]).then(() => {
        toast('Copied image');
        markCopied(a);
      }, fail);
    } catch (e) {
      fail(e);
    }
  }

  // One-time notice before data first goes to an outside service. confirm() here runs in the
  // extension's isolated world, so the host page can't override or auto-answer it.
  function confirmOnce(flag, message, proceed) {
    chrome.storage.local.get(flag, (res) => {
      if (res[flag]) return proceed();
      if (!window.confirm(message + "\n\nContinue? You won't be asked again.")) return;
      chrome.storage.local.set({ [flag]: true }, proceed);
    });
  }

  const PROVIDER_NAMES = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', openrouter: 'OpenRouter' };
  function enhanceAnnotation(a) {
    chrome.storage.local.get('dn_provider', (res) => {
      const provider = res.dn_provider || 'anthropic';
      const name = PROVIDER_NAMES[provider] || provider;
      confirmOnce('dn_consent_enhance_' + provider,
        `Enhance sends this note to ${name} to rewrite it as an AI prompt: the note text, its category, ` +
        `the element's CSS selector and the page address (without query string or #fragment). ` +
        `Screenshots are not sent. Your API key goes only to ${name}.`,
        () => sendEnhance(a));
    });
  }

  function sendEnhance(a) {
    toast('Enhancing prompt…');
    chrome.runtime.sendMessage(
      {
        type: 'ENHANCE_PROMPT',
        payload: {
          annotationType: typeLabel(a.type),
          text: a.text,
          selector: a.selector || null,
          url: location.href.split('#')[0],
        },
      },
      (res) => {
        if (chrome.runtime.lastError) {
          toast('Error: ' + chrome.runtime.lastError.message);
          return;
        }
        if (!res || res.error) {
          toast(res && res.error ? res.error : 'Enhance failed — check your API key in settings.');
          return;
        }
        navigator.clipboard.writeText(res.enhancedPrompt).then(
          () => toast('Enhanced prompt copied to clipboard!'),
          () => toast("Couldn't copy the enhanced prompt — the clipboard is blocked. Click the page, then try Enhance again.")
        );
      }
    );
  }

  // Selector (verified against the fingerprint when it's a fragile nth-child path), then
  // fingerprint fallback; 'none' = lost (offer Re-pin) rather than a guess. Shared by jump + page pins.
  function findAnnotationEl(a) {
    if (!a.selector && !a.fingerprint) return { el: null, method: 'none' };
    const result = window.__designNoteFindElement(a.selector, a.fingerprint);
    return { el: result.element, method: result.method };
  }

  function jumpToAnnotation(a) {
    pendingFlashId = a.id;
    showSidebar();
    const { el, method } = findAnnotationEl(a);

    if (el) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      el.classList.add('dn-jump-highlight');
      setTimeout(() => el.classList.remove('dn-jump-highlight'), 1600);
      if (method === 'fingerprint') toast('Matched approximately: the page changed since this note was made. Check it is the right element.');
      return;
    }
    if (!a.selector) return; // general note: it never had a location
    if (a.rect) window.scrollTo({ top: Math.max(0, a.rect.top - 150), behavior: scrollBehavior() });
    toast(`Couldn't find this element: the page has changed since the note was made.${a.rect ? ' Scrolled to where it was.' : ''}`,
      { label: 'Re-pin', onClick: () => startRepin(a) });
  }

  // Re-pin: the next element picked in Inspect mode becomes this note's new location.
  let repinTarget = null;
  function startRepin(a) {
    enterMarkMode();
    repinTarget = a;
    toast('Re-pin: click the element this note belongs to. Esc to cancel.');
  }
  function repinAnnotation(a, el, rect) {
    const s = window.__designNoteGetSelectorWithFingerprint(el);
    // ponytail: keeps the old screenshot; retake it here if stale crops confuse people
    updateAnnotation(a, (t) => Object.assign(t, { selector: s.selector, fingerprint: s.fingerprint, anchor: s.anchor, rect }),
      () => toast('Note re-pinned to this element'));
  }

  // Changes one note in place (any page's, like deleteAnnotation), from fresh storage so a
  // concurrent change (e.g. an AI agent resolving another note) isn't overwritten.
  function updateAnnotation(a, change, done) {
    const key = STORAGE_PREFIX + pageOf(a);
    chrome.storage.local.get([key], (res) => {
      const list = res[key] || [];
      const target = list.find((x) => x.id === a.id);
      if (!target) return;
      change(target);
      target.updatedAt = Date.now();
      chrome.storage.local.set({ [key]: list }, () => {
        if (chrome.runtime.lastError) return toast('Save failed: ' + chrome.runtime.lastError.message);
        refreshAfterChange();
        done && done();
      });
    });
  }
  function toggleResolved(a) {
    const resolve = a.status !== 'resolved';
    updateAnnotation(a, (t) => {
      if (resolve) Object.assign(t, { status: 'resolved', resolvedAt: Date.now(), resolvedBy: 'user' });
      else { t.status = 'open'; delete t.resolvedAt; delete t.resolvedBy; }
    }, () => toast(resolve ? 'Marked resolved' : 'Reopened'));
  }

  // ---------- Annotate mode: custom cursor + element highlight ----------
  // A devtools-style picker: a floating box tweens to the hovered element. The pointer is the
  // system cursor (a crosshair, content.css) so it never lags; a decorative ring eases after it.
  const markUI = document.createElement('div');
  markUI.id = 'dn-mark-ui';
  markUI.setAttribute('aria-hidden', 'true');
  markUI.innerHTML = `
    <div id="dn-highlight-box"><span id="dn-highlight-label"></span><span id="dn-highlight-size"></span></div>
    <div id="dn-cursor-ring"></div>
  `;
  root.appendChild(markUI);
  const highlightBox = markUI.querySelector('#dn-highlight-box');
  const highlightLabel = markUI.querySelector('#dn-highlight-label');
  const highlightSize = markUI.querySelector('#dn-highlight-size');
  const cursorRing = markUI.querySelector('#dn-cursor-ring');

  let mouseX = 0, mouseY = 0, ringX = 0, ringY = 0, followRAF = 0, lastStep = 0;

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + el.classList[0];
    return s;
  }

  function showHighlight(el) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return hideHighlight();
    highlightBox.style.transform = `translate(${r.left}px, ${r.top}px)`; // compositor-only move
    highlightBox.style.width = r.width + 'px';
    highlightBox.style.height = r.height + 'px';
    highlightLabel.textContent = describe(el);
    highlightSize.textContent = `${Math.round(r.width)} × ${Math.round(r.height)} px`;
    highlightBox.classList.toggle('dn-flip-top', r.top < 30);
    highlightBox.classList.toggle('dn-flip-bottom', r.bottom > window.innerHeight - 30);
    highlightBox.classList.add('visible');
  }
  function hideHighlight() {
    hoveredEl = null;
    highlightBox.classList.remove('visible');
  }

  // While the note form is open, the brackets stay on the element being annotated.
  let lockedEl = null;
  const relock = () => { if (lockedEl) showHighlight(lockedEl); };
  function lockHighlight(el) {
    lockedEl = el;
    markUI.classList.add('active', 'dn-locked');
    showHighlight(el);
    window.addEventListener('scroll', relock, { passive: true, capture: true });
  }
  function unlockHighlight() {
    if (!lockedEl) return;
    lockedEl = null;
    window.removeEventListener('scroll', relock, { capture: true });
    if (!annotateMode) { markUI.classList.remove('active'); hideHighlight(); }
    markUI.classList.remove('dn-locked');
  }

  // Time-based easing, so the ring feels the same at 60 or 120 Hz and through dropped frames.
  function followStep(t) {
    const dt = Math.min(64, t - (lastStep || t - 16));
    lastStep = t;
    const k = motionReduced() ? 1 : 1 - Math.exp(-dt / 45); // no trailing ring with reduced motion
    ringX += (mouseX - ringX) * k;
    ringY += (mouseY - ringY) * k;
    // Caught up: snap and stop the loop (mousemove restarts it) instead of repainting every frame.
    const settled = Math.abs(mouseX - ringX) < 0.1 && Math.abs(mouseY - ringY) < 0.1;
    if (settled) { ringX = mouseX; ringY = mouseY; lastStep = 0; }
    cursorRing.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
    followRAF = settled ? 0 : requestAnimationFrame(followStep);
  }
  // Hover work is batched to one layout read + one write per frame, however fast the mouse reports.
  let pendingEl = null, hoverRAF = 0;
  function hoverStep() {
    hoverRAF = 0;
    if (!annotateMode || !pendingEl) return;
    if (root.contains(pendingEl)) hideHighlight();
    else if (hoveredEl !== pendingEl) { hoveredEl = pendingEl; showHighlight(pendingEl); }
  }

  function enterMarkMode() {
    placeRoot();
    annotateMode = true;
    modeBtn.classList.add('active');
    modeBtn.setAttribute('aria-pressed', 'true');
    modeBtn.title = 'Inspecting… click an element to comment on it (Esc to stop)';
    toast('Inspect Mode: click any element, or Tab to one and press Enter. Esc to stop.');
    document.documentElement.classList.add('dn-marking');
    markUI.classList.add('active');
    ringX = mouseX; ringY = mouseY;
    cancelAnimationFrame(followRAF);
    followRAF = requestAnimationFrame(followStep);
  }
  function exitMarkMode() {
    annotateMode = false;
    repinTarget = null;
    modeBtn.classList.remove('active');
    modeBtn.setAttribute('aria-pressed', 'false');
    modeBtn.title = MARK_TITLE;
    document.documentElement.classList.remove('dn-marking');
    markUI.classList.remove('active');
    cancelAnimationFrame(followRAF);
    cancelAnimationFrame(hoverRAF);
    followRAF = hoverRAF = lastStep = 0;
    pendingEl = null;
    hideHighlight();
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      if (!annotateMode) return;
      mouseX = e.clientX;
      mouseY = e.clientY;
      pendingEl = e.target;
      if (!followRAF) followRAF = requestAnimationFrame(followStep);
      if (!hoverRAF) hoverRAF = requestAnimationFrame(hoverStep);
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    // One Escape = leave Mark mode only (don't also close the sidebar underneath)
    if (annotateMode && e.key === 'Escape') { exitMarkMode(); e.stopPropagation(); }
  }, true);

  // Keyboard marking: Tab to an element and press Enter (its click is caught below) — show what's targeted
  document.addEventListener('focusin', (e) => {
    if (annotateMode && !root.contains(e.target)) { hoveredEl = e.target; showHighlight(e.target); }
  }, true);

  document.addEventListener(
    'click',
    (e) => {
      if (!annotateMode) return;
      if (root.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      const r = el.getBoundingClientRect();
      // Document coordinates, fixed now — the user may scroll while typing the note.
      const rect = { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
      const repin = repinTarget;
      exitMarkMode();
      if (repin) return repinAnnotation(repin, el, rect);
      lockHighlight(el);
      openForm(el, { x: e.pageX, y: e.pageY, rect });
    },
    true
  );

  // ---------- Category management ----------
  // One list for every page, edited in Settings (add / rename / delete) or grown from the
  // form's "+ New". Default is a single "UI" category. Notes keep whatever type string they
  // were saved with, so legacy preset types (text|suggestion|bug|note) still display.
  const DEFAULT_CATEGORIES = ['UI'];
  let categoryList = DEFAULT_CATEGORIES.slice();
  chrome.storage.local.get('dn_categories', (res) => {
    if (Array.isArray(res.dn_categories) && res.dn_categories.length) categoryList = res.dn_categories;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.dn_categories) return;
    const v = changes.dn_categories.newValue;
    categoryList = Array.isArray(v) && v.length ? v : DEFAULT_CATEGORIES.slice();
  });

  // Legacy preset types keep their palette colour (getTypeColor); they're no longer offered.
  const PRESET_TYPES = ['text', 'suggestion', 'bug', 'note'];
  // A typed name that matches an existing category case-insensitively uses that spelling
  function normalizeCategory(name, list) {
    const key = (name || '').toLowerCase();
    return list.find((c) => c.toLowerCase() === key) || name;
  }
  function categoryPillsHtml(categories, selectedType) {
    const sel = (selectedType || '').toLowerCase();
    return categories.map((cat) => `
      <button type="button" class="dn-type-pill ${cat.toLowerCase() === sel ? 'selected' : ''}" data-type="${escapeHtml(cat)}" style="--type-color: ${getTypeColor(cat)}">${escapeHtml(typeLabel(cat))}</button>
    `).join('');
  }
  function addCategory(name) {
    if (categoryList.some((c) => c.toLowerCase() === name.toLowerCase())) return;
    categoryList = categoryList.concat(name);
    chrome.storage.local.set({ dn_categories: categoryList });
  }

  // ---------- Send to an AI agent ----------
  // A note can go to one AI tool connected through the bridge (Settings → Connect to AI agents);
  // that tool reads it with get_my_annotations. The row only appears while an agent is connected.
  // Logos are icons/agents/<id>.svg, single colour, drawn as a mask; unknown tools get the generic one.
  const AGENT_ICONS = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'windsurf', 'gemini', 'cline', 'zed', 'opencode', 'copilot'];
  function agentIconHtml(agent) {
    const id = AGENT_ICONS.includes(agent.id) ? agent.id : 'agent';
    return `<span class="dn-agent-ico" data-agent="${id}" aria-hidden="true" style="--icon:url('${chrome.runtime.getURL(`icons/agents/${id}.svg`)}')"></span>`;
  }
  function getAgents(cb) {
    if (!extensionAlive()) return cb([]);
    chrome.runtime.sendMessage({ type: 'GET_AGENTS' }, (res) => {
      if (chrome.runtime.lastError) return cb([]);
      cb((res && res.agents) || []);
    });
  }
  // Toggle buttons, at most one pressed. `current` (the note's agent) is listed even if it's offline.
  function agentPickerHtml(agents, current) {
    const list = agents.slice();
    if (current && !list.some((ag) => ag.id === current.id)) list.push(current);
    if (!list.length) return '';
    return `<div class="dn-agent-picker" role="group" aria-label="Send to an AI agent">
      ${list.map((ag) => `<button type="button" class="dn-agent-pill" aria-pressed="${!!current && current.id === ag.id}" data-agent-id="${escapeHtml(ag.id)}" data-agent-name="${escapeHtml(ag.name)}" title="${agents.includes(ag) ? '' : 'Not connected right now. '}Send this note to ${escapeHtml(ag.name)}">${agentIconHtml(ag)}${escapeHtml(ag.name)}</button>`).join('')}
    </div>`;
  }
  function bindAgentPicker(form) {
    form.querySelectorAll('.dn-agent-pill').forEach((pill) => pill.addEventListener('click', () => {
      const on = pill.getAttribute('aria-pressed') !== 'true';
      form.querySelectorAll('.dn-agent-pill').forEach((p) => p.setAttribute('aria-pressed', 'false'));
      pill.setAttribute('aria-pressed', String(on));
    }));
  }
  function pickedAgent(form) {
    const p = form.querySelector('.dn-agent-pill[aria-pressed="true"]');
    return p ? { id: p.dataset.agentId, name: p.dataset.agentName } : null;
  }

  // ---------- Smart positioning for popup ----------
  function calculatePopupPosition(pos, formWidth, formHeight) {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const padding = 12;
    const sbW = sidebarOpen ? sidebar.getBoundingClientRect().width + 16 : 0; // keep clear of the open sidebar

    // Beside the element (right, then left, then below, then above) so it stays visible
    if (pos.rect) {
      const r = pos.rect;
      const fitsX = (l) => l >= scrollX + padding && l + formWidth <= scrollX + viewportW - padding - sbW;
      const fitsY = (t) => t >= scrollY + padding && t + formHeight <= scrollY + viewportH - padding;
      const clampX = (l) => Math.max(scrollX + padding, Math.min(scrollX + viewportW - formWidth - padding - sbW, l));
      const clampY = (t) => Math.max(scrollY + padding, Math.min(scrollY + viewportH - formHeight - padding, t));
      const right = r.left + r.width + 48, leftSide = r.left - formWidth - 48; // 48px: room for the connector
      const below = r.top + r.height + 48, above = r.top - formHeight - 48; // clear of the size/selector chips
      let spot = null;
      if (fitsX(right)) spot = { left: right, top: clampY(r.top) };
      else if (fitsX(leftSide)) spot = { left: leftSide, top: clampY(r.top) };
      else if (fitsY(below)) spot = { left: clampX(r.left), top: below };
      else if (fitsY(above)) spot = { left: clampX(r.left), top: above };
      if (spot) return { left: Math.round(spot.left), top: Math.round(spot.top) };
    }

    // Fallback: right of the click point
    let left = pos.x + 12;
    let top = pos.y - formHeight / 2;
    
    // Check right edge
    if (left + formWidth > scrollX + viewportW - padding) {
      left = pos.x - formWidth - 12; // Place to the left
    }
    // Check left edge
    if (left < scrollX + padding) {
      left = scrollX + padding;
    }
    
    // Check bottom edge
    if (top + formHeight > scrollY + viewportH - padding) {
      top = scrollY + viewportH - formHeight - padding;
    }
    // Check top edge
    if (top < scrollY + padding) {
      top = scrollY + padding;
    }
    
    return { left: Math.round(left), top: Math.round(top) };
  }

  // ---------- Popup form: the one-line composer ----------
  // Category chip · note · Esc · Save, a caption underneath. It attaches to the picked element with a
  // connector and lights up while there's text. Category only: no attachments, no "send to" (that's on the note).
  const formLink = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  formLink.id = 'dn-form-link';
  formLink.setAttribute('aria-hidden', 'true');
  formLink.setAttribute('hidden', '');
  formLink.innerHTML = '<path d=""/><rect class="dn-link-node" width="8" height="8" rx="2"/><circle class="dn-link-tip" r="4"/>';
  root.appendChild(formLink);

  // Renames a category in the list and on every saved note (any page), like Settings → Categories.
  function renameCategoryEverywhere(old, name, done) {
    const key = old.toLowerCase();
    const inList = categoryList.some((c) => c.toLowerCase() === key);
    categoryList = inList ? categoryList.map((c) => (c.toLowerCase() === key ? name : c)) : categoryList.concat(name);
    chrome.storage.local.get(null, (all) => {
      const updates = { dn_categories: categoryList };
      for (const [k, list] of Object.entries(all)) {
        if (!k.startsWith(STORAGE_PREFIX) || !Array.isArray(list)) continue;
        if (!list.some((a) => (a.type || '').toLowerCase() === key)) continue;
        updates[k] = list.map((a) => ((a.type || '').toLowerCase() === key ? { ...a, type: name } : a));
      }
      chrome.storage.local.set(updates, () => {
        if (chrome.runtime.lastError) return toast('Rename failed: ' + chrome.runtime.lastError.message);
        refreshAfterChange();
        done && done();
      });
    });
  }

  function openForm(el, pos) {
    placeRoot();
    const existing = root.querySelector('#designnote-popup-form');
    if (existing) existing._dispose();
    root.querySelectorAll('.dn-toast:not(:has(.dn-toast-action))').forEach((t) => t.remove()); // the Inspect hint is stale now (Undo toasts stay)

    const categories = categoryList.slice();
    let current = categories[0] || 'UI'; // the first category is preselected

    const form = document.createElement('div');
    form.id = 'designnote-popup-form';
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', el ? 'New annotation' : 'New general note');
    const opener = document.activeElement; // focus goes back here when the form closes

    // The category menu is always closed on open and only opens from the chip's arrow. The first category is what Enter saves.
    form.innerHTML = `
      <div class="dn-form-row">
        <span class="dn-cat-chip" id="dn-cat-chip" style="--type-color:${getTypeColor(current)}"><span class="dn-cat-name" data-tip="Double-click to rename this category">${escapeHtml(typeLabel(current))}</span><button type="button" class="dn-cat-toggle" id="dn-cat-toggle" aria-label="Choose a category" aria-haspopup="true" aria-expanded="false" aria-controls="dn-type-picker" data-tip="Choose or add a category">${dnIcon('chevronDown')}</button></span>
        <input type="text" class="dn-cat-rename" id="dn-cat-rename" aria-label="Rename category" maxlength="24" hidden />
        <textarea id="dn-text-input" rows="1" aria-label="Annotation text" placeholder="What should change here?"></textarea>
        <div class="dn-form-actions dn-actions-only">
          <button type="button" class="dn-form-cancel" aria-label="Cancel" data-tip="Cancel and discard this note (Esc)">${dnIcon('x')}</button>
          <button type="button" class="dn-form-save" aria-label="Save annotation" aria-disabled="true" data-tip="Write a note first, then save it (Enter)">${dnIcon('arrowRight')}</button>
        </div>
      </div>
      <div class="dn-cat-menu" id="dn-type-picker" hidden>
        <div class="dn-type-picker">
          ${categoryPillsHtml(categories, current)}
          <button type="button" class="dn-type-pill dn-new-category" id="dn-new-category-btn" aria-label="New category" data-tip="Add a new category">${dnIcon('plus')}</button>
        </div>
        <div class="dn-category-input-wrapper" id="dn-category-input-wrapper" style="display:none;">
          <input type="text" id="dn-custom-category-input" aria-label="New category name" placeholder="Category name (e.g. Bug, Copy, Layout)" />
        </div>
        <button type="button" class="dn-cat-rename-btn" id="dn-cat-rename-btn">Rename “${escapeHtml(typeLabel(current))}”</button>
      </div>
      <div class="dn-form-cap"><span class="dn-form-sel"></span><span class="dn-form-hint">⇧↵ new line</span><div class="dn-form-agents" id="dn-form-agents" role="group" aria-label="Send to an AI agent" hidden></div></div>
    `;
    root.appendChild(form);

    const $ = (s) => form.querySelector(s);
    const textarea = $('#dn-text-input');
    const saveBtn = $('.dn-form-save');
    const cancelBtn = $('.dn-form-cancel');
    const chip = $('#dn-cat-chip');
    const toggle = $('#dn-cat-toggle');
    const agentRow = $('#dn-form-agents');
    const menu = $('#dn-type-picker');
    const renameInput = $('#dn-cat-rename');

    const where = el
      ? `› ${describe(el)}${pos.rect ? ` · ${Math.round(pos.rect.width)}×${Math.round(pos.rect.height)}` : ''}`
      : 'General note · no location';
    $('.dn-form-sel').textContent = where;
    loadAnnotations((l) => { $('.dn-form-sel').textContent = `${where} · #${String(l.length + 1).padStart(2, '0')}`; });

    // ── Attach: connector from the element to the form, drawn in on open, following scroll ──
    const linkPath = formLink.querySelector('path');
    const linkNode = formLink.querySelector('.dn-link-node');
    const linkTip = formLink.querySelector('.dn-link-tip');
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let side = 'r', detached = false;
    function updateLink(animate) {
      if (detached || !el || !el.isConnected) { formLink.setAttribute('hidden', ''); return; }
      const r = el.getBoundingClientRect(), f = form.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { formLink.setAttribute('hidden', ''); return; }
      side = f.left >= r.right + 8 ? 'r' : f.right <= r.left - 8 ? 'l' : f.top >= r.bottom + 8 ? 'b' : 't';
      let ax, ay, bx, by, d;
      if (side === 'r' || side === 'l') {
        by = f.top + 21;
        ax = side === 'r' ? r.right + 6 : r.left - 6;
        ay = clamp(by, r.top + 8, r.bottom - 8);
        bx = side === 'r' ? f.left : f.right;
        const mx = Math.round((ax + bx) / 2);
        d = `M${ax} ${ay}H${mx}V${by}H${bx}`;
      } else {
        bx = f.left + 24;
        ax = clamp(bx, r.left + 8, r.right - 8);
        ay = side === 'b' ? r.bottom + 6 : r.top - 6;
        by = side === 'b' ? f.top : f.bottom;
        const my = Math.round((ay + by) / 2);
        d = `M${ax} ${ay}V${my}H${bx}V${by}`;
      }
      linkPath.setAttribute('d', d);
      linkNode.setAttribute('x', ax - 4); linkNode.setAttribute('y', ay - 4);
      linkTip.setAttribute('cx', bx); linkTip.setAttribute('cy', by);
      formLink.removeAttribute('hidden');
      if (animate && !motionReduced()) {
        const len = linkPath.getTotalLength();
        linkPath.style.strokeDasharray = len;
        linkPath.style.strokeDashoffset = len;
        formLink.classList.remove('dn-draw');
        void formLink.getBoundingClientRect(); // commit the hidden start state before transitioning
        formLink.classList.add('dn-draw');
        linkPath.style.strokeDashoffset = '0';
        setTimeout(() => { linkPath.style.strokeDasharray = ''; linkPath.style.strokeDashoffset = ''; formLink.classList.remove('dn-draw'); }, 320);
      }
    }
    let moveRAF = 0;
    const onMove = () => { if (!moveRAF) moveRAF = requestAnimationFrame(() => { moveRAF = 0; updateLink(false); }); };
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove, { passive: true });

    // Placed beside the element once (document coordinates, fixed now); later height changes only keep it on screen.
    const placeForm = () => {
      const fr = form.getBoundingClientRect();
      const sp = calculatePopupPosition(pos, fr.width, fr.height);
      form.style.left = (sp.left - window.scrollX) + 'px';
      form.style.top = (sp.top - window.scrollY) + 'px';
    };
    const keepOnScreen = () => {
      const r = form.getBoundingClientRect();
      const over = r.bottom - (window.innerHeight - 12);
      if (over > 0) form.style.top = Math.max(12, r.top - over) + 'px';
      updateLink(false);
    };

    // ── Writing state: the whole composer lights up; Save is only "ready" with text ──
    const syncWriting = () => {
      const has = !!textarea.value.trim();
      form.classList.toggle('dn-writing', has);
      markUI.classList.toggle('dn-writing', has);
      formLink.classList.toggle('dn-writing', has);
      saveBtn.setAttribute('aria-disabled', String(!has));
      saveBtn.dataset.tip = has ? 'Save the note to the sidebar (Enter)' : 'Write a note first, then save it (Enter)';
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(140, textarea.scrollHeight + 2) + 'px';
      keepOnScreen();
    };
    textarea.addEventListener('input', syncWriting);
    textarea.addEventListener('keydown', (e) => submitOnEnter(e, saveBtn));

    // ── Category: chip + menu; pick, add, rename ──
    const setCurrent = (name) => {
      current = name;
      chip.style.setProperty('--type-color', getTypeColor(name));
      chip.querySelector('.dn-cat-name').textContent = typeLabel(name);
      $('#dn-cat-rename-btn').textContent = `Rename “${typeLabel(name)}”`;
    };
    const setMenu = (open) => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      keepOnScreen();
    };
    toggle.addEventListener('click', () => setMenu(menu.hidden));
    const selectPill = (pill) => {
      form.querySelectorAll('.dn-type-pill').forEach((b) => b.classList.remove('selected'));
      pill.classList.add('selected');
      $('#dn-category-input-wrapper').style.display = 'none';
      if (pill.dataset.type) setCurrent(pill.dataset.type);
      setMenu(false);
      textarea.focus();
    };
    const bindPill = (pill) => pill.addEventListener('click', () => selectPill(pill));
    form.querySelectorAll('.dn-type-pill:not(.dn-new-category)').forEach(bindPill);

    $('#dn-new-category-btn').addEventListener('click', () => {
      form.querySelectorAll('.dn-type-pill').forEach((b) => b.classList.remove('selected'));
      $('#dn-new-category-btn').classList.add('selected');
      const wrapper = $('#dn-category-input-wrapper');
      wrapper.style.display = 'block';
      wrapper.querySelector('input').focus();
      keepOnScreen();
    });
    // Custom category input: Enter confirms
    $('#dn-custom-category-input').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const customType = normalizeCategory(e.target.value.trim(), categories);
      // Already offered: select it, don't duplicate
      const existingPill = customType && Array.from(form.querySelectorAll('.dn-type-pill:not(.dn-new-category)'))
        .find((b) => b.dataset.type === customType);
      if (existingPill) {
        e.target.value = '';
        existingPill.click();
      } else if (customType) {
        const newPill = document.createElement('button');
        newPill.type = 'button';
        newPill.className = 'dn-type-pill';
        newPill.dataset.type = customType;
        newPill.style.setProperty('--type-color', getTypeColor(customType));
        newPill.textContent = customType;
        $('.dn-type-picker').insertBefore(newPill, $('#dn-new-category-btn'));
        categories.push(customType);
        addCategory(customType);
        bindPill(newPill);
        selectPill(newPill);
        e.target.value = '';
      }
    });

    // Rename: double-click the chip, or "Rename" in the menu. Changes every note in that category.
    const startRename = () => {
      if (!renameInput.hidden) return;
      setMenu(false);
      chip.hidden = true;
      renameInput.hidden = false;
      renameInput.value = current;
      renameInput.focus();
      renameInput.select();
    };
    const endRename = (save) => {
      if (renameInput.hidden) return; // blur fires again as the input is hidden
      const old = current, name = renameInput.value.trim();
      renameInput.hidden = true;
      chip.hidden = false;
      if (save && name && name !== old) {
        const taken = categories.some((c) => c.toLowerCase() === name.toLowerCase() && c.toLowerCase() !== old.toLowerCase());
        if (taken) toast(`“${name}” already exists.`);
        else renameCategoryEverywhere(old, name, () => {
          const i = categories.findIndex((c) => c.toLowerCase() === old.toLowerCase());
          if (i >= 0) categories[i] = name;
          form.querySelectorAll('.dn-type-pill:not(.dn-new-category)').forEach((p) => {
            if ((p.dataset.type || '').toLowerCase() !== old.toLowerCase()) return;
            p.dataset.type = name;
            p.textContent = typeLabel(name);
            p.style.setProperty('--type-color', getTypeColor(name));
          });
          setCurrent(name);
          toast(`Renamed ${old} to ${name}`);
        });
      }
      if (form.isConnected) textarea.focus({ preventScroll: true });
    };
    $('.dn-cat-name').addEventListener('dblclick', startRename);
    $('#dn-cat-rename-btn').addEventListener('click', startRename);
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); endRename(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(false); }
    });
    renameInput.addEventListener('blur', () => endRename(true));

    // ── Active AI agents: one icon each at the right end of the caption line, at most one picked; the note is sent to it on save ──
    getAgents((agents) => {
      if (!agents.length || !form.isConnected) return;
      agentRow.innerHTML = agents.map((ag) => `<button type="button" class="dn-act dn-act-sm" data-act="agent" aria-pressed="false" data-agent-id="${escapeHtml(ag.id)}" data-agent-name="${escapeHtml(ag.name)}" aria-label="Send to ${escapeHtml(ag.name)}" data-tip="Send to ${escapeHtml(ag.name)} when you save">${agentIconHtml(ag)}</button>`).join('');
      agentRow.hidden = false;
      agentRow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        agentRow.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(on));
      }));
      keepOnScreen();
    });

    // ── Open: lock the highlight on the element, place, draw the connector, then animate in ──
    placeForm();
    form.style.transform = 'none'; // measure the connector at the form's resting place, not mid slide-in
    updateLink(true);
    form.style.transform = '';
    form.style.setProperty('--dn-dx', side === 'r' ? '8px' : side === 'l' ? '-8px' : '0px');
    form.style.setProperty('--dn-dy', side === 'b' ? '8px' : side === 't' ? '-8px' : '6px');
    requestAnimationFrame(() => form.classList.add('open'));
    textarea.focus();

    const detach = () => {
      detached = true; // a frame already queued by onMove must not redraw the connector
      cancelAnimationFrame(moveRAF);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      formLink.setAttribute('hidden', '');
      formLink.classList.remove('dn-writing');
      markUI.classList.remove('dn-writing');
    };
    form._dispose = () => {
      document.removeEventListener('keydown', escHandler);
      document.removeEventListener('click', outsideClickHandler);
      detach();
      unlockHighlight();
      form.remove();
    };
    function closeForm(then) {
      document.removeEventListener('keydown', escHandler);
      document.removeEventListener('click', outsideClickHandler);
      detach();
      unlockHighlight();
      form.classList.remove('open');
      setTimeout(() => {
        form.remove();
        if (then) then();
        if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
      }, 180);
    }
    cancelBtn.addEventListener('click', () => { cancelBtn.classList.add('dn-hit'); closeForm(); });

    // Save: reads the text as it is now (not the button's look), so Enter/click with nothing typed just nudges
    let saving = false;
    saveBtn.addEventListener('click', () => {
      if (saving) return;
      const selectedPill = form.querySelector('.dn-type-pill.selected');
      let type = selectedPill ? selectedPill.dataset.type : null;
      if (!type) {
        // "+ New" is selected but its name was never confirmed with Enter: use the typed value
        const pending = normalizeCategory($('#dn-custom-category-input').value.trim(), categories);
        if (pending) {
          type = pending;
          addCategory(pending);
        }
      }
      const text = textarea.value.trim();
      if (!type) {
        toast('Please choose or enter a category.');
        setMenu(true);
        $('#dn-custom-category-input').focus();
        return;
      }
      if (!text) {
        toast('Please add a comment before saving.');
        form.classList.remove('dn-shake');
        void form.offsetWidth;
        form.classList.add('dn-shake');
        textarea.focus();
        return;
      }
      saving = true;
      saveBtn.classList.add('dn-hit');
      const pickedAgentBtn = agentRow.querySelector('[aria-pressed="true"]');
      const agent = pickedAgentBtn ? { id: pickedAgentBtn.dataset.agentId, name: pickedAgentBtn.dataset.agentName } : null;
      closeForm(() => saveNewAnnotation(el, type, text, pos.rect, agent));
    });

    // Esc closes the innermost layer first: category menu, then the form
    const escHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (!menu.hidden) { setMenu(false); toggle.focus(); return; }
      cancelBtn.classList.add('dn-hit');
      closeForm();
    };
    document.addEventListener('keydown', escHandler);
    const outsideClickHandler = (e) => { if (!form.contains(e.target)) closeForm(); };
    setTimeout(() => document.addEventListener('click', outsideClickHandler), 0);
  }

  // Consistent colour per category. Theme-aware via tokens, so labels and the numbers drawn on these colours keep their contrast
  // in light and dark mode. Only used in-page (exports don't call it).
  function getTypeColor(type) {
    const key = (type || '').toLowerCase();
    if (PRESET_TYPES.includes(key)) return `var(--dn-type-${key}-text)`;
    let hash = 0;
    for (let i = 0; i < type.length; i++) hash = ((hash << 5) - hash) + type.charCodeAt(i);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 65% var(--dn-type-custom-l))`;
  }

  // rect: the element's box in document coordinates at click time (null for general notes).
  function saveNewAnnotation(el, type, text, rect, agent) {
    const selectorData = el ? window.__designNoteGetSelectorWithFingerprint(el) : { selector: null, fingerprint: null, anchor: null };
    const annotation = {
      id: uid(),
      type,
      text,
      selector: selectorData.selector,
      fingerprint: selectorData.fingerprint,
      anchor: selectorData.anchor, // readable "button "Pay now" in form …" for people and AI agents
      pageTitle: document.title.slice(0, 120),
      rect: rect || null,
      screenshot: null,
      timestamp: Date.now(),
    };
    if (agent) annotation.assignee = agent; // { id, name }: the AI tool this note was sent to

    const finish = (message = agent ? `Annotation sent to ${agent.name}` : 'Annotation saved') => {
      loadAnnotations((list) => {
        annotations = list.concat([annotation]);
        saveAnnotations(() => {
          toast(message);
          if (sidebarOpen) renderSidebar();
        });
      });
    };

    if (!rect) {
      finish();
      return;
    }

    visibleCropRect(el, rect, (cropRect) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (res) => {
        // Reading lastError also keeps Chrome from logging it as unchecked
        const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : res && res.error;
        if (res && res.dataUrl) {
          cropScreenshot(res.dataUrl, cropRect, (croppedDataUrl) => {
            annotation.screenshot = croppedDataUrl;
            finish();
          });
        } else {
          finish('Annotation saved without a screenshot' + (err ? ` (${err})` : '') + '.');
        }
      });
    });
  }

  // Viewport box to crop, measured at capture time (the form was open in between, so the
  // page may have scrolled). Scrolls the element back into view if needed and clips to the
  // viewport: captureVisibleTab only sees the visible area, so very tall elements are cut off.
  function visibleCropRect(el, docRect, cb) {
    const clip = (r) => {
      const left = Math.max(0, r.left);
      const top = Math.max(0, r.top);
      const right = Math.min(window.innerWidth, r.left + r.width);
      const bottom = Math.min(window.innerHeight, r.top + r.height);
      return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
    };
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) {
        if (r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth) return cb(clip(r));
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        requestAnimationFrame(() => requestAnimationFrame(() => cb(clip(el.getBoundingClientRect()))));
        return;
      }
    }
    // Element gone: fall back to where it was when clicked
    cb(clip({ top: docRect.top - window.scrollY, left: docRect.left - window.scrollX, width: docRect.width, height: docRect.height }));
  }

  function cropScreenshot(dataUrl, rect, cb) {
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        Math.round(rect.left * dpr),
        Math.round(rect.top * dpr),
        w,
        h,
        0,
        0,
        w,
        h
      );
      cb(canvas.toDataURL('image/png'));
    };
    img.onerror = () => cb(dataUrl);
    img.src = dataUrl;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_SIDEBAR_OPEN') {
      showSidebar();
    }
    if (msg.type === 'TOGGLE_SIDEBAR') { // keyboard shortcut: a real toggle
      sidebarOpen ? hideSidebar() : showSidebar();
    }
    if (msg.type === 'GET_ANNOTATION_COUNT') {
      loadAnnotations((list) => sendResponse({ count: list.length }));
      return true;
    }
    if (msg.type === 'SHOW_PILL') {
      pillState.closed = false;
      applyPillState(pillState);
      savePillState();
    }
    if (msg.type === 'TOGGLE_PILL') {
      pillState.closed = !pillState.closed;
      applyPillState(pillState);
      savePillState();
    }
    if (msg.type === 'TOGGLE_MARK_MODE') {
      annotateMode ? exitMarkMode() : enterMarkMode();
    }
    if (msg.type === 'JUMP_TO_ANNOTATION') { // AI agent: show_annotation
      loadAnnotations((list) => {
        const a = list.find((x) => x.id === msg.id);
        if (a) jumpToAnnotation(a);
      });
    }
  });

  // Notes changed outside this tab (an AI agent resolved/replied/added, or another tab): refresh.
  const listSignature = (list) => (list || []).map((a) => `${a.id}:${a.updatedAt || a.timestamp}:${a.status || ''}`).join();
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = area === 'local' && changes[pageKey()];
    if (!change || !extensionAlive() || listSignature(change.newValue) === listSignature(annotations)) return;
    annotations = change.newValue || [];
    updateBadge(annotations);
    if (sidebarOpen) renderSidebar();
    if (tableOverlay.classList.contains('open')) renderTableView();
  });

  // ---------- Domain grouping helpers ----------
  function extractMainDomain(url) {
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
    } catch { return url; }
  }

  function loadAllAnnotations(cb) {
    chrome.storage.local.get(null, (res) => {
      const all = Object.entries(res)
        .filter(([k]) => k.startsWith('dn_annotations::'))
        .flatMap(([k, v]) => (v || []).map(a => ({ ...a, pageUrl: k.replace('dn_annotations::', '') })))
        .sort((a, b) => b.timestamp - a.timestamp);
      cb(all);
    });
  }

  function groupByDomain(annotations) {
    const groups = {};
    for (const a of annotations) {
      const domain = extractMainDomain(a.pageUrl);
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(a);
    }
    return groups;
  }

  // ---------- React to in-page (SPA) navigation ----------
  // Annotations are keyed per URL (hash stripped) and never auto-cleared — each page
  // keeps its own set in chrome.storage.local until you delete an entry. On a full page
  // load the content script re-inits and this is moot; but a SPA route change swaps the
  // page without a reload, so we watch for the URL changing and refresh the badge + any
  // open panels to the exact page you're now on (otherwise they show the old page's list).
  // history.pushState can't be hooked from a content script's isolated world, so poll.
  // ponytail: 600ms location poll, swap for the Navigation API once it's reliable in content scripts.
  let lastPageKey = pageKey();
  function refreshOnNavigate() {
    placeRoot();
    if (pageKey() === lastPageKey) return;
    if (!extensionAlive()) return clearInterval(navPoll); // orphaned after an update
    lastPageKey = pageKey();
    loadAnnotations((list) => {
      updateBadge(list);
      if (sidebarOpen) renderSidebar();
      if (tableOverlay.classList.contains('open')) renderTableView();
    });
  }
  window.addEventListener('popstate', refreshOnNavigate);
  const navPoll = setInterval(refreshOnNavigate, 600);

  // ---------- init ----------
  loadPillState((state) => {
    applyPillState(state);
    loadAnnotations();
  });
})();
