document.addEventListener('DOMContentLoaded', () => {
  const providerEl = document.getElementById('provider');
  const apiKeyEl = document.getElementById('apiKey');
  const statusEl = document.getElementById('status');

  const modelEl = document.getElementById('model');
  // Mirrors the defaults in background.js AI_PROVIDERS
  const DEFAULT_MODELS = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o-mini', openrouter: 'anthropic/claude-sonnet-4.5' };
  const showDefaultModel = () => { modelEl.placeholder = 'Default: ' + DEFAULT_MODELS[providerEl.value]; };
  providerEl.addEventListener('change', showDefaultModel);

  chrome.storage.local.get(['dn_provider', 'dn_api_key', 'dn_model'], (res) => {
    if (res.dn_provider) providerEl.value = res.dn_provider;
    if (res.dn_api_key) apiKeyEl.value = res.dn_api_key;
    if (res.dn_model) modelEl.value = res.dn_model;
    showDefaultModel();
  });

  // Appearance applies immediately (theme.js on every page listens for dn_theme changes)
  const themeInputs = document.querySelectorAll('input[name="theme"]');
  chrome.storage.local.get('dn_theme', (res) => {
    const pref = res.dn_theme || 'dark';
    themeInputs.forEach((i) => { i.checked = i.value === pref; });
  });
  themeInputs.forEach((i) => i.addEventListener('change', () => {
    if (i.checked) chrome.storage.local.set({ dn_theme: i.value });
  }));

  // ---------- Accent colour + display preferences (dn_appearance; prefs.js applies them on every surface) ----------
  const P = window.__dnPrefs;
  const html = document.documentElement;
  const accentsEl = document.getElementById('accents');
  const customEl = document.getElementById('accent-custom');
  const pickerEl = document.getElementById('accent-picker');
  const hexEl = document.getElementById('accent-hex');
  const accentNameEl = document.getElementById('accent-name');
  const accentHintEl = document.getElementById('accent-hint');
  const appearanceStatusEl = document.getElementById('appearance-status');
  let appearance = P.resolve(null);

  P.PRESETS.forEach(({ name, hex }) => {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'accent';
    input.id = 'accent-' + name.toLowerCase();
    input.value = hex;
    const label = document.createElement('label');
    label.className = 'sw';
    label.htmlFor = input.id;
    label.title = name;
    label.style.setProperty('--c', hex);
    label.innerHTML = `<span class="sr">${name}</span>`;
    input.addEventListener('change', () => { if (input.checked) saveAppearance({ accent: hex }); });
    accentsEl.insertBefore(label, customEl);
    accentsEl.insertBefore(input, label);
  });

  // Colours that share a meaning already: a close accent makes those harder to tell apart
  const RESERVED = [['Bug', '#ff6b6b'], ['Suggestion', '#5aa9ff'], ['Text', '#ffc53d'], ['Note', '#a6a6a6'], ['Saved (green)', '#3ddc97']];
  function accentHint(hex) {
    const c = P.parseHex(hex);
    const near = RESERVED.find(([, h]) => Math.hypot(...P.parseHex(h).map((v, i) => v - c[i])) < 60);
    const light = html.dataset.dnTheme === 'light';
    if (near) return [`Close to the ${near[0]} category colour, so notes and highlights may be harder to tell apart.`, true];
    if (!light && P.contrast(c, [11, 11, 11]) < 3) return ['Very dark on the dark theme: focus rings and the Inspect frame will be hard to see.', true];
    if (light && P.contrast(c, [250, 250, 250]) < 1.4) return ['Very light on the light theme: rings and fills will be hard to see. Text in this colour is darkened automatically.', true];
    return ['Buttons, focus rings, selection and the Inspect frame. Text in this colour is adjusted automatically to stay readable.', false];
  }

  function renderAppearance(previewHex) {
    const hex = previewHex || appearance.accent;
    const preset = P.PRESETS.find((p) => p.hex === hex);
    accentsEl.querySelectorAll('input[name="accent"]').forEach((i) => { i.checked = i.value === hex; });
    customEl.classList.toggle('is-active', !preset);
    customEl.style.setProperty('--c', preset ? '' : hex);
    pickerEl.value = hex;
    if (document.activeElement !== hexEl) hexEl.value = hex;
    accentNameEl.textContent = preset ? preset.name : 'Custom';
    const [msg, warn] = accentHint(hex);
    accentHintEl.textContent = msg;
    accentHintEl.classList.toggle('warn', warn);
    document.querySelectorAll('[data-pref] input').forEach((i) => {
      i.checked = appearance[i.closest('[data-pref]').dataset.pref] === i.value;
    });
  }

  // Applies to this page immediately (theme.js re-applies from storage for every other surface)
  function previewAccent(hex) {
    P.apply(html, { ...appearance, accent: hex }, html.dataset.dnTheme === 'light');
    renderAppearance(hex);
  }

  function saveAppearance(patch) {
    appearance = P.resolve({ ...appearance, ...patch });
    chrome.storage.local.set({ dn_appearance: appearance });
    P.apply(html, appearance, html.dataset.dnTheme === 'light');
    renderAppearance();
  }

  chrome.storage.local.get('dn_appearance', (res) => { appearance = P.resolve(res.dn_appearance); renderAppearance(); });
  // Theme switches change which warnings apply
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dn_theme) setTimeout(() => renderAppearance(), 0);
  });

  pickerEl.addEventListener('input', () => previewAccent(pickerEl.value)); // live while dragging
  pickerEl.addEventListener('change', () => saveAppearance({ accent: pickerEl.value }));
  hexEl.addEventListener('input', () => {
    const v = hexEl.value.trim();
    const hex = P.normalizeHex(v);
    if (hex && v.replace('#', '').length === 6) previewAccent(hex);
  });
  hexEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexEl.blur(); });
  hexEl.addEventListener('change', () => {
    const hex = P.normalizeHex(hexEl.value);
    if (hex) { saveAppearance({ accent: hex }); return; }
    hexEl.value = appearance.accent;
    previewAccent(appearance.accent);
    appearanceStatusEl.textContent = 'Use a hex code like #ff4fd8.';
    appearanceStatusEl.classList.add('error');
    setTimeout(() => { appearanceStatusEl.textContent = ''; appearanceStatusEl.classList.remove('error'); }, 2500);
  });

  document.querySelectorAll('[data-pref]').forEach((group) => {
    group.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
      if (i.checked) saveAppearance({ [group.dataset.pref]: i.value });
    }));
  });

  document.getElementById('appearance-reset').addEventListener('click', () => {
    saveAppearance(P.DEFAULTS);
    appearanceStatusEl.textContent = 'Back to defaults.';
    setTimeout(() => { if (appearanceStatusEl.textContent === 'Back to defaults.') appearanceStatusEl.textContent = ''; }, 2000);
  });

  // Sidebar opens as a compact rail (default) or the full panel (content.js reads dn_sidebar_compact)
  const sidebarInputs = document.querySelectorAll('input[name="sidebar"]');
  chrome.storage.local.get('dn_sidebar_compact', (res) => {
    const value = res.dn_sidebar_compact === false ? 'full' : 'rail';
    sidebarInputs.forEach((i) => { i.checked = i.value === value; });
  });
  sidebarInputs.forEach((i) => i.addEventListener('change', () => {
    if (i.checked) chrome.storage.local.set({ dn_sidebar_compact: i.value === 'rail' });
  }));

  // Category picker in the Edit dialog (content.js listens for dn_show_categories changes); the new-note callout always has its chip
  const categoryInputs = document.querySelectorAll('input[name="categories"]');
  chrome.storage.local.get('dn_show_categories', (res) => {
    const value = res.dn_show_categories === true ? 'show' : 'hide';
    categoryInputs.forEach((i) => { i.checked = i.value === value; });
  });
  categoryInputs.forEach((i) => i.addEventListener('change', () => {
    if (i.checked) chrome.storage.local.set({ dn_show_categories: i.value === 'show' });
  }));

  // ---------- Categories: add / rename / delete (content.js reads dn_categories, default ['UI']) ----------
  const catListEl = document.getElementById('category-list');
  const catStatusEl = document.getElementById('category-status');
  let cats = [];
  const catStatus = (msg, error) => {
    catStatusEl.textContent = msg;
    catStatusEl.classList.toggle('error', !!error);
    setTimeout(() => { if (catStatusEl.textContent === msg) catStatusEl.textContent = ''; }, 2500);
  };
  const isTaken = (name, skip) => cats.some((c, i) => i !== skip && c.toLowerCase() === name.toLowerCase());

  function renderCats() {
    catListEl.innerHTML = '';
    cats.forEach((name, i) => {
      const li = document.createElement('li');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = name;
      input.setAttribute('aria-label', `Rename category ${name}`);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      input.addEventListener('change', () => renameCategory(i, input.value.trim(), input));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'secondary';
      del.textContent = 'Delete';
      del.setAttribute('aria-label', `Delete category ${name}`);
      del.disabled = cats.length === 1; // always keep one to save notes into
      del.title = del.disabled ? 'Keep at least one category' : '';
      del.addEventListener('click', () => {
        cats.splice(i, 1);
        chrome.storage.local.set({ dn_categories: cats }, () => { renderCats(); catStatus(`Deleted ${name}.`); });
      });
      li.append(input, del);
      catListEl.append(li);
    });
  }

  // Renaming also moves every saved note in that category (matched case-insensitively)
  function renameCategory(i, name, input) {
    const old = cats[i];
    if (!name || name === old) { input.value = old; return; }
    if (isTaken(name, i)) { input.value = old; catStatus(`${name} already exists.`, true); return; }
    cats[i] = name;
    chrome.storage.local.get(null, (all) => {
      const updates = { dn_categories: cats };
      for (const [key, list] of Object.entries(all)) {
        if (!key.startsWith('dn_annotations::') || !Array.isArray(list)) continue;
        if (!list.some((a) => (a.type || '').toLowerCase() === old.toLowerCase())) continue;
        updates[key] = list.map((a) => ((a.type || '').toLowerCase() === old.toLowerCase() ? { ...a, type: name } : a));
      }
      chrome.storage.local.set(updates, () => { renderCats(); catStatus(`Renamed ${old} to ${name}.`); });
    });
  }

  chrome.storage.local.get('dn_categories', (res) => {
    cats = Array.isArray(res.dn_categories) && res.dn_categories.length ? res.dn_categories : ['UI'];
    renderCats();
  });
  document.getElementById('category-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('category-new');
    const name = input.value.trim();
    if (!name) return;
    if (isTaken(name, -1)) { catStatus(`${name} already exists.`, true); return; }
    cats.push(name);
    chrome.storage.local.set({ dn_categories: cats }, () => { input.value = ''; renderCats(); catStatus(`Added ${name}.`); });
  });

  // Share-to apps shown in the table's Copy as menu (default mirrors content.js)
  const appInputs = document.querySelectorAll('input[name="share-app"]');
  chrome.storage.local.get('dn_share_apps', (res) => {
    const on = Array.isArray(res.dn_share_apps) ? res.dn_share_apps : ['notion', 'linear', 'jira'];
    appInputs.forEach((i) => { i.checked = on.includes(i.value); });
  });
  appInputs.forEach((i) => i.addEventListener('change', () => {
    chrome.storage.local.set({ dn_share_apps: [...appInputs].filter((x) => x.checked).map((x) => x.value) });
  }));

  document.getElementById('save').addEventListener('click', () => {
    chrome.storage.local.set(
      {
        dn_provider: providerEl.value,
        dn_api_key: apiKeyEl.value.trim(),
        dn_model: modelEl.value.trim(),
      },
      () => {
        statusEl.textContent = 'Saved.';
        setTimeout(() => (statusEl.textContent = ''), 2000);
      }
    );
  });

  // ---------- Google Drive connection status ----------
  const driveStatusEl = document.getElementById('drive-status');
  const driveConnectBtn = document.getElementById('drive-connect');
  const driveDisconnectBtn = document.getElementById('drive-disconnect');
  const driveClientIdEl = document.getElementById('driveClientId');
  const redirectUriEl = document.getElementById('redirectUri');

  redirectUriEl.textContent = chrome.identity.getRedirectURL();
  chrome.storage.local.get('dn_drive_client_id', (res) => {
    if (res.dn_drive_client_id) driveClientIdEl.value = res.dn_drive_client_id;
  });

  function renderDrive(res, silent) {
    driveConnectBtn.disabled = false;
    driveStatusEl.className = 'drive-status';
    if (res && res.email) {
      driveStatusEl.classList.add('connected');
      driveStatusEl.textContent = 'Connected as ' + res.email;
      driveConnectBtn.textContent = 'Re-check';
      driveDisconnectBtn.hidden = false;
    } else if (silent || !(res && res.error)) {
      driveStatusEl.textContent = 'Not connected';
      driveConnectBtn.textContent = 'Connect Google Drive';
      driveDisconnectBtn.hidden = true;
    } else {
      driveStatusEl.classList.add('error');
      driveStatusEl.textContent = res.error;
      driveConnectBtn.textContent = 'Try again';
      driveDisconnectBtn.hidden = true;
    }
  }

  function checkDrive(interactive) {
    driveStatusEl.className = 'drive-status checking';
    driveStatusEl.textContent = interactive ? 'Connecting…' : 'Checking connection…';
    if (interactive) driveConnectBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'CHECK_DRIVE', interactive }, (res) =>
      renderDrive(res, !interactive)
    );
  }

  // ---------- Connect to AI agents (background.js runs the bridge; mcp/redlines-mcp.js is the MCP server) ----------
  const DEFAULT_BRIDGE_SITES = 'localhost 127.0.0.1 *.localhost *.local *.test staging.* dev.*'; // mirrors background.js
  const bridgeInputs = document.querySelectorAll('input[name="bridge"]');
  const bridgeDetails = document.getElementById('bridge-details');
  const bridgeStatusEl = document.getElementById('bridge-status');
  const bridgePathEl = document.getElementById('bridge-path');
  const bridgeSitesEl = document.getElementById('bridge-sites');
  const bridgeShotsEl = document.getElementById('bridge-screenshots');
  const bridgeWriteEl = document.getElementById('bridge-write');
  const bridgeLogEl = document.getElementById('bridge-log');
  let bridgeToken = '';

  const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_');

  // Setup per AI tool. ids match mcp/redlines-mcp.js AGENTS and the logos in icons/agents/<id>.svg.
  const json = (o) => JSON.stringify(o, null, 2);
  const mcpServers = (f, t) => json({ mcpServers: { redlines: { command: 'node', args: [f], env: { REDLINES_TOKEN: t } } } });
  const AGENT_SETUP = [
    { id: 'claude-code', name: 'Claude Code', color: '#D97757', where: 'Run once in a terminal.',
      setup: (f, t) => `claude mcp add redlines -s user -e REDLINES_TOKEN=${t} -- node "${f}"` },
    { id: 'codex', name: 'Codex', where: 'Run once in a terminal.',
      setup: (f, t) => `codex mcp add redlines --env REDLINES_TOKEN=${t} -- node "${f}"` },
    { id: 'claude-desktop', name: 'Claude Desktop', color: '#D97757', where: 'Settings → Developer → Edit Config: add to claude_desktop_config.json, then restart Claude.', setup: mcpServers },
    { id: 'cursor', name: 'Cursor', where: 'Add to ~/.cursor/mcp.json (or Cursor Settings → MCP → Add new server).', setup: mcpServers },
    { id: 'copilot', name: 'GitHub Copilot', where: 'VS Code: add to .vscode/mcp.json, or run "MCP: Open User Configuration".',
      setup: (f, t) => json({ servers: { redlines: { type: 'stdio', command: 'node', args: [f], env: { REDLINES_TOKEN: t } } } }) },
    { id: 'windsurf', name: 'Windsurf', where: 'Add to ~/.codeium/windsurf/mcp_config.json.', setup: mcpServers },
    { id: 'gemini', name: 'Gemini CLI', color: '#8E75B2', where: 'Add to ~/.gemini/settings.json.', setup: mcpServers },
    { id: 'cline', name: 'Cline', where: 'Cline → MCP Servers → Configure: add to cline_mcp_settings.json.', setup: mcpServers },
    { id: 'zed', name: 'Zed', where: 'Add to Zed settings.json.',
      setup: (f, t) => json({ context_servers: { redlines: { command: 'node', args: [f], env: { REDLINES_TOKEN: t } } } }) },
    { id: 'opencode', name: 'OpenCode', where: 'Add to opencode.json.',
      setup: (f, t) => json({ mcp: { redlines: { type: 'local', command: ['node', f], environment: { REDLINES_TOKEN: t } } } }) },
    { id: 'agent', name: 'Other MCP tool', where: 'Add to your tool\'s MCP config file (most tools use this format).', setup: mcpServers },
  ];
  const agentIcon = (id) => {
    const k = AGENT_SETUP.find((x) => x.id === id);
    const ico = document.createElement('span');
    ico.className = 'agent-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.style.setProperty('--icon', `url(icons/agents/${k ? id : 'agent'}.svg)`);
    if (k && k.color) ico.style.setProperty('--agent-color', k.color);
    return ico;
  };
  const agentPickEl = document.getElementById('agent-pick');
  AGENT_SETUP.forEach((a, i) => {
    const tile = document.createElement('label');
    tile.className = 'app agent';
    tile.dataset.agent = a.id;
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name: 'agent-pick', value: a.id, checked: !i });
    tile.append(input, agentIcon(a.id), a.name);
    agentPickEl.append(tile);
  });
  agentPickEl.addEventListener('change', renderBridgeCommands);

  function renderBridgeCommands() {
    const folder = bridgePathEl.value.trim().replace(/[\\/]+$/, '') || '/path/to/designnote-extension';
    const sep = folder.includes('\\') ? '\\' : '/';
    const file = `${folder}${sep}mcp${sep}redlines-mcp.js`;
    const a = AGENT_SETUP.find((x) => x.id === agentPickEl.querySelector('input:checked').value);
    document.getElementById('agent-where').textContent = a.where;
    document.getElementById('bridge-cmd').textContent = a.setup(file, bridgeToken);
  }

  // Connected right now: logo + name under the status, and a green dot on that agent's tile
  const bridgeAgentsEl = document.getElementById('bridge-agents');
  function renderBridgeAgents(agents) {
    const list = Array.isArray(agents) ? agents : [];
    bridgeAgentsEl.hidden = !list.length;
    bridgeAgentsEl.replaceChildren(...list.map((ag) => {
      const item = document.createElement('span');
      item.append(agentIcon(ag.id), ag.name);
      return item;
    }));
    agentPickEl.querySelectorAll('.agent').forEach((t) => t.classList.toggle('live', list.some((ag) => ag.id === t.dataset.agent)));
  }

  const BRIDGE_STATUS = {
    connected: ['connected', 'Connected to AI tools'],
    waiting: ['checking', 'Waiting for an AI tool to start the Redlines MCP server…'],
    'bad-token': ['error', 'An AI tool tried to connect with an old pairing code. Copy the command again.'],
  };
  function renderBridgeStatus(status) {
    const [cls, text] = BRIDGE_STATUS[status] || BRIDGE_STATUS.waiting;
    bridgeStatusEl.className = 'drive-status ' + cls;
    bridgeStatusEl.textContent = text;
  }

  function renderBridgeLog(log) {
    bridgeLogEl.innerHTML = '';
    if (!log || !log.length) {
      bridgeLogEl.innerHTML = '<li>No agent activity yet.</li>';
      return;
    }
    log.slice(0, 12).forEach((e) => {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = new Date(e.at).toLocaleString();
      const what = document.createElement('span');
      what.textContent = e.detail ? `${e.action}: ${e.detail}` : e.action;
      li.append(time, what);
      bridgeLogEl.append(li);
    });
  }

  chrome.storage.local.get(['dn_bridge_enabled', 'dn_bridge_token', 'dn_bridge_sites', 'dn_bridge_write', 'dn_bridge_screenshots', 'dn_bridge_path', 'dn_bridge_log'], (res) => {
    bridgeInputs.forEach((i) => { i.checked = i.value === (res.dn_bridge_enabled ? 'on' : 'off'); });
    bridgeDetails.hidden = !res.dn_bridge_enabled;
    bridgeToken = res.dn_bridge_token || '';
    bridgePathEl.value = res.dn_bridge_path || '';
    bridgeSitesEl.value = res.dn_bridge_sites == null ? DEFAULT_BRIDGE_SITES : res.dn_bridge_sites;
    bridgeShotsEl.checked = res.dn_bridge_screenshots !== false;
    bridgeWriteEl.checked = res.dn_bridge_write === true;
    renderBridgeCommands();
    renderBridgeLog(res.dn_bridge_log);
  });
  chrome.storage.session.get(['dn_bridge_status', 'dn_bridge_agents'], (res) => {
    renderBridgeStatus(res.dn_bridge_status);
    renderBridgeAgents(res.dn_bridge_agents);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.dn_bridge_status) renderBridgeStatus(changes.dn_bridge_status.newValue);
    if (area === 'session' && changes.dn_bridge_agents) renderBridgeAgents(changes.dn_bridge_agents.newValue);
    if (area === 'local' && changes.dn_bridge_log) renderBridgeLog(changes.dn_bridge_log.newValue);
  });

  bridgeInputs.forEach((i) => i.addEventListener('change', (e) => {
    if (!i.checked) return;
    const on = i.value === 'on';
    if (on && (!e.isTrusted || !window.confirm(
      'Let AI tools on this computer read your Redlines notes?\n\n' +
      'An AI tool you start with your pairing code can read notes from your shared sites: text, element details, ' +
      'page addresses and (if allowed) screenshots. The AI tool may send what it reads to its provider.\n\n' +
      'You can turn this off at any time.'))) {
      bridgeInputs.forEach((x) => { x.checked = x.value === 'off'; });
      return;
    }
    if (on && !bridgeToken) bridgeToken = newToken();
    renderBridgeCommands();
    bridgeDetails.hidden = !on;
    chrome.storage.local.set(on ? { dn_bridge_enabled: true, dn_bridge_token: bridgeToken } : { dn_bridge_enabled: false });
  }));
  document.getElementById('bridge-new-code').addEventListener('click', () => {
    bridgeToken = newToken();
    renderBridgeCommands();
    chrome.storage.local.set({ dn_bridge_token: bridgeToken });
  });
  bridgePathEl.addEventListener('input', renderBridgeCommands);
  bridgePathEl.addEventListener('change', () => chrome.storage.local.set({ dn_bridge_path: bridgePathEl.value.trim() }));
  bridgeSitesEl.addEventListener('change', () => chrome.storage.local.set({ dn_bridge_sites: bridgeSitesEl.value.trim() }));
  bridgeShotsEl.addEventListener('change', () => chrome.storage.local.set({ dn_bridge_screenshots: bridgeShotsEl.checked }));
  bridgeWriteEl.addEventListener('change', () => chrome.storage.local.set({ dn_bridge_write: bridgeWriteEl.checked }));
  document.getElementById('bridge-log-clear').addEventListener('click', () => chrome.storage.local.set({ dn_bridge_log: [] }));
  document.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById(btn.dataset.copy).textContent).then(() => {
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  }));

  checkDrive(false); // silent status on load
  driveConnectBtn.addEventListener('click', () => {
    // Persist the client ID first so background.js can read it during the auth flow.
    chrome.storage.local.set({ dn_drive_client_id: driveClientIdEl.value.trim() }, () => checkDrive(true));
  });
  driveDisconnectBtn.addEventListener('click', () => {
    driveDisconnectBtn.disabled = true;
    driveStatusEl.className = 'drive-status checking';
    driveStatusEl.textContent = 'Disconnecting…';
    chrome.runtime.sendMessage({ type: 'DISCONNECT_DRIVE' }, () => {
      driveDisconnectBtn.disabled = false;
      renderDrive(null, true);
    });
  });
});
