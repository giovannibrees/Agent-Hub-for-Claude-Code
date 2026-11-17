// Browser tests for the hub page. Run from the repo root: npm test
// Builds cloud/agent-hub.html with the demo's in-memory database and sample data, opens it in
// Chromium and checks the main flows. Failures are simulated through window.HUB_FAULTS.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'cloud/agent-hub.html'), 'utf8');
const at = page.indexOf('</title>') + '</title>'.length;
const html = page.slice(0, at)
  + '\n<meta name="viewport" content="width=device-width,initial-scale=1">'
  + `\n<script>window.HUB_UNDO_MS = 150;</script>`
  + `\n<script>\n${readFileSync(join(root, 'demo/demo-db.js'), 'utf8')}</script>`
  + `\n<script>\n${readFileSync(join(root, 'demo/data.js'), 'utf8')}</script>`
  + page.slice(at).replace('HUB_URL_PLACEHOLDER', 'https://example.com/hub');
mkdirSync(join(root, 'tests/.out'), { recursive: true });
const file = join(root, 'tests/.out/hub.html');
writeFileSync(file, html);
const URL_ = pathToFileURL(file).href;
const ATTACH = join(root, 'demo/img/portal-design.png');

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function check(cond, msg) { if (!cond) throw new Error(msg); }

async function open({ width = 1300, height = 950, faults, scheme = 'light', mobile = false, undoMs } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, colorScheme: scheme });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  if (faults) await p.addInitScript((f) => { window.HUB_FAULTS = f; }, faults);
  // A longer Undo window for tests that press Undo (the page's own 150 ms setting is then ignored).
  if (undoMs) await p.addInitScript((v) => { Object.defineProperty(window, 'HUB_UNDO_MS', { value: v, writable: false }); }, undoMs);
  await p.goto(URL_);
  await p.waitForFunction(() => document.querySelectorAll('#needs article').length > 0);
  await p.waitForTimeout(300);
  p.done = async () => { check(!p.errors.length, `page errors: ${p.errors.join(' | ')}`); await ctx.close(); };
  return p;
}
const card = (p, text, where = '#needs') => p.locator(`${where} article`, { hasText: text });
const dbGet = (p, path) => p.evaluate(async (path) => { const d = await (await window.HUB_DEMO.use('db')).doc(path).get(); return d.exists ? d.data() : null; }, path);

// ---------- answers ----------
test('Approve waits for Undo, then saves the answer', async () => {
  const p = await open({ undoMs: 1500 });
  const c = card(p, 'Payments before');
  await c.locator('[data-act=approve]').click();
  check(await c.locator('.undo').count() === 1, 'no Undo shown');
  await c.locator('[data-undo]').click();
  check(await c.locator('[data-act=approve]').count() === 1, 'Undo did not restore the buttons');
  check(!(await dbGet(p, 'answers/i1')), 'answer saved despite Undo');
  await c.locator('[data-act=approve]').click();
  await p.waitForTimeout(2200);
  const a = await dbGet(p, 'answers/i1');
  check(a && a.decision === 'approve', 'answer not saved');
  check(await card(p, 'Payments before').count() === 0, 'card still in Needs you');
  await p.done();
});

test('A refused save keeps its error and offers Allow saving', async () => {
  const p = await open({ faults: { write: 'not_granted' } });
  const c = card(p, 'Payments before');
  await c.locator('[data-act=approve]').click();
  await p.waitForTimeout(600);
  await p.evaluate(() => { render(); render(); });
  check(/not_granted/.test(await c.locator('.error').textContent()), 'error not kept after a refresh');
  check(await p.isVisible('#perm'), 'Allow saving banner missing');
  await p.click('#perm-fix');
  await p.waitForTimeout(200);
  check(!(await p.isVisible('#perm')), 'banner still shown after allowing');
  await c.locator('[data-act=approve]').click();
  await p.waitForTimeout(600);
  check((await dbGet(p, 'answers/i1')) !== null, 'retry did not save');
  await p.done();
});

test('A save the database dropped is caught by the read-back', async () => {
  const p = await open({ faults: { drop: true } });
  const c = card(p, 'Payments before');
  await c.locator('[data-act=approve]').click();
  await p.waitForTimeout(600);
  check(/did not keep your answer/.test(await c.locator('.error').textContent()), 'lost save not reported');
  await p.done();
});

