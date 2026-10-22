document.addEventListener('DOMContentLoaded', () => {
  const countEl = document.getElementById('count');
  const labelEl = document.querySelector('.count-label');
  const openBtn = document.getElementById('open-sidebar');
  const inspectBtn = document.getElementById('inspect');

  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  // Show the user's actual shortcuts (they can be remapped in chrome://extensions/shortcuts).
  chrome.commands.getAll((commands) => {
    for (const c of commands) {
      const kbd = document.querySelector(`kbd[data-command="${c.name}"]`);
      if (kbd && c.shortcut) { kbd.textContent = c.shortcut; kbd.hidden = false; }
    }
  });

  // Via the background, which injects the content script into tabs that don't have it yet.
  const toTab = (tabId, message) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'TAB_MESSAGE', tabId, message }, (res) =>
        resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : res || {})
      )
    );

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;

    const res = await toTab(tab.id, { type: 'GET_ANNOTATION_COUNT' });
    if (res.error || !res.response) {
      countEl.textContent = '—';
      labelEl.classList.add('long');
      // No "tabs" permission, so tab.url may be hidden; Chrome's injection error names the URL.
      labelEl.textContent = /file:/i.test(res.error || '')
        ? 'To annotate local files, turn on "Allow access to file URLs" for Redlines in chrome://extensions.'
        : "Redlines can't run on this page (browser pages and extension stores are off-limits).";
      openBtn.disabled = true;
      inspectBtn.disabled = true;
      return;
    }
    countEl.textContent = res.response.count;
    labelEl.textContent = res.response.count === 1 ? 'Annotation on this page' : 'Annotations on this page';

    openBtn.addEventListener('click', async () => {
      await toTab(tab.id, { type: 'TOGGLE_SIDEBAR_OPEN' });
      await toTab(tab.id, { type: 'SHOW_PILL' });
      window.close();
    });
    inspectBtn.addEventListener('click', async () => {
      await toTab(tab.id, { type: 'SHOW_PILL' });
      await toTab(tab.id, { type: 'TOGGLE_MARK_MODE' });
      window.close();
    });
  });

  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  renderAgentsLive();
});

// ---------- AI agents (Settings → Connect to AI agents) ----------
// background.js publishes the connected agents to chrome.storage.session.dn_bridge_agents, with
// live activity (busy, lastAt, calls, seen, assigned); each agent's requests are in dn_bridge_log.
const AGENT_COLORS = { 'claude-code': '#D97757', 'claude-desktop': '#D97757', gemini: '#8E75B2' }; // mirrors settings.js AGENT_SETUP
const KNOWN_AGENTS = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'windsurf', 'gemini', 'cline', 'zed', 'opencode', 'copilot'];
const BUSY_MS = 2500; // keep blinking briefly after a request, so quick ones are still visible

