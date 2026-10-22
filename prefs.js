// Appearance preferences (Settings → dn_appearance), shared by content.js (applies them to
// #designnote-root) and theme.js (to <html> on extension pages). Loaded before both.
// Tokens stay in design-tokens.css: this only sets data-dn-* attributes and, for a custom
// accent, inline --dn-accent-* overrides derived from the chosen colour.
(function () {
  const DEFAULTS = {
    accent: '#00e5ff',
    radius: 'rounded', // 'sharp' | 'rounded' | 'round'
    glass: 'frosted',  // 'frosted' | 'glass' | 'liquid' | 'solid' (in-page panels only)
    text: 'default',   // 'default' | 'large'
    font: 'mono',      // 'mono' | 'sans' (labels and controls)
    motion: 'system',  // 'system' | 'reduce'
    pins: 'show',      // 'show' | 'hide' (numbered markers on the page)
    notes: 'accent',   // 'accent' | 'category' (colour of note numbers and page pins)
  };
  const PRESETS = [
    { name: 'Cyan', hex: '#00e5ff' },
    { name: 'Lime', hex: '#c6f432' },
    { name: 'Orange', hex: '#ff7a1a' },
    { name: 'Pink', hex: '#ff4fd8' },
    { name: 'Violet', hex: '#a78bfa' },
    { name: 'White', hex: '#f2f2f2' },
  ];
  const ACCENT_PROPS = ['--dn-accent', '--dn-accent-hover', '--dn-accent-text', '--dn-accent-contrast',
    '--dn-accent-ring', '--dn-accent-subtle', '--dn-accent-glow'];
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  function parseHex(hex) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const rgba = (c, a) => `rgba(${c.map(Math.round).join(', ')}, ${a})`;
  function luminance(c) {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  // Nudge c toward `to` until it reads at `ratio` against bg.
  function readable(c, bg, to, ratio) {
    for (let t = 0; t <= 1; t += 0.04) {
      const m = mix(c, to, t);
      if (contrast(m, bg) >= ratio) return m;
    }
    return to;
  }

  function normalizeHex(hex) {
    const c = parseHex(hex);
    return c ? toHex(c) : null;
  }

  // Accent tokens for a custom colour, or null for the default (design-tokens.css already has it).
  // Text/icon accent is checked against the worst-case surface: dark glass over a white page,
  // light glass over a black one.
  function accentTokens(hex, light) {
    const c = parseHex(hex);
    if (!c || toHex(c) === DEFAULTS.accent) return null;
    const ink = mix(c, BLACK, 0.86);
    const onFill = contrast(ink, c) >= contrast(WHITE, c) ? ink : WHITE;
    const hover = onFill === WHITE ? mix(c, BLACK, 0.15) : mix(c, WHITE, 0.3);
    const text = light ? readable(c, [220, 220, 220], BLACK, 4.5) : readable(c, [41, 41, 43], WHITE, 4.5);
    return {
      '--dn-accent': toHex(c),
      '--dn-accent-hover': toHex(hover),
      '--dn-accent-text': toHex(text),
      '--dn-accent-contrast': toHex(onFill),
      '--dn-accent-ring': light ? rgba(text, 0.45) : rgba(c, 0.38),
      '--dn-accent-subtle': rgba(c, light ? 0.12 : 0.10),
      '--dn-accent-glow': `0 0 ${light ? 14 : 18}px ${rgba(c, light ? 0.30 : 0.28)}`,
    };
  }

  function resolve(appearance) {
    const a = { ...DEFAULTS, ...(appearance || {}) };
    a.accent = normalizeHex(a.accent) || DEFAULTS.accent;
    return a;
  }

  const attr = (key) => 'dn' + key[0].toUpperCase() + key.slice(1);

  function apply(el, appearance, light) {
    const a = resolve(appearance);
    for (const key of Object.keys(DEFAULTS)) {
      if (key === 'accent') continue;
      if (a[key] === DEFAULTS[key]) delete el.dataset[attr(key)];
      else el.dataset[attr(key)] = a[key];
    }
    const tokens = accentTokens(a.accent, light);
    ACCENT_PROPS.forEach((p) => el.style.removeProperty(p));
    if (tokens) for (const [p, v] of Object.entries(tokens)) el.style.setProperty(p, v);
  }

  // Rules for host-page elements outside #designnote-root (the Inspect cursor and the
  // jump-to outline), which can't inherit the root's inline tokens. '' for the default.
  function hostCss(appearance) {
    const a = resolve(appearance);
    if (a.accent === DEFAULTS.accent) return '';
    const c = encodeURIComponent(a.accent);
    const svg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round'%3E%3Cpath d='M12 3v6M12 15v6M3 12h6M15 12h6' stroke='%230b0b0b' stroke-width='4'/%3E%3Cpath d='M12 3v6M12 15v6M3 12h6M15 12h6' stroke='${c}' stroke-width='2'/%3E%3Ccircle cx='12' cy='12' r='1.6' fill='${c}' stroke='%230b0b0b'/%3E%3C/svg%3E`;
    return `html.dn-marking, html.dn-marking * { cursor: url("${svg}") 12 12, crosshair !important; }\n` +
      `html .dn-jump-highlight { outline-color: ${a.accent} !important; }`;
  }

  globalThis.__dnPrefs = { DEFAULTS, PRESETS, normalizeHex, contrast, parseHex, resolve, apply, hostCss };
})();