test('A brief outage is retried once', async () => {
  const p = await open({ faults: { writeOnce: 'unavailable' } });
  await card(p, 'Payments before').locator('[data-act=approve]').click();
  await p.waitForTimeout(1600);
  check((await dbGet(p, 'answers/i1')) !== null, 'not saved after the retry');
  await p.done();
});

test('Feedback with an attached file; Send waits for the upload', async () => {
  const p = await open({ faults: { uploadDelay: 2500 } });
  const c = card(p, 'Client dashboard');
  await c.locator('[data-fb-open]').click();
  await c.locator('input[data-fb-input]').fill('Darker navy');
  await c.locator('[data-fb-file]').setInputFiles(ATTACH);
  const disabled = await c.locator('[data-fb-send]:disabled').waitFor({ timeout: 1500 }).then(() => true, () => false);
  check(disabled, 'Send enabled during upload');
  await c.locator('[data-fb-send]:enabled').waitFor({ timeout: 5000 });
  await c.locator('[data-fb-send]').click();
  await p.waitForTimeout(600);
  const a = await dbGet(p, 'answers/i2');
  check(a && a.decision === 'feedback' && a.text === 'Darker navy' && a.attachments.length === 1, `bad answer ${JSON.stringify(a)}`);
  await p.done();
});

test('Snooze hides a card until Wake now', async () => {
  const p = await open();
  const before = await p.locator('#needs article').count();
  await card(p, 'Payments before').locator('[data-snooze]').selectOption('1h');
  await p.waitForTimeout(300);
  check(await p.locator('#needs article').count() === before - 1, 'card not snoozed');
  check(await p.textContent('#needs-count') === String(before - 1), 'count still includes the snoozed card');
  await p.click('#snoozed-wrap summary');
  await card(p, 'Payments before', '#snoozed').locator('[data-wake]').click();
  await p.waitForTimeout(300);
  check(await p.locator('#needs article').count() === before, 'card did not wake');
  await p.done();
});

// ---------- safety and finding things ----------
test('Hidden characters are removed and the card warns', async () => {
  const p = await open();
  await p.evaluate(async () => {
    const db = await window.HUB_DEMO.use('db');
    await db.doc('items/hid').set({ id: 'hid', timestamp: new Date().toISOString(), agent: 'builder-gym-app', project: 'gym-app', type: 'question', title: 'Deploy now​?\u{E0041}', bullets: ['Ready'], recommendation: 'Yes', priority: 'normal', status: 'open', needs_me: true, reversible: false });
  });
  await p.waitForTimeout(300);
  const c = card(p, 'Deploy now');
  check(await c.locator('h3').textContent() === 'Deploy now?', 'hidden characters still in the title');
  check(/Hidden characters/.test((await c.locator('.violation').allTextContents()).join(' ')), 'no warning');
  await p.done();
});

test('Search finds cards and keeps focus', async () => {
  const p = await open();
  await p.fill('#search', 'stripe');
  await p.waitForTimeout(200);
  check((await p.locator('#feed article h3').allTextContents()).includes('Payments before we build checkout'), 'search missed the card');
  check(await p.evaluate(() => document.activeElement.id) === 'search', 'search lost focus');
  await p.fill('#search', 'zzzqqq');
  check(/No cards match/.test(await p.textContent('#feed')), 'no empty message');
  await p.done();
});

