// ---------- actions ----------

function parsePerNumber(text) {
  const re = /(?:^|[,;\n]\s*)(\d{1,2})\s*[.:)\-=]?\s+/g;
  const marks = []; let m;
  while ((m = re.exec(text))) marks.push({ n: m[1], start: m.index, after: re.lastIndex });
  if (!marks.length) return null;
  const out = {};
  marks.forEach((mk, i) => { out[mk.n] = text.slice(mk.after, i + 1 < marks.length ? marks[i + 1].start : text.length).replace(/[,;\s]+$/, '').trim(); });
  return out;
}

// ---------- undo, snooze, files in answers ----------
// A decision waits 5 seconds before it is saved, so a mistaken tap can be undone.
const UNDO_MS = window.HUB_UNDO_MS || 5000; // tests shorten it
const pendingAct = {};
function queueAct(id, action, text) {
  if (pendingAct[id] || saving[id] || uploading[id]) return;
  const timer = setTimeout(() => { delete pendingAct[id]; act(id, action, text); }, UNDO_MS);
  pendingAct[id] = { action, text, timer };
  render();
}
function undoAct(id) { const p = pendingAct[id]; if (!p) return; clearTimeout(p.timer); delete pendingAct[id]; render(); }
// Leaving the page sends what is still waiting rather than dropping it.
addEventListener('pagehide', () => { for (const [id, p] of Object.entries(pendingAct)) { clearTimeout(p.timer); delete pendingAct[id]; act(id, p.action, p.text); } });

function isSnoozed(it) { return !!(it.snoozed_until && ms(it.snoozed_until) > Date.now()); }
function snoozeTime(choice) {
  const d = new Date();
  if (choice === '1h') return new Date(Date.now() + 3600e3);
  if (choice === '3h') return new Date(Date.now() + 3 * 3600e3);
  if (choice === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }
  if (choice === 'monday') { d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); d.setHours(9, 0, 0, 0); return d; }
  return null;
}
async function snooze(id, until) {
  try { await db.doc(`items/${id}`).update({ snoozed_until: until ? until.toISOString() : null }); delete saveErr[id]; }
  catch (e) { saveErr[id] = saveMessage(e); }
  render();
}