function agentIcon(id) {
  const ico = document.createElement('span');
  ico.className = 'agent-ico';
  ico.setAttribute('aria-hidden', 'true');
  ico.style.setProperty('--icon', `url(icons/agents/${KNOWN_AGENTS.includes(id) ? id : 'agent'}.svg)`);
  if (AGENT_COLORS[id]) ico.style.setProperty('--agent-color', AGENT_COLORS[id]);
  return ico;
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return Math.round(s / 3600) + 'h';
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderAgentsLive() {
  const listEl = document.getElementById('agents-list');
  const countEl = document.getElementById('agents-count');
  const noteEl = document.getElementById('agents-note');
  const state = { enabled: false, status: 'off', agents: [], log: [] };
  const nodes = new Map(); // agent id → { wrap, chip, card parts }

  function buildAgent(a) {
    const wrap = document.createElement('div');
    wrap.className = 'agent-wrap';
    wrap.dataset.agent = a.id;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'agent';
    const cardId = 'agent-card-' + a.id;
    chip.setAttribute('aria-describedby', cardId);
    const name = document.createElement('span');
    const multi = document.createElement('span');
    multi.className = 'multi';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    chip.append(agentIcon(a.id), name, multi, dot);
    chip.addEventListener('click', () => chrome.runtime.openOptionsPage());

    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = cardId;
    card.setAttribute('role', 'tooltip');
    const head = document.createElement('div');
    head.className = 'card-head';
    const cardName = document.createElement('span');
    const cardState = document.createElement('span');
    cardState.className = 'card-state';
    const stateDot = document.createElement('span');
    stateDot.className = 'dot';
    stateDot.setAttribute('aria-hidden', 'true');
    const stateText = document.createElement('span');
    cardState.append(stateDot, stateText);
    head.append(agentIcon(a.id), cardName, cardState);
    const stats = document.createElement('dl');
    stats.className = 'card-stats';
    const recent = document.createElement('ul');
    recent.className = 'card-recent';
    card.append(head, stats, recent);
    wrap.append(chip, card);
    return { wrap, chip, name, multi, cardName, cardState, stateDot, stateText, stats, recent };
  }

  function updateAgent(n, a) {
    const busy = a.busy > 0 || Date.now() - (a.lastAt || 0) < BUSY_MS;
    n.chip.classList.toggle('busy', busy);
    n.name.textContent = a.name;
    n.multi.textContent = a.sessions > 1 ? '×' + a.sessions : '';
    n.chip.setAttribute('aria-label', `${a.name}${a.sessions > 1 ? `, ${a.sessions} sessions` : ''}, ${busy ? 'working' : 'connected'}`);
    n.cardName.textContent = a.name;
    n.cardState.classList.toggle('busy', busy);
    n.stateDot.classList.toggle('busy', busy);
    n.stateText.textContent = busy ? 'Working…' : 'Connected';

    const rows = [
      ['Online for', `${a.since ? ago(a.since) : '—'}${a.sessions > 1 ? ` · ${a.sessions} sessions` : ''}`],
      ['Requests', String(a.calls || 0)],
      ['Can see', a.seen == null ? 'after its first request' : plural(a.seen, 'note')],
      ['Sent to it', a.assigned == null ? '—' : `${a.assigned} open`],
    ];
    n.stats.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));

    const mine = state.log.filter((e) => e.agent === a.id).slice(0, 3);
    n.recent.hidden = !mine.length;
    n.recent.replaceChildren(...mine.map((e) => {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = e.detail ? `${e.action} · ${e.detail}` : e.action;
      what.title = what.textContent;
      const time = document.createElement('time');
      time.textContent = ago(e.at);
      li.append(what, time);
      return li;
    }));
  }

  function render() {
    const { enabled, status, agents } = state;
    countEl.classList.toggle('on', enabled && agents.length > 0);
    countEl.textContent = !enabled ? 'Off' : `${agents.length} connected`;

    // Keyed: chips are reused, so the 1 s tick doesn't steal focus or flicker an open card.
    const ids = new Set(agents.map((a) => a.id));
    for (const [id, n] of nodes) if (!ids.has(id)) { n.wrap.remove(); nodes.delete(id); }
    agents.forEach((a) => {
      let n = nodes.get(a.id);
      if (!n) { n = buildAgent(a); nodes.set(a.id, n); }
      listEl.append(n.wrap); // keeps the published order
      updateAgent(n, a);
    });

    let note = '';
    let error = false;
    if (!enabled) note = 'Let Claude Code, Cursor and other AI tools read your notes.';
    else if (status === 'bad-token') { note = 'An AI tool used an old pairing code. Copy the setup command again in Settings.'; error = true; }
    else if (!agents.length) note = 'Waiting for an AI tool to start the Redlines MCP server.';
    noteEl.hidden = !note;
    noteEl.classList.toggle('error', error);
    if (note) {
      noteEl.textContent = note + ' ';
      if (!enabled || error) {
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = enabled ? 'Open Settings' : 'Set up';
        link.addEventListener('click', () => chrome.runtime.openOptionsPage());
        noteEl.append(link);
      }
    }
  }

  Promise.all([
    chrome.storage.local.get(['dn_bridge_enabled', 'dn_bridge_log']),
    chrome.storage.session.get(['dn_bridge_status', 'dn_bridge_agents']),
  ]).then(([local, session]) => {
    state.enabled = !!local.dn_bridge_enabled;
    state.log = local.dn_bridge_log || [];
    state.status = session.dn_bridge_status || 'off';
    state.agents = session.dn_bridge_agents || [];
    render();
    setInterval(render, 1000); // relative times, and the blink fading out after a request
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dn_bridge_enabled) state.enabled = !!changes.dn_bridge_enabled.newValue;
    if (area === 'local' && changes.dn_bridge_log) state.log = changes.dn_bridge_log.newValue || [];
    if (area === 'session' && changes.dn_bridge_status) state.status = changes.dn_bridge_status.newValue || 'off';
    if (area === 'session' && changes.dn_bridge_agents) state.agents = changes.dn_bridge_agents.newValue || [];
    render();
  });
}
