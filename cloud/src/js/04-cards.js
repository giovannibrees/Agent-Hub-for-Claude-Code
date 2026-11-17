function bulletsHtml(it) {
  const b = arr(it.bullets);
  if (!b.length) return '';
  const recs = arr(it.recommendations);
  const strip = (x) => String(x).replace(/^\s*\d+[.)]\s*/, '');
  if (recs.length > 1 && recs.length === b.length) {
    return `<ol>${b.map((x, i) => `<li>${esc(strip(x))}<span class="rec-n">Recommended: ${esc(recs[i])}</span></li>`).join('')}</ol>`;
  }
  return b.every((x) => /^\s*\d+[.)]\s/.test(x)) ? `<ol>${b.map((x) => `<li>${esc(strip(x))}</li>`).join('')}</ol>` : `<ul>${b.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

function safeUrl(u) {
  const s = String(u || '');
  if (/^(https?:\/\/|\/_blob\/)/.test(s)) return s;
  // Only the demo page embeds its sample screenshots; the live hub never accepts data URLs.
  return window.HUB_DEMO && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
}

function attachmentsHtml(it) {
  const out = [];
  for (const a of arr(it.attachments)) {
    const url = safeUrl(typeof a === 'string' ? a : a.url);
    const name = (typeof a === 'object' && a.name) || url.split('/').pop();
    const isImg = (typeof a === 'object' && a.kind === 'image') || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) || url.startsWith('/_blob/');
    if (!url) continue;
    out.push(isImg ? `<a class="shot" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></a>`
      : `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a></p>`);
  }
  const colors = arr(it.colors).filter((c) => c && /^#?[0-9a-f]{3,8}$/i.test(String(c.hex || '')));
  if (colors.length) {
    out.push(`<div class="tablewrap"><table class="colors"><thead><tr><th></th><th>Name</th><th>Hex</th><th>Use</th></tr></thead><tbody>${colors.map((c) => {
      const hex = String(c.hex).startsWith('#') ? c.hex : `#${c.hex}`;
      return `<tr><td><span class="swatch" style="background:${esc(hex)}"></span></td><td>${esc(c.name || '')}</td><td class="hex">${esc(hex)}</td><td>${esc(c.usage || c.use || '')}</td></tr>`;
    }).join('')}</tbody></table></div>`);
  }
  return out.join('');
}

function cardHtml(it, opts) {
  opts = opts || {};
  const meta = [TYPE_LABEL[it.type] || it.type, it.agent, it.project, ago(it.timestamp)];
  if (it.type === 'handover' && it.to_agent) meta.splice(2, 0, `to ${it.to_agent}`);
  if (it.task) meta.push(`task ${it.task}`);
  if (it.reply_to) meta.push('follow-up');
  const parts = [`<h3>${esc(it.title)}</h3>`,
    `<p class="meta"><span class="chip">${esc(TYPE_LABEL[it.type] || it.type)}</span>${it.needs_me && it.status === 'open' && projectPrio(it.project) === 'P1' ? '<span class="chip soft">P1 project</span>' : ''}${it.priority === 'high' ? '<span class="chip hot">High priority</span>' : ''}${it.change ? `<span class="chip soft">Scope change: ${esc(it.change)}</span>` : ''}<span>${meta.slice(1).map(esc).join(' · ')}</span></p>`,
    bulletsHtml(it)];
  const links = arr(it.links);
  if (links.length) parts.push(`<ul>${links.map((l) => { const u = safeUrl(l); return `<li>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>` : esc(l)}</li>`; }).join('')}</ul>`);
  const gh = githubHtml(it);
  if (gh) parts.push(`<p class="gh-line">${gh}</p>`);
  if (arr(it.verification).length) parts.push(`<ul class="evidence">${arr(it.verification).map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`);
  parts.push(attachmentsHtml(it));
  const open = it.needs_me && it.status === 'open';
  const batched = arr(it.recommendations).length > 1;
  if (it.recommendation && !(batched && open)) parts.push(`<div class="rec"><strong>Recommendation:</strong> ${esc(it.recommendation)}</div>`);
  if (batched && open) parts.push('<div class="rec"><strong>Approve</strong> accepts every numbered recommendation above.</div>');
  const v = violations(it);
  if (v.length) parts.push(`<p class="violation">Protocol: ${esc(v.join(', '))}</p>`);
  if (hasHidden(it)) parts.push('<p class="violation">Hidden characters were removed from this card. They can hide instructions from you: read it carefully before you approve.</p>');
  if (open) {
    if (it.reversible === true && !it.change) {
      const left = until(it.auto_proceed_at || new Date(ms(it.timestamp) + 4 * 3600e3).toISOString());
      parts.push(`<p class="timer">${left ? `Agent proceeds with its recommendation in ${left} if you do not answer.` : 'Past 4 hours: the agent may proceed with its recommendation.'}</p>`);
    } else parts.push('<p class="timer">Not reversible: the agent waits for you.</p>');
    const off = saving[it.id] ? ' disabled' : '';
    const pend = pendingAct[it.id];
    if (pend) parts.push(`<div class="undo" role="status"><span>${esc(DECISION_LABEL[pend.action] || pend.action)}: sending in a few seconds.</span><button class="btn" data-undo="${esc(it.id)}">Undo</button></div>`);
    else parts.push(`<div class="actions">
      <button class="btn primary" data-act="approve" data-id="${esc(it.id)}"${off}>Approve</button>
      <button class="btn" data-fb-open="${esc(it.id)}"${off}>Feedback</button>
      <button class="btn" data-act="more_info" data-id="${esc(it.id)}"${off}>More info</button>
      <button class="btn" data-act="reject" data-id="${esc(it.id)}"${off}>Not approved</button>
      ${isSnoozed(it) ? `<button class="btn" data-wake="${esc(it.id)}">Wake now</button>` : `<select class="snooze" data-snooze="${esc(it.id)}" aria-label="Snooze this card"${off}><option value="">Snooze</option><option value="1h">1 hour</option><option value="3h">3 hours</option><option value="tomorrow">Tomorrow 9:00</option><option value="monday">Monday 9:00</option></select>`}</div>`);
    if (isSnoozed(it)) parts.push(`<p class="hint">Snoozed until ${esc(new Date(it.snoozed_until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}.</p>`);
    if (saving[it.id]) parts.push('<p class="hint" role="status">Saving your answer...</p>');
    if (saveErr[it.id]) parts.push(`<p class="error" role="alert">${esc(saveErr[it.id])}</p>`);
    if (Object.prototype.hasOwnProperty.call(drafts, it.id) && !pend) {
      const files = fbFiles[it.id] || [];
      parts.push(`<div class="row"><input type="text" id="fb-${esc(it.id)}" data-fb-input="${esc(it.id)}" value="${esc(drafts[it.id])}" placeholder="${arr(it.bullets).length > 1 ? '1 yes, 2 no, 3 use option B' : 'Your answer'}" maxlength="1000"><button class="btn primary" data-fb-send="${esc(it.id)}"${uploading[it.id] ? ' disabled' : ''}>Send</button></div>
        ${assetsCap ? `<div class="attach-row"><label class="btn attach">Attach files<input type="file" data-fb-file="${esc(it.id)}" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown"></label>
          ${files.map((f, n) => `<span class="file">${esc(f.name)} <button class="link" data-fb-unfile="${esc(it.id)}" data-n="${n}" aria-label="Remove ${esc(f.name)}">remove</button></span>`).join('')}
          ${uploading[it.id] ? '<span class="hint">Uploading...</span>' : ''}${uploadErr[it.id] ? `<span class="error">${esc(uploadErr[it.id])}</span>` : ''}</div>` : ''}
        ${arr(it.bullets).length > 1 ? '<p class="hint">Answer per number, for example: 1 yes, 2 no, 3 use option B</p>' : ''}`);
    }
  } else if (it.answer) {
    const un = unreadFor(it.id);
    const ans = S.unread.concat(S.answersAll || []).find((x) => x.item_id === it.id) || {};
    const af = arr(it.answer.attachments || ans.attachments);
    parts.push(`<p class="answer"><strong>${esc(DECISION_LABEL[it.answer.decision] || it.answer.decision)}</strong> ${ago(it.answer.at)}${it.answer.text ? `: ${esc(it.answer.text)}` : ''}${af.length ? ` (${af.length} file${af.length === 1 ? '' : 's'} attached)` : ''}${un ? `<br><span class="hint">Not picked up yet${Date.now() - ms(it.answer.at) > 30 * 60000 ? (roleOf(it.agent || '') === 'lead' ? '. The watchdog wakes the lead within the hour' : '. The lead takes it over on its next check') : ''}.</span>` : ''}</p>`);
  }
  const proj = S.projects.find((p) => p.name === it.project) || {};
  const shippable = opts.ack && it.type === 'delivery' && it.status === 'open' && !(it.pr && it.pr.merged) && (it.pr || proj.live_url);
  const shipPend = shippable && pendingAct[it.id];
  if (shipPend) parts.push(`<div class="undo" role="status"><span>Ship it: sending in a few seconds.</span><button class="btn" data-undo="${esc(it.id)}">Undo</button></div>`);
  else if (opts.ack) parts.push(`<div class="actions">${shippable ? `<button class="btn primary" data-act="ship" data-id="${esc(it.id)}">Ship it</button>` : ''}<button class="btn${shippable ? '' : ' primary'}" data-act="acknowledge" data-id="${esc(it.id)}">Acknowledge</button></div>${shippable && proj.live_url ? `<p class="hint">Ship it merges, deploys and checks ${esc(host(proj.live_url))} shows the change.</p>` : ''}`);
  if (opts.idea) parts.push(`<div class="actions">${it.status === 'kept' ? '<span class="count">Kept for after the build</span>' : `<button class="btn" data-act="keep_idea" data-id="${esc(it.id)}">Keep for later</button>`}<button class="btn" data-act="acknowledge" data-id="${esc(it.id)}">Drop</button></div>`);
  const closed = !open && !opts.ack && !opts.idea && it.status !== 'info';
  return `<article class="card${open ? ' needs' : ''}${closed ? ' closed' : ''}" data-card="${esc(it.id)}">${parts.join('')}</article>`;
}