test('Old deliveries fold away; GitHub status shows', async () => {
  const p = await open();
  check(await p.textContent('#deliveries-old-count') === '1', 'old delivery not folded');
  await p.click('#plan-gym-app summary');
  const gh = (await p.locator('#plan-gym-app .gh').allTextContents()).join(' ');
  check(/PR #14/.test(gh) && /CI passed/.test(gh) && /Preview/.test(gh), `GitHub status missing: ${gh}`);
  await p.done();
});

// ---------- agents, cost, limits ----------
test('Start in the cloud uses auto mode and records the session', async () => {
  const p = await open({ faults: { mcpDelay: 20 } });
  const ag = p.locator('.agent', { hasText: 'designer-client-portal' });
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db'); await db.doc('agents/designer-client-portal').update({ last_seen: '2026-01-01T00:00:00Z' }); });
  await p.waitForTimeout(200);
  await ag.locator('[data-start]').click();
  await p.waitForTimeout(400);
  const call = (await p.evaluate(() => window.HUB_CALLS)).find((c) => c[0] === 'create_session');
  check(call && call[1].permission_mode === 'auto' && /designer-client-portal/.test(call[1].prompt), 'create_session not called right');
  check(/^https:\/\/claude\.ai\/code\//.test((await dbGet(p, 'agents/designer-client-portal')).session_url), 'session not recorded');
  await p.done();
});

test('A failed start explains why and keeps the message', async () => {
  const p = await open({ faults: { mcp: 'server_unavailable', mcpDelay: 20 } });
  await p.waitForTimeout(300);
  const ag = p.locator('.agent', { hasText: 'builder-2-gym-app' });
  await ag.locator('[data-start]').click();
  await p.waitForTimeout(300);
  await p.evaluate(() => render());
  check(/may have started anyway/.test(await ag.locator('.error').textContent()), 'no message');
  await p.done();
});

test('New project: lead starts first, github.com link without https', async () => {
  const p = await open({ faults: { mcpDelay: 20 } });
  await p.click('#add-toggle');
  await p.fill('#f-name', 'shop'); await p.fill('#f-agents', 'builder, lead');
  await p.fill('#f-repo', 'github.com/acme/shop'); await p.fill('#f-brief', 'A shop.');
  await p.click('#f-submit'); await p.waitForTimeout(400);
  await p.click('[data-start-all]'); await p.waitForTimeout(800);
  const starts = (await p.evaluate(() => window.HUB_CALLS)).filter((c) => c[0] === 'create_session').map((c) => [c[1].title, c[1].source_url]);
  check(starts.length === 2 && /^lead-shop/.test(starts[0][0]) && starts[0][1] === 'https://github.com/acme/shop', `bad starts ${JSON.stringify(starts)}`);
  await p.done();
});

test('Ship it on a delivery saves a ship decision after Undo time', async () => {
  const p = await open();
  const c = card(p, 'Booking flow released', '#deliveries');
  check(await c.locator('[data-act=ship]').count() === 1, 'no Ship it button');
  check(/book\.fitclub\.example/.test(await c.textContent()), 'no live URL hint');
  await c.locator('[data-act=ship]').click();
  check(await c.locator('.undo').count() === 1, 'no Undo shown');
  await p.waitForTimeout(600);
  const a = await dbGet(p, 'answers/i4');
  check(a && a.decision === 'ship' && /live URL/.test(a.meaning), `bad answer ${JSON.stringify(a)}`);
  await p.done();
});

test('New project saves its type and live URL; checker gets the checker role', async () => {
  const p = await open();
  await p.click('#add-toggle');
  check(await p.inputValue('#f-agents') === 'lead, builder, checker', 'Lean is not the default team');
  await p.fill('#f-name', 'notes'); await p.selectOption('#f-kind', 'saas'); await p.fill('#f-live', 'notes.example.com');
  await p.fill('#f-brief', 'A notes app.');
  await p.click('#f-submit'); await p.waitForTimeout(400);
  const proj = await dbGet(p, 'projects/notes');
  check(proj && proj.kind === 'saas' && proj.live_url === 'notes.example.com', `bad project ${JSON.stringify(proj)}`);
  const chk = await dbGet(p, 'agents/checker-notes');
  check(chk && chk.role === 'checker', `bad checker ${JSON.stringify(chk)}`);
  const prog = await p.locator('#progress article', { hasText: 'notes' }).first().textContent();
  check(/Design for you to approve/.test(prog) && /Live on notes\.example\.com/.test(prog), `no checkpoints: ${prog.slice(0, 120)}`);
  await p.done();
});

test('A rejected design checkpoint does not show as approved', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('items/dz').set({ id: 'dz', timestamp: new Date().toISOString(), agent: 'lead-landing-v2', project: 'landing-v2', type: 'approval', title: 'Design for landing-v2',
      status: 'answered', needs_me: false, answer: { decision: 'reject', at: new Date().toISOString() } }); });
  await p.waitForTimeout(400);
  const prog = await p.locator('#progress article', { hasText: 'landing-v2' }).first().textContent();
  check(!/Design approved/.test(prog) && /Design: being reworked/.test(prog), `wrong design step: ${prog.slice(0, 160)}`);
  await p.done();
});

