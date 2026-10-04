#!/usr/bin/env node
/**
 * Line-count ratchet: new files stay under the default cap; oversized files
 * cannot grow past the frozen allowlist in scripts/max-lines-allowlist.json.
 *
 *   node scripts/check-max-lines.mjs
 *   node scripts/check-max-lines.mjs --write   # refresh allowlist from disk
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ALLOWLIST_PATH = join(ROOT, 'scripts/max-lines-allowlist.json');
const WRITE = process.argv.includes('--write');
const DEFAULT_MAX = 500;
const TEST_MAX = 800;

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  '.git',
  '.sideboard',
  '.context',
  'site',
]);

function capFor(rel) {
  return /\.test\.(ts|tsx|js|mjs|cjs)$/.test(rel) ? TEST_MAX : DEFAULT_MAX;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function lineCount(file) {
  const text = readFileSync(file, 'utf8');
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function loadAllowlist() {
  try {
    const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const files = ['packages', 'apps', 'scripts']
  .flatMap((top) => walk(join(ROOT, top)))
  .map((full) => ({
    rel: relative(ROOT, full).replaceAll('\\', '/'),
    lines: lineCount(full),
  }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const allowlist = loadAllowlist();
const nextAllowlist = {};
const failures = [];

for (const { rel, lines } of files) {
  const def = capFor(rel);
  const frozen = allowlist[rel];
  if (frozen != null) {
    if (WRITE) {
      if (lines > def) nextAllowlist[rel] = lines;
    } else if (lines > frozen) {
      failures.push(`${rel}: ${lines} lines (allowlist ${frozen}) — split or shrink, do not raise the cap`);
    }
    continue;
  }
  if (lines > def) {
    nextAllowlist[rel] = lines;
    if (!WRITE) {
      failures.push(
        `${rel}: ${lines} lines (new files max ${def}) — split the file or add it to scripts/max-lines-allowlist.json`,
      );
    }
  }
}

if (WRITE) {
  mkdirSync(dirname(ALLOWLIST_PATH), { recursive: true });
  writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(nextAllowlist, null, 2)}\n`);
  console.log(`wrote ${Object.keys(nextAllowlist).length} oversized files to ${relative(ROOT, ALLOWLIST_PATH)}`);
  process.exit(0);
}

if (failures.length) {
  console.error('Max-lines ratchet failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(
  `ok: ${files.length} files, ${Object.keys(allowlist).length} oversized frozen, default ${DEFAULT_MAX}/${TEST_MAX}`,
);