function section(id, list, empty, opts) {
  document.getElementById(id).innerHTML = list.length ? list.map((i) => cardHtml(i, opts)).join('') : (empty ? `<p class="empty">${empty}</p>` : '');
}

// Project tabs: the page shows one project at a time (or all). The choice is remembered per browser.
let curProject = null;
function loadProjectChoice() { try { return localStorage.getItem('hub-project'); } catch (e) { return null; } }
function saveProjectChoice(v) { try { localStorage.setItem('hub-project', v); } catch (e) { /* not kept */ } }
function pickProject() {
  const names = S.projects.map((p) => p.name);
  if (curProject === null) curProject = loadProjectChoice();
  if (curProject === null || (curProject && !names.includes(curProject))) {
    const live = S.projects.filter((p) => p.phase !== 'complete' && p.created_at).sort((a, b) => ms(b.created_at) - ms(a.created_at));
    curProject = names.length > 1 ? ((live[0] || {}).name || '') : '';
  }
}
function renderTabs() {
  const nav = document.getElementById('ptabs');
  nav.hidden = S.projects.length < 2;
  if (nav.hidden) return;
  const needN = (name) => S.items.filter((i) => i.needs_me && i.status === 'open' && !isSnoozed(i) && (!name || i.project === name)).length;
  const order = S.projects.slice().sort((a, b) => (a.phase === 'complete') - (b.phase === 'complete') || ms(b.created_at) - ms(a.created_at));
  const tab = (name, label, extra) => { const n = needN(name); return `<button type="button" class="ptab${curProject === name ? ' on' : ''}${extra || ''}" data-ptab="${esc(name)}" aria-pressed="${curProject === name}">${esc(label)}${n ? ` <span class="badge">${n}</span>` : ''}</button>`; };
  nav.innerHTML = tab('', 'All projects') + order.map((p) => tab(p.name, p.name, p.phase === 'complete' ? ' done' : '')).join('');
}
// A card that a newer card replies to (a new design after feedback, an answer to More info) is
// replaced: it is hidden everywhere except search results.
function replacedIds(items) {
  const byId = new Set(items.map((i) => i.id));
  return new Set(items.map((i) => i.reply_to).filter((id) => id && byId.has(id)));
}
function render() {
  pickProject();
  renderTabs();
  const keep = { items: S.items, agents: S.agents, projects: S.projects, tasks: S.tasks, unread: S.unread, personas: S.personas };
  const replaced = clean(searchQ).trim() ? new Set() : replacedIds(keep.items);
  S.items = keep.items.filter((i) => !replaced.has(i.id));
  if (curProject) {
    const mine = (x) => (x.project || '') === curProject;
    S.items = S.items.filter(mine); S.agents = keep.agents.filter(mine); S.projects = keep.projects.filter((p) => p.name === curProject);
    S.tasks = keep.tasks.filter(mine); S.unread = keep.unread.filter(mine); S.personas = keep.personas.filter(mine);
  }
  try { renderView(); } finally { Object.assign(S, keep); }
}
function renderView() {
  const a = document.activeElement;
  const focusId = a && a.id && (a.dataset.fbInput || a.dataset.msgInput || a.dataset.pf || a.dataset.budget || a.dataset.search) && a.tagName === 'INPUT' ? a.id : null;
  const caret = focusId ? a.selectionStart : null;

  renderFilters(); renderAgents(); renderProjects(); renderDigest(); renderProgress();
  const items = S.items.filter(passes);
  const allItems = S.items; // Needs you, deliveries, flags and ideas are never hidden by filters
  const openNeeds = allItems.filter((i) => i.needs_me && i.status === 'open');
  const snoozedList = openNeeds.filter(isSnoozed).sort((x, y) => ms(x.snoozed_until) - ms(y.snoozed_until));
  const needs = openNeeds.filter((i) => !isSnoozed(i)).sort((x, y) =>
    (PRIO_RANK[projectPrio(x.project)] - PRIO_RANK[projectPrio(y.project)])
    || ((x.priority === 'high' ? 0 : 1) - (y.priority === 'high' ? 0 : 1))
    || (ms(x.timestamp) - ms(y.timestamp)));
  const deliveries = allItems.filter((i) => i.type === 'delivery' && i.status === 'open');
  const flags = allItems.filter((i) => i.type === 'audit' && i.priority === 'high' && i.status === 'info');
  const ideas = allItems.filter((i) => i.type === 'idea' && ['parked', 'kept'].includes(i.status));
  const used = new Set([...needs, ...deliveries, ...flags, ...ideas].map((i) => i.id));
  const snoozedIds = new Set(snoozedList.map((i) => i.id));
  const words = clean(searchQ).toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (i) => [i.title, i.agent, i.project, i.recommendation, ...arr(i.bullets), ...arr(i.recommendations), i.answer && i.answer.text].map((x) => clean(x).toLowerCase()).join(' ');
  const feed = words.length
    ? allItems.filter((i) => words.every((w) => hay(i).includes(w))).sort((x, y) => ms(y.timestamp) - ms(x.timestamp))
    : items.filter((i) => !used.has(i.id) && !snoozedIds.has(i.id) && i.type !== 'idea');
  const old = (i) => Date.now() - ms(i.timestamp) > 3 * 86400e3;

  const all = needs.length;
  const badge = document.getElementById('needs-count');
  badge.textContent = all;
  document.getElementById('tile-needs').classList.toggle('hot', all > 0);
  document.getElementById('t-running').textContent = S.agents.filter(isRunning).length;
  document.getElementById('t-running-label').textContent = S.agents.length ? `of ${S.agents.length} agents running` : 'Agents running';
  document.getElementById('t-deliveries').textContent = S.items.filter((i) => i.type === 'delivery' && i.status === 'open').length;
  document.getElementById('t-ideas').textContent = S.items.filter((i) => i.type === 'idea' && ['parked', 'kept'].includes(i.status)).length;
  document.title = all ? `(${all}) Agent Hub` : 'Agent Hub';

  section('needs', needs, snoozedList.length ? 'Nothing needs you right now, apart from snoozed cards.' : 'Nothing needs you right now.');
  document.getElementById('snoozed-wrap').hidden = !snoozedList.length;
  document.getElementById('snoozed-count').textContent = snoozedList.length || '';
  section('snoozed', snoozedList, '');
  for (const [key, list] of [['deliveries', deliveries], ['flags', flags]]) {
    const recent = list.filter((i) => !old(i));
    const older = list.filter(old);
    document.getElementById(`${key}-block`).hidden = !list.length;
    section(key, recent, older.length ? 'Nothing from the last 3 days.' : '', { ack: true });
    document.getElementById(`${key}-old-wrap`).hidden = !older.length;
    document.getElementById(`${key}-old-count`).textContent = older.length || '';
    section(`${key}-old`, older, '', { ack: true });
  }
  document.getElementById('deliveries-count').textContent = deliveries.length ? `${deliveries.length} to review` : '';
  document.getElementById('flags-count').textContent = flags.length || '';
  section('feed', feed.slice(0, 150), words.length ? `No cards match "${esc(searchQ.trim())}". Search covers the cards loaded on this page: everything open and the latest 300.` : S.items.length ? 'No items match these filters.' : 'Agents’ updates appear here, newest first.');
  renderLimitBanner();
  document.getElementById('ideas-count').textContent = ideas.length;
  const building = S.projects.filter((p) => p.phase !== 'complete').map((p) => p.name);
  document.getElementById('ideas-note').textContent = building.length || !S.projects.length
    ? 'New ideas and unplanned features wait here until the build is complete. Nothing here gets built without you.'
    : 'Builds are complete. Review these ideas and turn the ones you want into a new project.';
  section('ideas', ideas, 'No parked ideas.', { idea: true });
  const closedOld = S.items.filter((i) => ['answered', 'acknowledged', 'archived', 'auto_resolved', 'accepted', 'info'].includes(i.status) && Date.now() - ms(i.timestamp) > 30 * 864e5);
  document.getElementById('maintenance').innerHTML = closedOld.length ? `${closedOld.length} closed items are older than 30 days. <button class="link" id="prune">${isArmed('prune') ? 'Click again to delete them for good' : 'Delete them'}</button>` : '';

  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); if (caret != null) el.setSelectionRange(caret, caret); } }
  const live = document.getElementById('refreshed'); live.classList.remove('off'); live.textContent = `Live · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