test('Answering a card wakes the agent\'s own session', async () => {
  const p = await open();
  await card(p, 'Payments before').locator('[data-act=approve]').click();
  await p.waitForTimeout(900);
  const wakes = (await p.evaluate(() => window.HUB_CALLS)).filter((c) => c[0] === 'create_trigger' && /^Wake /.test(c[1].name));
  check(wakes.length === 1 && wakes[0][1].persistent_session_id === 'session_demo_lead' && wakes[0][1].run_once_at, `bad wakes ${JSON.stringify(wakes)}`);
  check(!(await p.evaluate(() => window.HUB_CALLS)).some((c) => c[0] === 'fire_trigger'), 'fire_trigger used to wake');
  await p.done();
});

test('Agent-written task fields cannot inject markup', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('tasks/gym-app--T-99').set({ project: 'gym-app', id: '<img id=pwn1 src=x>', title: 'x', status: 'in-progress', owner: 'builder-gym-app',
      checks_required: ['<img id=pwn2 src=x>'], checks: {} }); });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelectorAll('details[id^=plan-]').forEach((d) => { d.open = true; }));
  check(await p.locator('#pwn1, #pwn2').count() === 0, 'markup from task fields was rendered');
  await p.done();
});

test('Removing a customer profile needs a second click', async () => {
  const p = await open();
  await p.evaluate(() => document.querySelectorAll('.project details').forEach((d) => { d.open = true; }));
  const btn = p.locator('[data-del-persona]').first();
  const id = await btn.getAttribute('data-del-persona');
  await btn.click(); await p.waitForTimeout(300);
  check(await dbGet(p, `personas/${id}`), 'deleted on the first click');
  check(/Click again/.test(await btn.textContent()), 'no confirm label');
  await btn.click(); await p.waitForTimeout(400);
  check(!(await dbGet(p, `personas/${id}`)), 'not deleted on the second click');
  await p.done();
});

test('Project tabs show one project at a time', async () => {
  const p = await open();
  await p.click('[data-ptab="client-portal"]'); await p.waitForTimeout(300);
  const needs = await p.locator('#needs').textContent();
  check(!/Payments before/.test(needs), 'gym-app card shown under client-portal');
  check(await p.locator('#agents .agent').count() === (await p.evaluate(async () => (await (await window.HUB_DEMO.use('db')).collection('agents').where('project', '==', 'client-portal').get()).size)), 'agents not filtered');
  await p.click('[data-ptab=""]'); await p.waitForTimeout(300);
  check(/Payments before/.test(await p.locator('#needs').textContent()), 'All projects does not show everything');
  await p.done();
});

test('A broadcast that reads like a new project offers to start one', async () => {
  const p = await open();
  await p.click('#bc-toggle');
  await p.fill('#bc-text', 'Build "Recipe Box", a web app that turns family recipes into a shared cookbook.');
  await p.click('#bc-send'); await p.waitForTimeout(300);
  check(!(await p.evaluate(() => window.HUB_CALLS.length && false)), '');
  const dirs = await p.evaluate(async () => (await (await window.HUB_DEMO.use('db')).collection('directives').get()).size);
  check(dirs === 0, 'sent before asking');
  await p.click('[data-new-project]'); await p.waitForTimeout(200);
  check(!(await p.locator('#add-panel').isHidden()) && /Recipe Box/.test(await p.inputValue('#f-brief')) && (await p.inputValue('#f-name')) === 'recipe-box', 'brief not carried to Add project');
  await p.done();
});

test('A hub that already has a project hands a new one over as a new-hub request', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { Object.defineProperty(window, 'HUB_SINGLE_PROJECT', { value: true, writable: false }); });
  await p.goto(URL_); await p.waitForFunction(() => document.querySelectorAll('#needs article').length > 0);
  await p.click('#add-toggle');
  await p.fill('#f-name', 'notes'); await p.fill('#f-brief', 'A notes app.');
  await p.click('#f-submit'); await p.waitForTimeout(400);
  const proj = await dbGet(p, 'projects/notes');
  check(!proj, 'project was added to this hub');
  const req = await p.locator('#add-result code').textContent();
  check(/NEW-PROJECT\.md/.test(req) && /Project: notes/.test(req) && /A notes app\./.test(req), `bad request: ${req.slice(0, 120)}`);
  await ctx.close();
});