let assetsCap = null;
const fbFiles = {};
const uploading = {};
const uploadErr = {};
async function attachFiles(id, list) {
  if (!assetsCap || !list.length) return;
  uploading[id] = true; delete uploadErr[id]; render();
  for (const f of list) {
    if (f.size > 20 * 1024 * 1024) { uploadErr[id] = `${f.name} is over 20 MB.`; continue; }
    try {
      const r = await assetsCap.upload(f);
      (fbFiles[id] = fbFiles[id] || []).push({ id: r.id, url: r.url, name: clean(f.name).slice(0, 120), kind: /^image\//.test(f.type) ? 'image' : 'file' });
    } catch (e) { uploadErr[id] = `Could not upload ${f.name} (${(e && e.code) || 'error'}).`; }
  }
  delete uploading[id];
  if (uploadErr[id] === 'Wait for the upload to finish, then send.') delete uploadErr[id];
  render();
}

// Save state per card lives outside the DOM, so a live refresh never hides an error or re-enables
// buttons while a save is still running.
const saving = {};
const saveErr = {};
const NO_SAVE = ['not_granted', 'capability_disabled', 'capability_removed', 'revoked', 'invalid_argument'];

function saveMessage(e) {
  const code = (e && e.code) || 'error';
  if (code === 'quota_exceeded') return 'The hub database is full. Delete old items at the bottom of the page, then try again.';
  if (NO_SAVE.includes(code)) { showPermBanner(); return `Not saved: this page may not save to its database (${code}). Use "Allow saving" at the top, then try again.`; }
  if (code === 'not_saved') return 'Not saved: the database did not keep your answer. Reload the page and try again.';
  return `Not saved (${code}). Try again.`;
}

async function write(fn) {
  try { return await fn(); } catch (e) {
    if (e && e.code === 'unavailable') { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
    throw e;
  }
}

// Wakes the agent's own session with a one-off scheduled message a minute from now, so it reads new
// work right away instead of at its next timed check. (Firing a scheduled task would start a new,
// empty session instead.) Best effort: the agent's next check picks the work up anyway.
async function wakeAgent(name) {
  const a = S.agents.find((x) => x.agent === name);
  if (!triggerOn || !mcp || !a || !a.session_id) return;
  try {
    await mcp.callTool(CC, 'create_trigger', { name: `Wake ${a.agent}`, persistent_session_id: a.session_id, initiation: 'human_request',
      run_once_at: new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      prompt: 'Agent Hub: the CEO answered or sent you work. Run your next loop iteration now.' });
  } catch (e) { /* the agent's own next check reads it */ }
}

async function act(id, action, text) {
  const it = S.items.find((i) => i.id === id);
  if (!it || !db || saving[id]) return;
  text = clean(text || '').trim();
  const files = (fbFiles[id] || []).map((f) => ({ id: f.id, url: f.url, name: f.name, kind: f.kind }));
  saving[id] = true; delete saveErr[id]; render();
  const now = new Date().toISOString();
  try {
    if (MEANING[action]) {
      let perQ = null;
      if (action === 'approve' && arr(it.recommendations).length > 1) { perQ = {}; it.recommendations.forEach((r, i) => { perQ[String(i + 1)] = r; }); }
      if (action === 'feedback') perQ = parsePerNumber(text);
      const proj = S.projects.find((p) => p.name === it.project) || {};
      const to = action === 'ship' && proj.lead ? proj.lead : it.agent;
      await write(() => db.doc(`answers/${id}`).set({ item_id: id, agent: to, project: it.project, title: it.title, decision: action, via: 'page', text: text || '',
        per_question: perQ, recommendation: it.recommendation || null, meaning: MEANING[action], answered_at: now, read: false, attachments: files }));
      const check = await db.doc(`answers/${id}`).get();
      if (!check.exists) throw { code: 'not_saved' };
      await write(() => db.doc(`items/${id}`).update({ status: 'answered', needs_me: false, answer: { decision: action, text: text || '', at: now, attachments: files } }));
      delete drafts[id]; delete fbFiles[id];
      wakeAgent(to);
    } else if (action === 'acknowledge') {
      await write(() => db.doc(`items/${id}`).update({ status: it.type === 'idea' ? 'archived' : 'acknowledged', acknowledged_at: now }));
    } else if (action === 'keep_idea') {
      await write(() => db.doc(`items/${id}`).update({ status: 'kept', kept_at: now }));
    }
  } catch (e) {
    saveErr[id] = saveMessage(e);
  }
  delete saving[id];
  render();
}

// The page also gets an mcp namespace for its own database, so check that the Claude Code connector
// is really in this page's manifest before offering one-click start.
async function initCloud() {
  try {
    const m = await useCap('mcp');
    if (!m) return;
    const r = await m.listTools(CC);
    const srv = (r.servers || []).find((x) => x.server === CC);
    if (srv && (srv.tools || []).some((t) => t.name === 'create_session')) {
      mcp = m; render();
      triggerOn = (srv.tools || []).some((t) => t.name === 'create_trigger');
      if ((srv.tools || []).some((t) => t.name === 'get_session')) { costsOn = true; refreshCosts(); setInterval(refreshCosts, 10 * 60000); }
    }
  } catch (e) { mcp = null; }
}

let perms = null;
function showPermBanner() { document.getElementById('perm').hidden = false; }
async function checkPerms() {
  try { perms = await useCap('permissions'); } catch (e) { perms = null; }
  if (!perms) return;
  try { if ((await perms.state('db')) === 'denied') showPermBanner(); } catch (e) { /* state never rejects */ }
}

function newHubRequest(p) {
  return [`Create a new Agent Hub for a new project, following docs/NEW-PROJECT.md in github.com/giovannibrees/Agent-Hub-for-Claude-Code.`,
    `Copy the hub rules (config: protocol, roles, alerts, alert-relay) and the lessons from ${HUB_URL}.`,
    `Project: ${p.name}`, `Team: ${p.agents}`, `Type: ${p.kind}`, `Size: ${p.size}`, `Live URL: ${p.live || 'none yet'}`, `Repo: ${p.repo || 'none yet'}`, `Priority: ${p.priority}`,
    `Brief:`, p.brief].join('\n');
}
const msgOffer = {}; // agent -> message text that read like a new project
async function sendMessage(agent, btn) {
  const text = clean(msgDrafts[agent] || '').trim();
  if (!text || !db) return;
  if (looksLikeProject(text) && msgOffer[agent] !== text) { msgOffer[agent] = text; render(); return; }
  delete msgOffer[agent];
  btn.disabled = true;
  try {
    const ag = S.agents.find((a) => a.agent === agent) || {};
    await db.collection('directives').add({ to: agent, project: ag.project || '', from: 'ceo', via: 'page', text, timestamp: new Date().toISOString(), read: false });
    wakeAgent(agent);
    delete msgDrafts[agent];
    render();
  } catch (e) { btn.disabled = false; btn.textContent = 'Retry'; }
}

function roleOf(a) {
  for (const [prefix, r] of [['lead', 'lead'], ['architect', 'architect'], ['design', 'designer'], ['review', 'reviewer'], ['security', 'security'], ['sec', 'security'], ['qa', 'qa'], ['usertest', 'usertest'], ['user', 'usertest'], ['persona', 'usertest'], ['test', 'qa'], ['cleanup', 'cleanup'], ['clean', 'cleanup'], ['docs', 'docs'], ['codex', 'codex'], ['checker', 'checker'], ['check', 'checker']]) if (a.startsWith(prefix)) return r;
  return 'builder';
}

function startLine(name, role, project, repo) {
  return `You are agent "${name}" (role: ${role}) on project "${project}" in the Agent Hub at ${HUB_URL}${repo ? ` for the code in ${repo}` : ''}. First read the hub rules and your role card with ArtifactData: action get, url ${HUB_URL}, collection "config", doc_id "protocol" (then doc_id "roles", section "## ${role}"). Run one check now, and at the end of every check schedule the next one with send_later as the rules say (section 2, step 6). Follow them for this whole session. The CEO only reads the hub, never this chat.`;
}

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('add-error');
  err.hidden = true;
  if (!db) { err.textContent = 'The database is not available here. Open this page on claude.ai while signed in.'; err.hidden = false; return; }
  const name = slug(document.getElementById('f-name').value);
  const brief = clean(document.getElementById('f-brief').value).trim();
  const repo = document.getElementById('f-repo').value.trim();
  const kind = document.getElementById('f-kind').value;
  const size = document.getElementById('f-size').value;
  const liveUrl = document.getElementById('f-live').value.trim();
  // Agent names are unique across projects: "lead" in project gym-app becomes "lead-gym-app".
  const agents = document.getElementById('f-agents').value.split(',').map((s) => slug(s)).filter(Boolean)
    .map((a) => (a.endsWith(`-${slug(document.getElementById('f-name').value)}`) ? a : `${a}-${slug(document.getElementById('f-name').value)}`));
  if (!name || !brief || !agents.length) { err.textContent = 'Give the project a name, at least one agent and a brief.'; err.hidden = false; return; }
  if (S.projects.some((p) => p.name === name)) { err.textContent = `A project called ${name} already exists. Pick another name.`; err.hidden = false; return; }
  const role = roleOf;
  // One project per hub: a hub that already has a project hands the new one to Claude, which
  // publishes a fresh hub page for it (docs/NEW-PROJECT.md).
  const single = window.HUB_SINGLE_PROJECT !== undefined ? window.HUB_SINGLE_PROJECT : !window.HUB_DEMO;
  if (single && S.projects.length) {
    const req = newHubRequest({ name, agents: document.getElementById('f-agents').value, kind: document.getElementById('f-kind').value, size: document.getElementById('f-size').value,
      live: document.getElementById('f-live').value.trim(), repo, priority: document.getElementById('f-priority').value, brief });
    const out = document.getElementById('add-result');
    out.innerHTML = `<h3>${esc(name)} gets its own hub</h3>
      <p class="note">Each project has its own hub page, so its cards never mix with other projects. Paste this request into Claude Code (any session): it creates the hub, copies your rules and lessons, and starts the agents. You get the new link back.</p>
      <div class="cmd"><code>${esc(req)}</code><button type="button" class="btn primary" data-copy="${esc(req)}">Copy request</button></div>
      <button type="button" class="link" id="add-another">Back to the form</button>`;
    out.hidden = false; document.getElementById('add-form').hidden = true;
    return;
  }
  const btn = document.getElementById('f-submit');
  btn.disabled = true;
  try {
    const now = new Date().toISOString();
    await db.doc(`projects/${name}`).set({ name, goal: brief.split('\n')[0].replace(/^#+\s*/, '').slice(0, 160), brief, repo, kind, size, live_url: liveUrl, phase: 'planning', priority: document.getElementById('f-priority').value,
      scope: [], never: [], lead: agents.find((a) => role(a) === 'lead') || '', agents: agents.map((a) => ({ name: a, role: role(a) })), created_at: now });
    for (const a of agents) await db.doc(`agents/${a}`).set({ agent: a, project: name, role: role(a), registered_at: now, state: 'registered' });
    const out = document.getElementById('add-result');
    const copy = (t) => `<div class="cmd"><code>${esc(t)}</code><button type="button" class="btn" data-copy="${esc(t)}">Copy</button></div>`;
    const cloud = startBlocked ? `<div class="cloud-start"><p class="note">Your organization does not allow this page to start sessions. Copy the start request and paste it into a Claude Code session: it starts every agent, lead first.</p>
        <button type="button" class="btn primary" data-copy-start="${esc(name)}">Copy start request</button></div>
      <details><summary>Or start them one by one</summary>` : mcp ? `<div class="cloud-start"><p class="note">Start every agent as a Claude Code session in the cloud${githubRepo(repo) ? ` on ${esc(githubRepo(repo))}` : ''}. They run in auto mode and report here; the lead starts with the plan.</p>
        <label hidden>Cloud environment <select id="env-pick"></select></label>
        <button type="button" class="btn primary" data-start-all="${esc(name)}">Start ${agents.length} agent${agents.length === 1 ? '' : 's'} in the cloud</button>
        <p class="hint" id="start-all-msg" role="status"></p></div>
      <details><summary>Or start them yourself</summary>` : '';
    out.innerHTML = `<h3>${esc(name)} is ready</h3>${cloud}
      <p class="note">For each agent, open a new Claude Code session${repo ? ` on ${esc(repo)}` : ''} (claude.ai/code, the desktop app or a terminal), switch it to auto mode so it can write to this page, and paste its line. The lead starts by writing the plan; you approve it in Needs you.</p>
      <ol class="steps">${agents.map((a) => `<li>${esc(a)} (${role(a)})${copy(startLine(a, role(a), name, repo))}</li>`).join('')}</ol>${mcp || startBlocked ? '</details>' : ''}
      <button type="button" class="link" id="add-another">Add another project</button>`;
    out.hidden = false;
    document.getElementById('add-form').hidden = true;
    fillEnvPicker();
  } catch (x) {
    err.textContent = x && x.code === 'quota_exceeded' ? 'The hub database is full. Delete old items first.' : `Could not create the project (${(x && x.code) || 'error'}).`;
    err.hidden = false;
  }
  btn.disabled = false;
});

