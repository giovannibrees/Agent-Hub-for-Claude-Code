document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); t.textContent = 'Copied'; }
    catch (x) { const code = t.previousElementSibling; if (code) window.getSelection().selectAllChildren(code); t.textContent = 'Press Ctrl+C'; }
    setTimeout(() => { t.textContent = 'Copy'; }, 1600);
    return;
  }
  if (t.dataset.act) { if (MEANING[t.dataset.act]) queueAct(t.dataset.id, t.dataset.act); else act(t.dataset.id, t.dataset.act); return; }
  if (t.dataset.undo) { undoAct(t.dataset.undo); return; }
  if (t.dataset.wake) { snooze(t.dataset.wake, null); return; }
  if (t.dataset.fbUnfile) { const l = fbFiles[t.dataset.fbUnfile] || []; l.splice(Number(t.dataset.n), 1); render(); return; }
  if (t.dataset.resume) { scheduleResume([t.dataset.resume]); return; }
  if (t.id === 'resume-all') { scheduleResume(limitedAgents().map((a) => a.agent)); return; }
  if (t.dataset.fbOpen) {
    const id = t.dataset.fbOpen;
    if (Object.prototype.hasOwnProperty.call(drafts, id)) delete drafts[id]; else drafts[id] = '';
    render();
    const i = document.getElementById(`fb-${id}`); if (i) i.focus();
    return;
  }
  if (t.dataset.fbSend) {
    const id = t.dataset.fbSend;
    const text = (drafts[id] || '').trim();
    if (uploading[id]) { uploadErr[id] = 'Wait for the upload to finish, then send.'; render(); return; }
    if (text || (fbFiles[id] || []).length) queueAct(id, 'feedback', text); else { const i = document.getElementById(`fb-${id}`); if (i) i.focus(); }
    return;
  }
  if (t.dataset.filterAgent) { filters.agent = filters.agent === t.dataset.filterAgent ? '' : t.dataset.filterAgent; saveFilters(); render(); return; }
  if (t.dataset.msgOpen) { msgDrafts[t.dataset.msgOpen] = ''; render(); const i = document.querySelector(`[data-msg-input="${CSS.escape(t.dataset.msgOpen)}"]`); if (i) i.focus(); return; }
  if (t.dataset.msgSend) { sendMessage(t.dataset.msgSend, t); return; }
  if (t.dataset.jump) { const el = document.getElementById(t.dataset.jump); if (el) { const d = el.querySelector('details'); if (d) d.open = true; el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } return; }
  if (t.id === 'bc-toggle') { const p = document.getElementById('bc-panel'); p.hidden = !p.hidden; document.getElementById('add-panel').hidden = true; if (!p.hidden) document.getElementById('bc-text').focus(); return; }
  if (t.id === 'bc-cancel') { document.getElementById('bc-panel').hidden = true; return; }
  if (t.id === 'add-toggle') { document.getElementById('bc-panel').hidden = true; }
  if (t.id === 'add-toggle') { const p = document.getElementById('add-panel'); p.hidden = !p.hidden; if (!p.hidden) document.getElementById('f-name').focus(); return; }
  if (t.id === 'add-cancel') { document.getElementById('add-panel').hidden = true; return; }
  if (t.dataset.addPersona && db) {
    const project = t.dataset.addPersona;
    const d = pfDrafts[project] || {};
    const name = String(d.name || '').trim();
    const age = parseInt(d.age, 10);
    if (!name || !(age > 0 && age < 120)) { projectMsg(project, 'Give the profile a name and an age.'); return; }
    t.disabled = true;
    delete pfDrafts[project];
    try {
      await db.doc(`personas/${project}--${slug(name)}`).set({ project, name, age, it_skill: d.it_skill || 'average', device: d.device || 'phone',
        goals: String(d.goals || '').trim(), needs: String(d.needs || '').trim(), created_at: new Date().toISOString() });
      render();
      projectMsg(project, `Added ${name}.`);
    } catch (x) { pfDrafts[project] = d; render(); projectMsg(project, 'Could not save the profile. Try again.'); }
    return;
  }
  if (t.dataset.delPersona && db) { try { await db.doc(`personas/${t.dataset.delPersona}`).delete(); } catch (x) { /* stays listed */ } return; }
  if (t.dataset.runTest && db) {
    const project = t.dataset.runTest;
    const who = t.dataset.persona;
    t.disabled = true;
    try {
      const to = await directProject(project, 'usertest', `Run a user test ${who ? `as the customer profile "${who}"` : 'with every customer profile'} (protocol section 8). Report per profile.`);
      projectMsg(project, `User test requested from ${to}.`);
    } catch (x) { projectMsg(project, x.message || 'Could not send. Try again.'); }
    t.disabled = false;
    return;
  }
  if (t.dataset.runAudit && db) {
    const project = t.dataset.runAudit;
    t.disabled = true;
    try {
      const to = await directProject(project, 'lead', 'Run a code audit (protocol section 9): security, cleanup and reviewer passes over the whole codebase, then one approval card with the fixes.');
      projectMsg(project, `Code audit requested from ${to}.`);
    } catch (x) { projectMsg(project, x.message || 'Could not send. Try again.'); }
    t.disabled = false;
    return;
  }
  if (t.dataset.start) { startAgent(t.dataset.start); return; }
  if (t.dataset.startAll) {
    const project = t.dataset.startAll; const msg = document.getElementById('start-all-msg');
    t.disabled = true; if (msg) msg.textContent = 'Starting the agents...';
    await startProject(project);
    const failed = S.agents.filter((a) => a.project === project && startErr[a.agent]);
    const started = S.agents.filter((a) => a.project === project && a.session_id).length;
    if (msg) msg.textContent = failed.length ? startErr[failed[0].agent] : `${started} agent${started === 1 ? '' : 's'} started. Each one appears under Agents with an Open session link.`;
    t.disabled = !!started && !failed.length;
    return;
  }
  if (t.id === 'b-write') { writeBrief(); return; }
  if (t.id === 'perm-fix') {
    const banner = document.getElementById('perm');
    try {
      if (!perms) throw new Error('no panel');
      await perms.manage();
      const st = await perms.state('db');
      if (st === 'granted' || st === 'prompt') { banner.hidden = true; for (const k of Object.keys(saveErr)) delete saveErr[k]; render(); }
    } catch (x) { banner.textContent = 'Your answers cannot be saved. Open this page\'s Permissions menu on claude.ai, allow its database, then reload.'; }
    return;
  }
  if (t.id === 'flt-clear') { filters = { agent: '', project: '', type: '' }; saveFilters(); render(); return; }
  if (t.id === 'add-another') { document.getElementById('add-result').hidden = true; const f = document.getElementById('add-form'); f.reset(); f.hidden = false; return; }
  if (t.id === 'prune' && db) {
    t.disabled = true;
    const old = S.items.filter((i) => ['answered', 'acknowledged', 'archived', 'auto_resolved', 'accepted', 'info'].includes(i.status) && Date.now() - ms(i.timestamp) > 30 * 864e5);
    for (const i of old) { try { await db.doc(`items/${i.id}`).delete(); await db.doc(`answers/${i.id}`).delete(); } catch (x) { break; } }
  }
});