test('A card replaced by a newer version is hidden, but search still finds it', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('items/dv2').set({ id: 'dv2', timestamp: new Date().toISOString(), agent: 'designer-client-portal', project: 'client-portal', type: 'approval',
      title: 'Client dashboard layout v2', status: 'open', needs_me: true, reply_to: 'i2', recommendation: 'Approve', reversible: true, bullets: ['Lighter look'] }); });
  await p.waitForTimeout(400);
  const page = await p.locator('main').textContent();
  check(/Client dashboard layout v2/.test(page), 'new version not shown');
  check(!/Client dashboard layout and colors/.test(page), 'replaced card still shown');
  await p.fill('#search', 'layout and colors'); await p.waitForTimeout(400);
  check(/Client dashboard layout and colors/.test(await p.locator('#feed').textContent()), 'search does not find the replaced card');
  await p.done();
});

test('A delivery that needs the CEO offers Ship it instead of Approve', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('items/dl2').set({ id: 'dl2', timestamp: new Date().toISOString(), agent: 'lead-landing-v2', project: 'landing-v2', type: 'delivery',
      title: 'Landing v2 ready to ship', status: 'open', needs_me: true, preview_url: 'https://preview.example', bullets: ['a', 'b', 'c'] }); });
  await p.waitForTimeout(400);
  const c = card(p, 'Landing v2 ready to ship');
  check(await c.locator('[data-act=ship]').count() === 1 && await c.locator('[data-act=approve]').count() === 0, 'no Ship it on a needs-you delivery');
  await c.locator('[data-act=ship]').click(); await p.waitForTimeout(600);
  const a = await dbGet(p, 'answers/dl2');
  check(a && a.decision === 'ship' && a.agent === 'lead-landing-v2', `bad answer ${JSON.stringify(a)}`);
  await p.done();
});

test('A sleeping agent is not offered Start again', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('agents/reviewer-gym-app').update({ last_seen: new Date(Date.now() - 50 * 60000).toISOString(),
      next_check_at: new Date(Date.now() + 10 * 60000).toISOString(), state: 'working' }); });
  await p.waitForTimeout(400);
  const row = p.locator('#agents .agent', { hasText: 'reviewer-gym-app' });
  check(await row.locator('[data-start]').count() === 0, 'Start again offered for a sleeping agent');
  await p.done();
});

test('A status reply does not hide an open question', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('items/st1').set({ id: 'st1', timestamp: new Date().toISOString(), agent: 'lead-gym-app', project: 'gym-app', type: 'status',
      title: 'Working on it', status: 'info', needs_me: false, reply_to: 'i1', bullets: ['x'] }); });
  await p.waitForTimeout(400);
  check(await card(p, 'Payments before').count() === 1, 'open question hidden by a status reply');
  await p.done();
});

test('The tab keeps the hub title and answers are marked as from the page', async () => {
  const p = await open({ undoMs: 100 });
  check(/Agent Hub$/.test(await p.title()), `bad title ${await p.title()}`);
  await card(p, 'Payments before').locator('[data-act=approve]').click();
  await p.waitForTimeout(700);
  const a = await dbGet(p, 'answers/i1');
  check(a && a.via === 'page', `answer not marked ${JSON.stringify(a)}`);
  await p.done();
});

test('Raising the budget of a paused project wakes the lead', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('projects/gym-app').update({ budget_paused: true, spent_usd: 75 }); });
  await p.waitForTimeout(400);
  await p.fill('#budget-gym-app', '150'); await p.locator('#budget-gym-app').dispatchEvent('change');
  await p.waitForTimeout(800);
  const dirs = await p.evaluate(async () => (await (await window.HUB_DEMO.use('db')).collection('directives').where('to', '==', 'lead-gym-app').get()).docs.map((d) => d.data()));
  check(dirs.some((d) => /Budget raised to \$150/.test(d.text) && d.via === 'page'), `no budget directive ${JSON.stringify(dirs)}`);
  const wakes = (await p.evaluate(() => window.HUB_CALLS)).filter((c) => c[0] === 'create_trigger' && c[1].persistent_session_id === 'session_demo_lead');
  check(wakes.length >= 1, 'lead not woken');
  await p.done();
});

