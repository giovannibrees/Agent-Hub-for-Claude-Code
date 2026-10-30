// Builds cloud/agent-hub.html, the one file you publish, from the sources in cloud/src/.
// Run from the repo root: npm run build. Edit cloud/src/, never the built file.
// npm run check fails when the built file is out of date.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'cloud/src', f), 'utf8');
const js = readdirSync(join(root, 'cloud/src/js')).filter((f) => f.endsWith('.js')).sort().map((f) => src(`js/${f}`)).join('');
const out = `${src('head.html')}<style>\n${src('style.css')}</style>\n${src('body.html')}<script>\n${js}</script>\n`;
const target = join(root, 'cloud/agent-hub.html');

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== out) { console.error('cloud/agent-hub.html is out of date: run npm run build'); process.exit(1); }
  console.log('cloud/agent-hub.html is up to date');
} else {
  writeFileSync(target, out);
  console.log(`built cloud/agent-hub.html (${out.split('\n').length - 1} lines)`);
}
