// ---------- rendering ----------

function isRunning(a) { return Date.now() - ms(a.last_seen) < STALE_MIN * 60000; }

// ---------- one-click start: cloud sessions through the Claude Code connector ----------
const CC = 'Claude Code Remote';
let mcp = null;
let envs = null;
const starting = {};
const startErr = {};

// ---------- usage limits ----------
let triggerOn = false;
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function isLimited(a) {
  const l = a && a.limit;
  return !!(l && !['allowed', 'allowed_warning'].includes(l.status) && l.resets_at && ms(l.resets_at) > Date.now());
}
function limitedAgents() { return S.agents.filter((a) => isLimited(a) && a.session_id); }
function limitHtml(a) {
  if (isLimited(a)) {
    const sched = a.resume_at && ms(a.resume_at) > Date.now();
    return `<p class="limit">Stopped on its usage limit. Resets ${esc(hhmm(a.limit.resets_at))}.${sched ? ` Resumes ${esc(hhmm(a.resume_at))}.` : ''}</p>${
      !sched && triggerOn ? `<div class="agent-links"><button class="link" data-resume="${esc(a.agent)}">Resume at reset</button></div>` : ''}`;
  }
  return a.limit && a.limit.status === 'allowed_warning' ? '<p class="hint">Close to its usage limit</p>' : '';
}
function renderLimitBanner() {
  const el = document.getElementById('limit-banner');
  const list = limitedAgents();
  if (!list.length) { el.hidden = true; return; }
  const open = list.filter((a) => !(a.resume_at && ms(a.resume_at) > Date.now()));
  const next = list.map((a) => ms(a.limit.resets_at)).sort((x, y) => x - y)[0];
  el.innerHTML = `${list.length} agent${list.length === 1 ? '' : 's'} stopped on a usage limit. The next reset is at ${esc(hhmm(new Date(next).toISOString()))}. `
    + (open.length && triggerOn ? `<button type="button" class="btn" id="resume-all">Resume ${open.length === 1 ? 'it' : `all ${open.length}`} at reset</button>` : open.length ? 'Start them again after the reset.' : 'All are scheduled to resume.');
  el.hidden = false;
}
const RESUME_PROMPT = (a) => `Your usage limit has reset. Continue where you stopped: you are agent "${a.agent}" in the Agent Hub at ${HUB_URL}. Read your directives and your current task there, then carry on following the hub rules.`;
async function scheduleResume(names) {
  for (const n of names) {
    const a = S.agents.find((x) => x.agent === n);
    if (!a || !isLimited(a) || !a.session_id || starting[n]) continue;
    if (a.resume_at && ms(a.resume_at) > Date.now()) continue; // already scheduled
    starting[n] = true; delete startErr[n]; render();
    try {
      const at = new Date(ms(a.limit.resets_at) + 2 * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
      const r = await mcp.callTool(CC, 'create_trigger', { name: `Resume ${n} (Agent Hub)`, prompt: RESUME_PROMPT(a), persistent_session_id: a.session_id, run_once_at: at, initiation: 'human_request' });
      const trig = (r.payload && (r.payload.trigger || r.payload)) || {};
      await db.doc(`agents/${n}`).update({ resume_at: at, resume_trigger: trig.id || null });
    } catch (e) { startErr[n] = startMessage(e); }
    delete starting[n]; render();
  }
}

// Some organizations do not allow pages to start sessions. Once the page sees that, it stops
// offering start buttons and offers one start request to paste into a Claude Code session.
let startBlocked = false;
try { startBlocked = localStorage.getItem('hub-start-blocked') === '1'; } catch (e) { /* storage blocked */ }
function markStartBlocked() { startBlocked = true; try { localStorage.setItem('hub-start-blocked', '1'); } catch (e) { /* ignore */ } }

// One message that starts every stopped agent of a project, for a Claude Code session to run.
function startRequest(project) {
  const p = S.projects.find((x) => x.name === project) || {};
  const list = S.agents.filter((a) => a.project === project && !isRunning(a))
    .sort((x, y) => (roleOf(y.agent) === 'lead') - (roleOf(x.agent) === 'lead'));
  const src = githubRepo(p.repo);
  return [`Start the Agent Hub agents of project "${project}". For each agent below, in this order, create a Claude Code cloud session with the create_session tool of the Claude Code Remote connector: permission_mode "auto", title "<agent> (Agent Hub)"${src ? `, source_url "${src}"` : ''}, and the agent's start line as the prompt.`,
    `After each start, record it in the hub with the ArtifactData tool: action "update", url ${HUB_URL}, collection "agents", doc_id the agent's name, data {"session_id": <id>, "session_url": "https://claude.ai/code/<id>", "started_at": <now>, "state": "started"}. Then reply with one line per agent and stop.`, '',
    ...list.map((a, i) => `${i + 1}. ${a.agent}\nStart line: ${startLine(a.agent, a.role || roleOf(a.agent), project, p.repo || '')}`)].join('\n');
}
function stoppedCount(project) { return S.agents.filter((a) => a.project === project && !isRunning(a)).length; }

// Agents write next_check_at when they schedule their next check. One that missed it by more
// than 10 minutes has most likely been shut down while idle.
const ASLEEP_MS = 10 * 60000;
// Started from the hub but never checked in: the session did not take its first instruction.
function neverCheckedIn(a) { return !!(a.started_at && !a.last_seen && a.state !== 'delivered' && Date.now() - ms(a.started_at) > ASLEEP_MS); }
function isAsleep(a) { return neverCheckedIn(a) || !!(a.next_check_at && a.state !== 'delivered' && Date.now() - ms(a.next_check_at) > ASLEEP_MS); }
function nextCheckHtml(a) {
  if (neverCheckedIn(a)) return `<p class="asleep">Never checked in since it was started at ${esc(hhmm(a.started_at))}. Open its session to see why.</p>`;
  if (!a.next_check_at || a.state === 'delivered') return '';
  if (isAsleep(a)) return `<p class="asleep">Asleep: missed its check at ${esc(hhmm(a.next_check_at))}. Open its session and send any message to wake it.</p>`;
  return ms(a.next_check_at) > Date.now() ? `<p class="hint">Next check ${esc(hhmm(a.next_check_at))}</p>` : '';
}

function cloudHtml(a, running) {
  const parts = [];
  if (a.session_url && /^https:\/\/claude\.ai\/code\//.test(a.session_url)) parts.push(`<a href="${esc(a.session_url)}" target="_blank" rel="noopener">Open session</a>`);
  if (mcp && !running && !startBlocked) parts.push(starting[a.agent] ? '<span class="hint" role="status">Starting...</span>'
    : `<button class="link" data-start="${esc(a.agent)}">${a.session_id ? 'Start again' : 'Start in the cloud'}</button>`);
  const err = startErr[a.agent] ? `<p class="error" role="alert">${esc(startErr[a.agent])}</p>` : '';
  return limitHtml(a) + nextCheckHtml(a) + (parts.length || err ? `<div class="agent-links">${parts.join(' ')}</div>${err}` : '');
}

function savedEnv() { try { return localStorage.getItem('hub-env') || ''; } catch (e) { return ''; } }

async function environments() {
  if (envs) return envs;
  const r = await mcp.callTool(CC, 'list_environments', { limit: 50 });
  const list = (r.payload && Array.isArray(r.payload.environments) ? r.payload.environments : []).filter((e) => e && e.state !== 'deleted');
  envs = list;
  return envs;
}

function startMessage(e) {
  switch (e && e.code) {
    case 'server_not_connected': case 'selection_required': case 'server_not_found':
      return 'Claude Code is not connected to your claude.ai account. Open claude.ai/code once, then try again.';
    case 'needs_reauth': return 'Reconnect Claude Code in claude.ai Settings, Connectors, then try again.';
    case 'not_in_manifest': return 'Starting agents is turned off for this page. Turn on Claude Code in the page\'s Permissions menu.';
    case 'approval_required': return 'claude.ai asked for your approval and did not get it. Click again and choose Allow.';
    case 'blocked_by_policy': markStartBlocked(); return 'Your organization does not allow starting sessions from a page. Use Copy start request on the project card instead.';
    case 'tool_error': return `Claude Code refused: ${String(e.message || 'no reason given').slice(0, 200)}`;
    case 'server_unavailable': case 'upstream_error': case 'cancelled':
      return 'No answer from Claude Code. The session may have started anyway: check claude.ai/code before you try again.';
    default: return `Could not start (${(e && e.code) || 'error'}). Paste the start line instead.`;
  }
}

function githubRepo(repo) {
  const m = String(repo || '').trim().match(/^(?:https:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  return m ? `https://github.com/${m[1]}/${m[2].replace(/\.git$/, '')}` : '';
}

// Brief helper: five short questions become a brief the lead can plan from.
function writeBrief() {
  const v = (id) => document.getElementById(id).value.trim();
  const what = v('b-what'); const who = v('b-who'); const out = v('b-out'); const deadline = v('b-deadline'); const where = v('b-where');
  const must = v('b-must').split('\n').map((x) => x.replace(/^[-*\s]+/, '').trim()).filter(Boolean);
  const missing = [!what && 'what it is', !who && 'who uses it', !must.length && 'must-haves', !out && 'what is out of scope', !deadline && 'the deadline'].filter(Boolean);
  const lines = [];
  if (what) lines.push(what, '');
  if (who) lines.push(`Who: ${who}`);
  if (must.length) lines.push('Must have:', ...must.map((x) => `- ${x}`));
  if (out) lines.push(`Out of scope for now: ${out}`);
  if (deadline) lines.push(`Deadline: ${deadline}`);
  if (where) lines.push(`Runs on: ${where}`);
  const kind = document.getElementById('f-kind').value;
  if (kind && kind !== 'other') lines.push(`Type: ${KIND_LABEL[kind]} (the lead uses the ${KIND_LABEL[kind]} starter checklist)`);
  const brief = document.getElementById('f-brief');
  if (lines.length) brief.value = lines.join('\n').trim();
  document.getElementById('b-msg').textContent = missing.length
    ? `Brief written. Still missing: ${missing.join(', ')}. The lead will ask about these.`
    : 'Brief written. Check it below, then create the project.';
}

async function startAgent(agent) {
  const a = S.agents.find((x) => x.agent === agent);
  if (!a || !mcp || starting[agent]) return;
  const p = S.projects.find((x) => x.name === a.project) || {};
  starting[agent] = true; delete startErr[agent]; render();
  try {
    const list = await environments();
    const env = list.find((e) => e.environment_id === savedEnv()) || list[0];
    const role = a.role || roleOf(agent);
    const input = { prompt: startLine(agent, role, a.project || '', p.repo || ''), title: `${agent} (Agent Hub)`, permission_mode: 'auto', tags: ['agent-hub', `agent-hub:${a.project || ''}`] };
    if (env) input.environment_id = env.environment_id;
    const src = githubRepo(p.repo);
    if (src) input.source_url = src;
    const r = await mcp.callTool(CC, 'create_session', input);
    const pl = r.payload || {};
    const id = (pl.ccr && pl.ccr.id) || pl.id || pl.session_id;
    if (!id) throw { code: 'tool_error', message: 'it did not return a session' };
    const rec = { session_id: id, session_url: `https://claude.ai/code/${id}`, started_at: new Date().toISOString(), state: 'started' };
    try { await db.doc(`agents/${agent}`).update(rec); } catch (x) { await db.doc(`agents/${agent}`).set(Object.assign({ agent, project: a.project || '', role }, rec)); }
  } catch (e) {
    startErr[agent] = startMessage(e);
  }
  delete starting[agent];
  render();
}

async function startProject(project) {
  const names = S.agents.filter((a) => a.project === project && !isRunning(a) && !a.session_id).map((a) => a.agent);
  // The lead first: it writes the plan the others wait for.
  names.sort((x, y) => (roleOf(y) === 'lead') - (roleOf(x) === 'lead'));
  for (const n of names) { await startAgent(n); if (startErr[n]) break; }
}

async function fillEnvPicker() {
  const sel = document.getElementById('env-pick');
  if (!sel || !mcp) return;
  try {
    const list = await environments();
    const cur = savedEnv();
    sel.innerHTML = list.map((e) => `<option value="${esc(e.environment_id)}"${e.environment_id === cur ? ' selected' : ''}>${esc(e.name || e.environment_id)}</option>`).join('');
    sel.closest('label').hidden = list.length < 2;
  } catch (e) { const l = sel.closest('label'); if (l) l.hidden = true; }
}

function renderAgents() {
  const el = document.getElementById('agents');
  document.getElementById('agents-count').textContent = S.agents.length ? `${S.agents.filter(isRunning).length} of ${S.agents.length} running` : '';
  if (!S.agents.length) return;
  const openBy = new Set(S.items.filter((i) => i.needs_me && i.status === 'open').map((i) => i.agent));
  el.innerHTML = S.agents.slice().sort((a, b) => String(a.agent).localeCompare(String(b.agent))).map((a) => {
    const running = isRunning(a);
    const waiting = openBy.has(a.agent);
    const when = running ? ago(a.last_seen) : ms(a.last_seen) ? `idle, ${ago(a.last_seen)}` : 'not started';
    const sub = `${esc(a.project || '')}${a.role ? ` · ${esc(a.role)}` : ''}${a.current_task ? ` · ${esc(a.current_task)}` : ''}`;
    const pending = S.unread.filter((x) => x.agent === a.agent).length;
    const third = waiting ? '<p class="waiting-text">Waiting on you</p>'
      : pending ? `<p>${pending} answer${pending === 1 ? '' : 's'} not picked up yet</p>`
      : a.state === 'delivered' && !running ? '<p>Delivered</p>'
      : a.last_status_title ? `<p title="${esc(a.last_status_title)}">${esc(a.last_status_title)}</p>` : '';
    const open = Object.prototype.hasOwnProperty.call(msgDrafts, a.agent);
    return `<div class="agent">
      <div class="agent-top"><span class="dot${waiting ? ' waiting' : running ? ' running' : ''}" aria-hidden="true"></span>
        <button class="agent-name" data-filter-agent="${esc(a.agent)}" title="Show only this agent">${esc(a.agent)}</button>
        <span class="agent-when">${when}</span></div>
      <p>${sub}</p>${third}
      ${cloudHtml(a, running)}
      ${open ? `<div class="row"><input type="text" id="msg-${esc(slug(a.agent))}" data-msg-input="${esc(a.agent)}" value="${esc(msgDrafts[a.agent])}" placeholder="Message to ${esc(a.agent)}" maxlength="500"><button class="btn primary" data-msg-send="${esc(a.agent)}">Send</button></div>`
        : `<div><button class="link" data-msg-open="${esc(a.agent)}">Message</button></div>`}
    </div>`;
  }).join('');
}