test('Problems view: each agent shows its state, stalled agents get Nudge', async () => {
  const p = await open();
  await p.evaluate(async () => { const db = await window.HUB_DEMO.use('db');
    await db.doc('agents/reviewer-gym-app').update({ last_seen: new Date(Date.now() - 3 * 3600e3).toISOString(),
      next_check_at: new Date(Date.now() - 2 * 3600e3).toISOString(), state: 'working' }); });
  await p.waitForTimeout(500);
  check(/stalled/.test(await p.locator('#agents-summary').textContent()), 'no stalled count in the summary');
  const row = p.locator('#agents .agent', { hasText: 'reviewer-gym-app' });
  check(/Stalled/.test(await row.textContent()), 'no Stalled label');
  await row.locator('[data-nudge]').click(); await p.waitForTimeout(800);
  const wakes = (await p.evaluate(() => window.HUB_CALLS)).filter((c) => c[0] === 'create_trigger' && c[1].persistent_session_id === 'session_demo_rev');
  check(wakes.length === 1, 'Nudge did not wake the agent');
  check(/Nudged/.test(await row.textContent()), 'no Nudged confirmation');
  await p.done();
});

test('Team buttons send the lead a planning session, team review or brief request', async () => {
  const p = await open();
  const proj = p.locator('.project', { hasText: 'gym-app' }).first();
  for (const kind of ['plan', 'review', 'brief']) { await proj.locator(`[data-team="${kind}"]`).click(); await p.waitForTimeout(300); }
  const dirs = await p.evaluate(async () => (await (await window.HUB_DEMO.use('db')).collection('directives').where('to', '==', 'lead-gym-app').get()).docs.map((d) => d.data().text));
  check(dirs.some((t) => /planning session/i.test(t)) && dirs.some((t) => /team review/i.test(t)) && dirs.some((t) => /Sharpen the brief/.test(t)), `missing requests ${JSON.stringify(dirs)}`);
  await p.done();
});

test('New project saves its size', async () => {
  const p = await open();
  await p.click('#add-toggle');
  await p.fill('#f-name', 'tiny'); await p.selectOption('#f-size', 'quick'); await p.fill('#f-brief', 'Fix the footer link.');
  await p.click('#f-submit'); await p.waitForTimeout(400);
  const proj = await dbGet(p, 'projects/tiny');
  check(proj && proj.size === 'quick', `bad size ${JSON.stringify(proj && proj.size)}`);
  await p.done();
});

test('Delivery cards show proof of work', async () => {
  const p = await open();
  const c = card(p, 'Booking flow released', '#deliveries');
  const text = await c.textContent();
  check(/Proof of work/.test(text) && /Tests ran/.test(text) && /Security sweep/.test(text), `no proof block: ${text.slice(0, 200)}`);
  check(/missing:/.test(text), 'missing items not named (demo delivery has no screenshot)');
  await p.done();
});