document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches || !d.matches('details[data-keep]')) return;
  if (d.open) openDetails.add(d.id); else openDetails.delete(d.id);
}, true);
document.addEventListener('change', (e) => {
  if (e.target.dataset.snooze) { const until = snoozeTime(e.target.value); if (until) snooze(e.target.dataset.snooze, until); return; }
  if (e.target.dataset.fbFile) { attachFiles(e.target.dataset.fbFile, [...e.target.files]); return; }
  if (e.target.dataset.budget) {
    const name = e.target.dataset.budget;
    const v = e.target.value.trim() === '' ? 0 : Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;
    db.doc(`projects/${name}`).update({ budget_usd: Math.round(v * 100) / 100 })
      .then(() => { delete budgetDrafts[name]; render(); })
      .catch((x) => projectMsg(name, saveMessage(x)));
    return;
  }
  if (e.target.id === 'alerts-level') {
    const err = document.getElementById('alerts-err'); err.hidden = true;
    db.doc('config/alerts').set({ level: e.target.value, updated_at: new Date().toISOString() })
      .catch((x) => { err.textContent = saveMessage(x); err.hidden = false; });
    return;
  }
  if (e.target.id === 'env-pick') { try { localStorage.setItem('hub-env', e.target.value); } catch (x) { /* storage blocked */ } return; }
  const t = e.target;
  if (t.dataset && t.dataset.pf && t.tagName === 'SELECT') (pfDrafts[t.dataset.pf] = pfDrafts[t.dataset.pf] || {})[t.dataset.field] = t.value;
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.budget) { budgetDrafts[e.target.dataset.budget] = e.target.value; return; }
  if (e.target.id === 'search') { searchQ = e.target.value; render(); return; }
  const t = e.target;
  if (t.dataset.pf) { (pfDrafts[t.dataset.pf] = pfDrafts[t.dataset.pf] || {})[t.dataset.field] = t.value; }
  if (t.dataset.fbInput) drafts[t.dataset.fbInput] = t.value;
  if (t.dataset.msgInput) msgDrafts[t.dataset.msgInput] = t.value;
});
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape' && t.dataset.fbInput) { delete drafts[t.dataset.fbInput]; t.blur(); render(); return; }
  if (e.key === 'Escape' && t.dataset.msgInput) { delete msgDrafts[t.dataset.msgInput]; t.blur(); render(); return; }
  if (e.key !== 'Enter') return;
  if (t.dataset.fbInput) { e.preventDefault(); const b = document.querySelector(`[data-fb-send="${CSS.escape(t.dataset.fbInput)}"]`); if (b) b.click(); }
  if (t.dataset.msgInput) { e.preventDefault(); const b = document.querySelector(`[data-msg-send="${CSS.escape(t.dataset.msgInput)}"]`); if (b) b.click(); }
});
document.getElementById('bc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = clean(document.getElementById('bc-text').value).trim();
  const st = document.getElementById('bc-status');
  const leads = S.agents.filter((a) => a.role === 'lead');
  st.hidden = false;
  if (!db) { st.textContent = 'The database is not available here.'; return; }
  if (!text) return;
  if (!leads.length) { st.textContent = 'There are no lead agents yet. Add a project with a lead first.'; return; }
  const btn = document.getElementById('bc-send');
  btn.disabled = true;
  const bid = `bc_${Date.now().toString(36)}`;
  let sent = 0;
  for (const l of leads) {
    try { await db.collection('directives').add({ to: l.agent, project: l.project || '', from: 'ceo', text, broadcast: bid, timestamp: new Date().toISOString(), read: false }); sent++; } catch (x) { break; }
  }
  btn.disabled = false;
  st.textContent = sent === leads.length ? `Sent to ${sent} lead${sent === 1 ? '' : 's'}: ${leads.map((l) => l.agent).join(', ')}.` : `Sent to ${sent} of ${leads.length} leads. Try again for the rest.`;
  if (sent === leads.length) document.getElementById('bc-text').value = '';
});

document.getElementById('f-team').addEventListener('change', (e) => { document.getElementById('f-agents').value = e.target.value; });

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.auto && db) {
    try { await db.doc(`projects/${t.dataset.auto}`).update({ auto_release: t.checked }); } catch (x) { t.checked = !t.checked; }
    return;
  }
  if (!t.dataset || !t.dataset.prio || !db) return;
  try { await db.doc(`projects/${t.dataset.prio}`).update({ priority: t.value }); } catch (x) { t.closest('.project').insertAdjacentHTML('beforeend', '<p class="error">Could not save the priority. Try again.</p>'); }
});

document.getElementById('filters').addEventListener('change', (e) => {
  const key = { 'flt-agent': 'agent', 'flt-project': 'project', 'flt-type': 'type' }[e.target.id];
  if (key) { filters[key] = e.target.value; saveFilters(); render(); }
});

