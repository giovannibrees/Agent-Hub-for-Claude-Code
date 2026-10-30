const SKILLS = ['none', 'basic', 'average', 'advanced', 'expert'];
const DEVICES = ['phone', 'tablet', 'desktop'];

function profilesHtml(p) {
  const list = S.personas.filter((x) => x.project === p.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const d = pfDrafts[p.name] || {};
  const id = (f) => `pf-${p.name}-${f}`;
  const sel = (f, opts, cur) => `<select id="${esc(id(f))}" data-pf="${esc(p.name)}" data-field="${f}">${opts.map((o) => `<option${o === cur ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  return `<details id="pers-${esc(p.name)}" data-keep${openDetails.has(`pers-${p.name}`) ? ' open' : ''}><summary>Customer profiles (${list.length})</summary>
    <div class="cards">
      ${list.length ? `<ul class="plist">${list.map((x) => `<li><span>${esc(x.name)}, ${esc(x.age)}, IT ${esc(x.it_skill)}, ${esc(x.device)}${x.needs ? ` · ${esc(x.needs)}` : ''}</span>
        <span><button type="button" class="link" data-run-test="${esc(p.name)}" data-persona="${esc(x.name)}">Run user test</button> · <button type="button" class="link" data-del-persona="${esc(x.id)}">Remove</button></span></li>`).join('')}</ul>
        <div><button type="button" class="btn" data-run-test="${esc(p.name)}" data-persona="">Test with all profiles</button></div>` : '<p class="hint">Add the kinds of customers who will use this app. A usertest agent then uses the app as each of them and reports bugs and confusing spots.</p>'}
      <div class="pf">
        <input type="text" id="${esc(id('name'))}" data-pf="${esc(p.name)}" data-field="name" placeholder="Name, e.g. Maria" value="${esc(d.name || '')}" maxlength="40">
        <input type="text" id="${esc(id('age'))}" data-pf="${esc(p.name)}" data-field="age" placeholder="Age" value="${esc(d.age || '')}" maxlength="3" inputmode="numeric">
        <label>IT skill ${sel('it_skill', SKILLS, d.it_skill || 'average')}</label>
        <label>Device ${sel('device', DEVICES, d.device || 'phone')}</label>
        <input type="text" id="${esc(id('goals'))}" data-pf="${esc(p.name)}" data-field="goals" placeholder="Goals, e.g. book a yoga class for Tuesday" value="${esc(d.goals || '')}" maxlength="200">
        <input type="text" id="${esc(id('needs'))}" data-pf="${esc(p.name)}" data-field="needs" placeholder="Needs, e.g. poor eyesight, impatient, Spanish" value="${esc(d.needs || '')}" maxlength="200">
        <button type="button" class="btn" data-add-persona="${esc(p.name)}">Add profile</button>
      </div>
    </div>
  </details>`;
}

function projectMsg(project, text) {
  const el = document.getElementById(`pmsg-${project}`);
  if (el) { el.textContent = text; el.hidden = false; }
}

// Sends a directive to the project's agent with the given role, falling back to the lead.
async function directProject(project, role, text) {
  const pr = S.projects.find((x) => x.name === project) || {};
  const agents = S.agents.filter((a) => a.project === project);
  const target = (agents.find((a) => a.role === role) || {}).agent || pr.lead || (agents.find((a) => a.role === 'lead') || {}).agent;
  if (!target) throw new Error('This project has no lead agent yet.');
  await db.collection('directives').add({ to: target, project, from: 'ceo', text, timestamp: new Date().toISOString(), read: false });
  return target;
}

// GitHub status an agent recorded on a task or card: pull request, CI result, preview link.
const CI_LABEL = { pass: 'CI passed', fail: 'CI failed', pending: 'CI running' };
function githubHtml(x) {
  const pr = x && x.pr && typeof x.pr === 'object' ? x.pr : null;
  const prUrl = pr ? safeUrl(pr.url) : '';
  const prev = x ? safeUrl(x.preview_url) : '';
  if (!prUrl && !prev) return '';
  const parts = [];
  if (prUrl) parts.push(`<a href="${esc(prUrl)}" target="_blank" rel="noopener">PR${pr.number ? ` #${esc(pr.number)}` : ''}</a>`);
  if (prUrl && CI_LABEL[pr.ci]) parts.push(`<span class="ci ${esc(pr.ci)}" title="${pr.checked_at ? `checked ${esc(ago(pr.checked_at))}` : ''}">${CI_LABEL[pr.ci]}</span>`);
  if (prev) parts.push(`<a href="${esc(prev)}" target="_blank" rel="noopener">Preview</a>`);
  return `<span class="gh">${parts.join('')}</span>`;
}

function checksText(t) {
  const req = arr(t.checks_required);
  if (!req.length || t.status === 'backlog' || t.status === 'ready-for-dev') return '';
  const c = t.checks || {};
  return ' · ' + req.map((k) => `${k} ${c[k] ? (c[k].result === 'pass' ? 'passed' : 'failed') : 'pending'}`).join(', ');
}

// Short, computed summary of the last 24 hours per project, most important project first. No agent, no cost.
function renderDigest() {
  const since = Date.now() - 24 * 3600e3;
  const lines = S.projects.slice().sort((a, b) => PRIO_RANK[a.priority || 'P2'] - PRIO_RANK[b.priority || 'P2'] || String(a.name).localeCompare(String(b.name))).map((p) => {
    const tasks = S.tasks.filter((t) => t.project === p.name);
    const its = S.items.filter((i) => i.project === p.name);
    const done = tasks.filter((t) => t.status === 'done' && ms(t.updated_at || t.done_at) > since).length;
    const delivered = its.filter((i) => i.type === 'delivery' && ms(i.timestamp) > since).length;
    const needs = its.filter((i) => i.needs_me && i.status === 'open').length;
    const failed = tasks.filter((t) => t.status === 'in-progress' && Object.values(t.checks || {}).some((c) => c && c.result === 'fail')).length;
    const stalled = tasks.filter((t) => t.status === 'in-progress' && (S.agents.find((a) => a.agent === t.owner) || {}).last_seen && Date.now() - ms((S.agents.find((a) => a.agent === t.owner) || {}).last_seen) > 2 * 3600e3).length;
    const flags = its.filter((i) => i.type === 'audit' && i.priority === 'high' && i.status === 'info').length;
    const parts = [];
    if (done) parts.push(`${done} task${done === 1 ? '' : 's'} done`);
    if (delivered) parts.push(`${delivered} delivered`);
    if (failed) parts.push(`${failed} sent back by checks`);
    if (stalled) parts.push(`${stalled} stalled`);
    if (flags) parts.push(`${flags} lead flag${flags === 1 ? '' : 's'}`);
    if (needs) parts.push(`<b>${needs} need${needs === 1 ? 's' : ''} you</b>`);
    if (!parts.length) return null;
    return `<li><b>${esc(p.name)}</b> (${esc(p.priority || 'P2')}): ${parts.join(', ')}</li>`;
  }).filter(Boolean).slice(0, 6);
  document.getElementById('digest-block').hidden = !lines.length;
  document.getElementById('digest').innerHTML = lines.join('');
}

// ---------- cost per project ----------
// Costs come from the Claude Code sessions the hub started (get_session). The page stores them on
// the agents and projects docs, so the lead can enforce the budget while this page is closed.
const budgetDrafts = {};
const money = (n) => `$${(Math.round(Number(n) * 100) / 100).toFixed(2)}`;

function projectSpent(p) {
  return S.agents.filter((a) => a.project === p.name).reduce((t, a) => t + (Number(a.cost_usd) || 0), 0);
}

function costHtml(p) {
  const spent = projectSpent(p);
  const budget = Number(p.budget_usd) || 0;
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const state = budget && spent >= budget ? 'over' : budget && spent >= 0.8 * budget ? 'near' : '';
  const draft = Object.prototype.hasOwnProperty.call(budgetDrafts, p.name) ? budgetDrafts[p.name] : (budget || '');
  return `<div class="cost${state ? ` ${state}` : ''}">
    <p><strong>${money(spent)}</strong> spent${budget ? ` of ${money(budget)} budget` : ''}${state === 'over' ? ' <span class="chip hot">Budget reached</span>' : state === 'near' ? ' <span class="chip soft">80% of budget</span>' : ''}</p>
    ${budget ? `<div class="bar" role="img" aria-label="${Math.round(pct)}% of budget used"><span style="width:${pct}%"></span></div>` : ''}
    <label class="budget" for="budget-${esc(p.name)}">Budget in $ <input type="number" min="0" step="5" inputmode="decimal" id="budget-${esc(p.name)}" data-budget="${esc(p.name)}" value="${esc(draft)}" placeholder="none"></label>
  </div>`;
}

let costsOn = false;
let costsRun = false;
let costsBusy = false;
async function refreshCosts() {
  if (!costsOn || !db || costsBusy) return;
  if (!S.agents.length) return; // the agents snapshot calls this again once it arrives
  costsBusy = true; costsRun = true;
  for (const a of S.agents.filter((x) => x.session_id)) {
    try {
      const r = await mcp.callTool(CC, 'get_session', { session_id: a.session_id }, { cache: false });
      const pl = r.payload || {};
      const sess = pl.ccr || pl;
      const meta = (sess && sess.external_metadata) || {};
      const upd = {};
      const usd = Number(meta.usage && meta.usage.cost_usd);
      if (Number.isFinite(usd) && Math.round(usd * 100) / 100 !== Number(a.cost_usd)) { upd.cost_usd = Math.round(usd * 100) / 100; upd.cost_at = new Date().toISOString(); }
      // Subscription limit as the session reports it: status, window and when it resets.
      const rl = meta.rate_limit_info;
      const lim = rl && rl.status ? { status: String(rl.status), type: String(rl.rateLimitType || ''), resets_at: Number(rl.resetsAt) ? new Date(Number(rl.resetsAt) * 1000).toISOString() : null } : null;
      if (JSON.stringify(lim) !== JSON.stringify(a.limit || null)) upd.limit = lim;
      if (Object.keys(upd).length) await db.doc(`agents/${a.agent}`).update(upd);
    } catch (e) { /* keep the last known cost */ }
  }
  for (const p of S.projects) {
    const spent = Math.round(projectSpent(p) * 100) / 100;
    if (spent !== Number(p.spent_usd || 0)) { try { await db.doc(`projects/${p.name}`).update({ spent_usd: spent, spent_at: new Date().toISOString() }); } catch (e) { /* next refresh */ } }
  }
  costsBusy = false;
}

// One line per project: what is happening right now.
function statusLine(p, tasks) {
  const ag = S.agents.filter((a) => a.project === p.name);
  const running = ag.filter(isRunning).length;
  const parts = [`${running} of ${ag.length} agent${ag.length === 1 ? '' : 's'} running`];
  const asleep = ag.filter(isAsleep).length;
  if (asleep) parts.push(`<strong>${asleep} asleep</strong>`);
  const doing = tasks.filter((t) => t.status === 'in-progress');
  if (doing.length) parts.push(`${doing.map((t) => t.id).join(', ')} in progress`);
  const review = tasks.filter((t) => t.status === 'review').length;
  if (review) parts.push(`${review} in review`);
  const done = tasks.filter((t) => t.status === 'done').length;
  if (tasks.length) parts.push(`${done} of ${tasks.length} done`);
  else if ((p.phase || 'planning') === 'planning') parts.push('plan being written');
  const need = S.items.filter((i) => i.project === p.name && i.needs_me && i.status === 'open' && !isSnoozed(i)).length;
  parts.push(need ? `<strong>${need} need${need === 1 ? 's' : ''} you</strong>` : 'nothing needs you');
  const last = ag.map((a) => ms(a.last_seen)).sort((x, y) => y - x)[0];
  if (last) parts.push(`last activity ${esc(ago(new Date(last).toISOString()))}`);
  return parts.join(' · ');
}

function renderProjects() {
  document.getElementById('projects-block').hidden = !S.projects.length;
  const order = ['done', 'review', 'in-progress', 'ready-for-dev', 'backlog'];
  const label = { done: 'done', review: 'in review', 'in-progress': 'in progress', 'ready-for-dev': 'ready', backlog: 'backlog' };
  document.getElementById('projects').innerHTML = S.projects.slice().sort((a, b) => PRIO_RANK[a.priority || 'P2'] - PRIO_RANK[b.priority || 'P2'] || String(a.name).localeCompare(String(b.name))).map((p) => {
    const tasks = S.tasks.filter((t) => t.project === p.name).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    const n = Object.fromEntries(order.map((st) => [st, tasks.filter((t) => t.status === st).length]));
    const ideas = S.items.filter((i) => i.type === 'idea' && i.project === p.name && ['parked', 'kept'].includes(i.status)).length;
    const seg = tasks.length ? order.filter((st) => n[st]).map((st) => `<span class="${st}" style="width:${(n[st] / tasks.length) * 100}%"></span>`).join('') : '';
    return `<div class="project">
      <div class="project-top"><h3>${esc(p.name)}</h3><span class="chip${p.phase === 'building' ? ' soft' : ''}">${esc(p.phase || 'planning')}</span></div>
      <p class="pstatus">${statusLine(p, tasks)}</p>
      ${stoppedCount(p.name) && (startBlocked || !mcp) ? `<div class="start-row"><button type="button" class="btn" data-copy-start="${esc(p.name)}">Copy start request</button><span class="hint">${stoppedCount(p.name)} agent${stoppedCount(p.name) === 1 ? '' : 's'} not running. Paste it into a Claude Code session to start ${stoppedCount(p.name) === 1 ? 'it' : 'them'}.</span></div>` : ''}
      <label class="prio" for="prio-${esc(p.name)}">Priority <select id="prio-${esc(p.name)}" data-prio="${esc(p.name)}">${['P1', 'P2', 'P3'].map((v) => `<option${(p.priority || 'P2') === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      ${costHtml(p)}
      <label class="auto" for="auto-${esc(p.name)}"><input type="checkbox" id="auto-${esc(p.name)}" data-auto="${esc(p.name)}"${p.auto_release === false ? '' : ' checked'}> Release automatically when all checks pass</label>
      ${p.goal ? `<p>${esc(p.goal)}</p>` : ''}
      <div class="seg" role="img" aria-label="${n.done} of ${tasks.length} tasks done">${seg}</div>
      <div class="legend">${tasks.length ? order.filter((st) => n[st]).map((st) => `<span><i class="${st}"></i>${n[st]} ${label[st]}</span>`).join('') : `<span>${p.phase === 'planning' ? 'The lead is writing the plan' : 'No tasks yet'}</span>`}${ideas ? `<span>${ideas} idea${ideas === 1 ? '' : 's'} parked</span>` : ''}</div>
      <details id="plan-${esc(p.name)}" data-keep${openDetails.has(`plan-${p.name}`) ? ' open' : ''}><summary>Plan and tasks</summary>
        <div class="cards">
          <p><strong>In scope:</strong> ${arr(p.scope).map(esc).join('; ') || 'not set yet'}</p>
          ${arr(p.never).length ? `<p><strong>Never:</strong> ${arr(p.never).map(esc).join('; ')}</p>` : ''}
          <ul class="tasks">${tasks.map((t) => `<li><span class="tid">${esc(t.id)}</span><span>${esc(t.title)}</span><span class="tstatus ${esc(t.status)}">${esc(label[t.status] || t.status)}${t.owner ? ` · ${esc(t.owner)}` : ''}${t.pending_owner ? ` → ${esc(t.pending_owner)}` : ''}${checksText(t)}</span>${githubHtml(t)}</li>`).join('')}</ul>
        </div>
      </details>
      ${profilesHtml(p)}
      <div class="row"><button type="button" class="btn" data-run-audit="${esc(p.name)}">Run code audit</button></div>
      <p class="hint" id="pmsg-${esc(p.name)}" hidden></p>
    </div>`;
  }).join('');
}

function renderFilters() {
  const agents = [...new Set(S.items.map((i) => i.agent).concat(S.agents.map((a) => a.agent)))].filter(Boolean).sort();
  const projects = [...new Set(S.items.map((i) => i.project).concat(S.projects.map((p) => p.name)))].filter(Boolean).sort();
  let changed = false;
  if (filters.agent && !agents.includes(filters.agent)) { filters.agent = ''; changed = true; }
  if (filters.project && !projects.includes(filters.project)) { filters.project = ''; changed = true; }
  if (changed) saveFilters();
  const opt = (id, values, label, cur) => {
    document.getElementById(id).innerHTML = `<option value="">All ${label}</option>` + values.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(TYPE_LABEL[v] || v)}</option>`).join('');
  };
  opt('flt-agent', agents, 'agents', filters.agent);
  opt('flt-project', projects, 'projects', filters.project);
  opt('flt-type', Object.keys(TYPE_LABEL), 'types', filters.type);
}


// ---------- progress card: one plain-words timeline per active project ----------
const CHECK_MARK = { pass: 'passed', fail: 'failed' };
function progressHtml(p) {
  const tasks = S.tasks.filter((t) => t.project === p.name).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const items = S.items.filter((i) => i.project === p.name);
  const ag = S.agents.filter((a) => a.project === p.name);
  const byName = Object.fromEntries(ag.map((a) => [a.agent, a]));
  const steps = [];
  const plan = items.filter((i) => /^plan\b/i.test(i.title || '') && ['approval', 'question'].includes(i.type)).sort((x, y) => ms(y.timestamp) - ms(x.timestamp))[0];
  const phase = p.phase || 'planning';
  if (phase !== 'planning' || (plan && plan.answer && plan.answer.decision === 'approve')) {
    steps.push({ state: 'done', text: `Plan approved${plan && plan.answer ? ` (${hhmm(plan.answer.at)})` : ''}` });
  } else if (plan && plan.status === 'open') {
    steps.push({ state: 'you', text: 'Plan waiting for you in Needs you' });
  } else {
    const lead = byName[p.lead] || ag.find((a) => roleOf(a.agent) === 'lead');
    steps.push({ state: 'now', text: `Plan: the lead is writing it${lead && lead.doing ? ` (${lead.doing})` : ''}` });
  }
  for (const t of tasks) {
    const title = `${t.id} ${t.title || ''}`.trim();
    if (t.status === 'done') { steps.push({ state: 'done', text: `${title}: done` }); continue; }
    if (t.status === 'review') {
      const c = t.checks || {};
      const list = arr(t.checks_required).map((k) => `${k} ${c[k] ? CHECK_MARK[c[k].result] || c[k].result : 'running'}`).join(' · ');
      steps.push({ state: 'now', text: `${title}: in checks (${list})` });
      continue;
    }
    if (t.status === 'in-progress') {
      const o = byName[t.owner] || {};
      const doing = o.doing || o.last_status_title || 'building';
      steps.push({ state: 'now', text: `${title}: ${doing}`, sub: `${t.owner || 'builder'} · started ${ago(t.updated_at)}${o.last_seen ? ` · last update ${ago(o.last_seen)}` : ''}${t.review_loops ? ` · round ${t.review_loops + 1} after failed checks` : ''}` });
      continue;
    }
    const waits = arr(t.depends_on).filter((d) => { const dt = tasks.find((x) => x.id === d); return dt && dt.status !== 'done'; });
    steps.push({ state: 'todo', text: `${title}${waits.length ? ` (after ${waits.join(', ')})` : ''}` });
  }
  const delivery = items.filter((i) => i.type === 'delivery').sort((x, y) => ms(y.timestamp) - ms(x.timestamp))[0];
  if (delivery) steps.push({ state: delivery.status === 'open' ? 'you' : 'done', text: delivery.status === 'open' ? 'Delivery ready for you to review' : 'Delivered' });
  else steps.push({ state: 'todo', text: 'Delivery for you to review' });
  const current = steps.findIndex((s) => s.state !== 'done');
  const stepNo = current === -1 ? steps.length : current + 1;
  const running = ag.filter(isRunning).length;
  const asleep = ag.filter(isAsleep).length;
  const limited = ag.filter(isLimited).length;
  const need = items.filter((i) => i.needs_me && i.status === 'open' && !isSnoozed(i)).length;
  const icon = { done: '✓', now: '●', you: '!', todo: '○' };
  const foot = [`${running} of ${ag.length} agents working`];
  if (asleep) foot.push(`<strong>${asleep} asleep</strong>`);
  if (limited) foot.push(`<strong>${limited} stopped on a usage limit</strong>`);
  foot.push(need ? `<strong>${need} need${need === 1 ? 's' : ''} you</strong>` : 'nothing needs you');
  return `<article class="card progress">
    <div class="progress-top"><h3>${esc(p.name)}</h3><span class="count">${current === -1 ? 'Complete' : `Step ${stepNo} of ${steps.length}`}</span></div>
    <ol class="steps-list">${steps.map((s) => `<li class="${s.state}"><span class="ico" aria-hidden="true">${icon[s.state]}</span><span><span class="sr">${{ done: 'Done: ', now: 'In progress: ', you: 'Needs you: ', todo: 'To do: ' }[s.state]}</span>${esc(s.text)}${s.sub ? `<br><span class="hint">${esc(s.sub)}</span>` : ''}</span></li>`).join('')}</ol>
    <p class="pstatus">${foot.join(' · ')}</p>
  </article>`;
}

function renderProgress() {
  const list = S.projects.filter((p) => p.phase !== 'complete').sort((a, b) => PRIO_RANK[a.priority || 'P2'] - PRIO_RANK[b.priority || 'P2']);
  document.getElementById('progress-block').hidden = !list.length;
  document.getElementById('progress').innerHTML = list.map(progressHtml).join('');
}
