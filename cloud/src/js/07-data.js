// ---------- data ----------

// Items come from three queries so nothing open can fall out of view: the newest items (feed),
// every open/parked item (Needs you, deliveries, ideas) and audit items (lead flags).
const ITEM_KEYS = ['recentItems', 'openItems', 'auditItems'];
function mergeItems() {
  const byId = new Map();
  for (const k of ITEM_KEYS) for (const it of S[k] || []) byId.set(it.id, it);
  S.items = [...byId.values()].sort((a, b) => ms(b.timestamp) - ms(a.timestamp));
}

function subscribe(path, key, query) {
  const q = query(db.collection(path));
  q.onSnapshot((snap) => {
    S[key] = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    if (ITEM_KEYS.includes(key)) mergeItems();
    if (key === 'agents' && !costsRun) refreshCosts();
    render();
  }, () => { const l = document.getElementById('refreshed'); l.classList.add('off'); l.textContent = 'Connection lost. Reload the page.'; });
}

(async () => {
  if (window.HUB_DEMO) document.getElementById('demo-banner').hidden = false;
  try { db = await useCap('db'); } catch (e) { db = null; }
  if (!db) {
    document.getElementById('offline').hidden = false;
    document.getElementById('refreshed').textContent = 'Offline';
    return;
  }
  checkPerms();
  initCloud();
  checkSetup();
  try { assetsCap = await useCap('assets'); } catch (e) { assetsCap = null; }
  db.collection('projects').limit(1).get().then((q) => { if (q.empty) document.getElementById('add-panel').hidden = false; }).catch(() => {});
  subscribe('items', 'recentItems', (c) => c.orderBy('timestamp', 'desc').limit(300));
  subscribe('items', 'openItems', (c) => c.where('status', 'in', ['open', 'parked', 'kept']).limit(1000));
  subscribe('items', 'auditItems', (c) => c.where('type', '==', 'audit').limit(200));
  subscribe('agents', 'agents', (c) => c.limit(200));
  subscribe('projects', 'projects', (c) => c.limit(100));
  subscribe('tasks', 'tasks', (c) => c.limit(1000));
  subscribe('answers', 'unread', (c) => c.where('read', '==', false).limit(500));
  subscribe('personas', 'personas', (c) => c.limit(500));
  // Phone alert level: agents read config/alerts before they push a notification.
  db.doc('config/alerts').onSnapshot((d) => {
    const lv = (d.exists && d.data().level) || 'important';
    const sel = document.getElementById('alerts-level');
    if (document.activeElement !== sel) sel.value = ['important', 'all', 'off'].includes(lv) ? lv : 'important';
    document.getElementById('alerts-wrap').hidden = false;
  }, () => {});
  setInterval(render, 60000); // keeps "time ago", idle dots and 4-hour clocks current
})();
