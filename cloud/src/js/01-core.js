'use strict';
// Filled in at publish time so start lines can point agents at this page.
const HUB_URL = 'HUB_URL_PLACEHOLDER';
const STALE_MIN = 30;
const TYPE_LABEL = { status: 'Status', question: 'Question', approval: 'Approval', delivery: 'Delivery', idea: 'Idea', handover: 'Handover', audit: 'Audit' };
const DECISION_LABEL = { approve: 'Approved', feedback: 'Feedback', more_info: 'Asked for more info', reject: 'Not approved', auto: 'Auto-proceeded (no answer in 4h)', ship: 'Ship it' };
const MEANING = {
  approve: 'Approved. Proceed with your recommendation (all numbered recommendations if batched).',
  feedback: 'Follow the feedback text. Numbered answers map to your numbered questions.',
  more_info: 'Not decided yet. Post a new item with reply_to set to this id that gives the missing information.',
  reject: 'Not approved. Do not do this. Continue other work; post a new question only if you are blocked.',
  ship: 'Ship it. Merge this delivery, deploy it the way the project deploys, then load the live URL and confirm the change is there (protocol section 7, Ship it).',
};
const KIND_LABEL = { saas: 'SaaS', landing: 'Landing page', webapp: 'Web app', tool: 'Internal tool', other: 'Other' };
const host = (u) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).host; } catch (e) { return String(u || ''); } };

let db = null;
let searchQ = '';
// The demo page (demo/) defines window.HUB_DEMO with an in-memory database and sample data.
function useCap(name) {
  if (window.HUB_DEMO) return window.HUB_DEMO.use(name);
  return window.claude && window.claude.use ? window.claude.use(name) : Promise.resolve(null);
}
const S = { items: [], agents: [], projects: [], tasks: [], unread: [], personas: [] };
const openDetails = new Set(); // details sections the viewer opened, kept open across re-renders
const pfDrafts = {};            // customer profile form drafts per project
const drafts = {};
const msgDrafts = {};
let filters = { agent: '', project: '', type: '' };
try { filters = Object.assign(filters, JSON.parse(localStorage.getItem('hub-filters') || '{}')); } catch (e) { /* storage blocked */ }

// Invisible characters (zero-width, bidirectional controls, Unicode tags) can hide instructions in
// text. The page never shows or saves them, and warns on a card that contained them.
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
const HAS_HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
function clean(s) { return String(s == null ? '' : s).replace(HIDDEN_CHARS, ''); }
function hasHidden(it) { try { return HAS_HIDDEN.test(JSON.stringify(it)); } catch (e) { return false; } }
function esc(s) { return clean(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function slug(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function ms(iso) { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; }
function ago(iso) {
  if (!ms(iso)) return 'never';
  const s = Math.max(0, (Date.now() - ms(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function until(iso) {
  const s = (ms(iso) - Date.now()) / 1000;
  if (s <= 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function saveFilters() { try { localStorage.setItem('hub-filters', JSON.stringify(filters)); } catch (e) { /* ignore */ } }
function passes(it) {
  return (!filters.agent || it.agent === filters.agent || it.to_agent === filters.agent)
    && (!filters.project || it.project === filters.project) && (!filters.type || it.type === filters.type);
}
const PRIO_RANK = { P1: 0, P2: 1, P3: 2 };
function projectPrio(name) { const p = S.projects.find((x) => x.name === name); return (p && p.priority) || 'P2'; }
function unreadFor(id) { return S.unread.find((a) => a.item_id === id || a.id === id); }
function arr(x) { return Array.isArray(x) ? x : (x ? [x] : []); }

// Items are written by agents: check the protocol so problems are visible on the card.
function violations(it) {
  const v = [];
  const b = arr(it.bullets);
  if (b.length > 5) v.push(`${b.length} bullets (max 5)`);
  if ((it.type === 'question' || it.type === 'approval') && !it.recommendation) v.push('no recommendation');
  if ((it.type === 'question' || it.type === 'approval') && typeof it.reversible !== 'boolean') v.push('reversible not set');
  if (it.type === 'delivery' && !arr(it.verification).length) v.push('no test evidence');
  if (it.type === 'delivery' && !arr(it.links).length) v.push('no link to the result');
  const text = [it.title].concat(arr(it.bullets)).join(' ');
  const hasImage = arr(it.attachments).some((a) => (typeof a === 'object' && a.kind === 'image') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(typeof a === 'string' ? a : a.url || ''));
  if (['question', 'approval', 'delivery'].includes(it.type) && /\b(ui|ux|layout|screens?|buttons?|design|header|zoom|css|mockups?|colou?rs?)\b/i.test(text) && !hasImage) v.push('UI related without a screenshot');
  if ((it.type === 'status' || it.type === 'delivery') && /\?/.test([it.title].concat(arr(it.bullets)).join(' '))) v.push('contains a question; questions need their own card so they reach Needs you');
  return v;
}