test('An alert link opens the exact card; focus view shows only what needs you', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(URL_ + '#card-i2'); await p.waitForFunction(() => document.querySelectorAll('#needs article').length > 0);
  await p.waitForTimeout(500);
  check(await p.locator('#card-i2').count() === 1, 'card has no id');
  const inView = await p.evaluate(() => { const r = document.getElementById('card-i2').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
  check(inView, 'linked card not scrolled into view');
  await p.click('#focus-toggle'); await p.waitForTimeout(200);
  check(await p.locator('.rail').isHidden() && await p.locator('#needs-block').isVisible(), 'focus view did not hide the rest');
  await p.click('#focus-toggle'); await p.waitForTimeout(200);
  check(await p.locator('.rail').isVisible(), 'focus view did not switch back');
  await ctx.close();
});

test('Overview page lists every hub with what needs the CEO, linking to the exact card', async () => {
  const ov = readFileSync(join(root, 'cloud/overview.html'), 'utf8');
  const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><script>\n${readFileSync(join(root, 'demo/demo-db.js'), 'utf8')}</script>`
    + `<script>window.HUB_DEMO.load({ hubs: [
      { id: 'recipe-box', project: 'recipe-box', hub_url: 'https://claude.ai/artifact/AbC123', phase: 'building', needs_you: 2, stalled: 1, working: 2, tasks_done: 3, tasks_total: 7, spent_usd: 12, budget_usd: 50,
        top_needs: [{ id: 'itm_1', title: 'Approve the design', urgency: 'now' }, { id: 'itm_2', title: 'Pick a domain' }], updated_at: new Date().toISOString() },
      { id: 'notes', project: 'notes', hub_url: 'javascript:alert(1)', phase: 'complete', needs_you: 0, updated_at: new Date().toISOString() } ] });</script>` + ov;
  writeFileSync(join(root, 'tests/.out/overview.html'), html);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(pathToFileURL(join(root, 'tests/.out/overview.html')).href); await p.waitForTimeout(500);
  check((await p.locator('#needs-count').textContent()) === '2', 'wrong needs count');
  const href = await p.locator('#inbox a').first().getAttribute('href');
  check(href === 'https://claude.ai/artifact/AbC123#card-itm_1', `bad deep link ${href}`);
  check(/1 stalled/.test(await p.locator('#hubs').textContent()), 'stalled not shown');
  check(await p.locator('#hubs a[href^="javascript"]').count() === 0, 'unsafe hub link rendered');
  check(!errs.length, errs.join(' | '));
  await ctx.close();
});

test('Brief helper writes the brief and names what is missing', async () => {
  const p = await open();
  await p.click('#add-toggle'); await p.click('#brief-help summary');
  await p.fill('#b-what', 'A booking app'); await p.fill('#b-must', 'Book\nCancel'); await p.fill('#b-deadline', '4 weeks');
  await p.click('#b-write');
  const brief = await p.inputValue('#f-brief');
  check(/A booking app/.test(brief) && /- Book/.test(brief) && /Deadline: 4 weeks/.test(brief), 'brief not written');
  check(/who uses it/.test(await p.textContent('#b-msg')), 'missing parts not named');
  await p.done();
});

test('Costs add up per project and the budget states show', async () => {
  const p = await open({ faults: { mcpDelay: 0 } });
  await p.waitForTimeout(500);
  const cost = p.locator('.project', { hasText: 'gym-app' }).first().locator('.cost');
  check(/\$54\.45 spent of \$75\.00 budget/.test(await cost.locator('p').textContent()), `cost: ${await cost.locator('p').textContent()}`);
  await cost.locator('[data-budget]').fill('50');
  await cost.locator('[data-budget]').press('Enter');
  await cost.locator('[data-budget]').blur();
  await p.waitForTimeout(300);
  check(/Budget reached/.test(await p.locator('.project', { hasText: 'gym-app' }).first().locator('.cost p').textContent()), 'no budget reached state');
  await p.done();
});

test('Usage limit: banner, resume once, no duplicate', async () => {
  const p = await open({ faults: { mcpDelay: 0 } });
  await p.waitForTimeout(500);
  check(/stopped on a usage limit/.test(await p.textContent('#limit-banner')), 'no limit banner');
  await p.click('#resume-all'); await p.waitForTimeout(300);
  await p.evaluate(() => scheduleResume(limitedAgents().map((a) => a.agent)));
  await p.waitForTimeout(300);
  const triggers = (await p.evaluate(() => window.HUB_CALLS)).filter((c) => c[0] === 'create_trigger');
  check(triggers.length === 1 && triggers[0][1].persistent_session_id === 'session_demo_b2', `triggers: ${JSON.stringify(triggers)}`);
  check(/scheduled to resume/.test(await p.textContent('#limit-banner')), 'banner not updated');
  await p.done();
});

test('Blocked start: buttons hide, Copy start request appears with the right text', async () => {
  const p = await open({ faults: { mcp: 'blocked_by_policy', mcpDelay: 0 } });
  await p.waitForTimeout(300);
  const ag = p.locator('.agent', { hasText: 'builder-2-gym-app' });
  await ag.locator('[data-start]').click();
  await p.waitForTimeout(300);
  check(/Copy start request/.test(await ag.locator('.error').textContent()), 'no pointer to the start request');
  check(await p.locator('[data-start]').count() === 0, 'start buttons still shown');
  const btn = p.locator('.project', { hasText: 'gym-app' }).first().locator('[data-copy-start]');
  check(await btn.count() === 1, 'no Copy start request on the project card');
  const text = await p.evaluate(() => startRequest('gym-app'));
  check(/create_session/.test(text) && /builder-2-gym-app/.test(text) && /You are agent "builder-2-gym-app"/.test(text) && /send_later/.test(text) && /permission_mode "auto"/.test(text), 'start request text incomplete');
  await p.done();
});

test('Each project shows a status line', async () => {
  const p = await open();
  const line = await p.locator('.project', { hasText: 'gym-app' }).first().locator('.pstatus').textContent();
  check(/agents running/.test(line) && /T-5, T-6 in progress/.test(line) && /1 in review/.test(line) && /3 of 8 done/.test(line) && /need/.test(line), `status line: ${line}`);
  await p.done();
});

test('An agent that missed its check shows as asleep', async () => {
  const p = await open();
  await p.evaluate(async () => {
    const db = await window.HUB_DEMO.use('db');
    await db.doc('agents/builder-gym-app').update({ next_check_at: new Date(Date.now() - 20 * 60000).toISOString() });
    await db.doc('agents/reviewer-gym-app').update({ next_check_at: new Date(Date.now() + 8 * 60000).toISOString() });
  });
  await p.waitForTimeout(300);
  check(/Asleep: missed its check/.test(await p.locator('.agent', { hasText: 'builder-gym-app' }).first().textContent()), 'no asleep warning');
  check(/Next check/.test(await p.locator('.agent', { hasText: 'reviewer-gym-app' }).textContent()), 'no next check time');
  check(/1 asleep/.test(await p.locator('.project', { hasText: 'gym-app' }).first().locator('.pstatus').textContent()), 'status line misses the asleep agent');
  await p.done();
});

test('Progress card shows steps in plain words', async () => {
  const p = await open();
  const card = p.locator('#progress article', { hasText: 'gym-app' }).first();
  const text = await card.textContent();
  check(/Step 6 of 13/.test(text) && /Design approved/.test(text), `no step count: ${text.slice(0, 80)}`);
  check(/First preview link for you to try/.test(text) && /Live on book\.fitclub\.example/.test(text), 'no preview or live step');
  check(/press Ship it/.test(text), 'delivery step does not mention Ship it');
  check(/Plan approved/.test(text) && /T-1 Signup and login: done/.test(text), 'done steps missing');
  check(/T-4 Cancel a booking: in checks \(code passed · security running · qa running\)/.test(text), 'check states missing');
  check(/T-5 Owner adds classes: writing tests for the class form/.test(text), 'doing line missing');
  check(/Delivery for you to review/.test(text) || /Delivery ready/.test(text) || /Delivered/.test(text), 'delivery step missing');
  check(/Plan: the lead is writing it/.test(await p.locator('#progress article', { hasText: 'landing-v2' }).textContent()), 'planning project wrong');
  await p.done();
});

test('An agent that was started but never checked in shows as asleep', async () => {
  const p = await open();
  await p.evaluate(async () => {
    const db = await window.HUB_DEMO.use('db');
    await db.doc('agents/fresh-gym-app').set({ agent: 'fresh-gym-app', project: 'gym-app', role: 'builder', started_at: new Date(Date.now() - 16 * 60000).toISOString(), state: 'started' });
  });
  await p.waitForTimeout(300);
  check(/Never checked in/.test(await p.locator('.agent', { hasText: 'fresh-gym-app' }).textContent()), 'no never-checked-in warning');
  await p.done();
});

test('Phone alert level saves', async () => {
  const p = await open();
  await p.selectOption('#alerts-level', 'all');
  await p.waitForTimeout(200);
  check((await dbGet(p, 'config/alerts')).level === 'all', 'level not saved');
  await p.done();
});

// ---------- layout ----------
for (const [width, scheme] of [[1300, 'light'], [1300, 'dark'], [390, 'light'], [195, 'dark']]) {
  test(`No sideways scrolling at ${width}px (${scheme}), feedback open`, async () => {
    const p = await open({ width, height: 844, scheme, mobile: width < 600 });
    await card(p, 'Payments before').locator('[data-fb-open]').click();
    await p.click('#add-toggle');
    await p.waitForTimeout(200);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= width, `page is ${sw}px wide`);
    await p.done();
  });
}

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok    ${t.name}`); }
  catch (e) { failed++; console.log(`FAIL  ${t.name}\n      ${e.message}`); }
}
await browser.close();
console.log(`\n${tests.length - failed} of ${tests.length} passed`);
process.exit(failed ? 1 : 0);
