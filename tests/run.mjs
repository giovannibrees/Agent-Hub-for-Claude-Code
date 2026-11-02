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

async function open({ width = 1300, height = 950, faults, scheme = 'light', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, colorScheme: scheme });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  if (faults) await p.addInitScript((f) => { window.HUB_FAULTS = f; }, faults);
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
  const p = await open();
  const c = card(p, 'Payments before');
  await c.locator('[data-act=approve]').click();
  check(await c.locator('.undo').count() === 1, 'no Undo shown');
  await c.locator('[data-undo]').click();
  check(await c.locator('[data-act=approve]').count() === 1, 'Undo did not restore the buttons');
  check(!(await dbGet(p, 'answers/i1')), 'answer saved despite Undo');
  await c.locator('[data-act=approve]').click();
  await p.waitForTimeout(600);
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
  const p = await open({ faults: { uploadDelay: 800 } });
  const c = card(p, 'Client dashboard');
  await c.locator('[data-fb-open]').click();
  await c.locator('input[data-fb-input]').fill('Darker navy');
  await c.locator('[data-fb-file]').setInputFiles(ATTACH);
  await p.waitForTimeout(100);
  check(await c.locator('[data-fb-send]').isDisabled(), 'Send enabled during upload');
  await p.waitForTimeout(1000);
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
  check(/Step \d+ of 10/.test(text), `no step count: ${text.slice(0, 80)}`);
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
