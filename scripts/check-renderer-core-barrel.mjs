#!/usr/bin/env node
/**
 * Renderer must `import type` from `@sideboard-ai/core`. Value imports pull
 * Node `fs` into Vite (see docs/system/architecture.md).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RENDERER = join(ROOT, 'apps/desktop/src/renderer');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isTypeOnlyImport(clause) {
  const trimmed = clause.trim();
  if (trimmed.startsWith('type ') || trimmed === 'type') return true;
  if (trimmed.startsWith('*')) return false;
  if (!trimmed.startsWith('{')) return false;
  const inner = trimmed.slice(trimmed.indexOf('{') + 1, trimmed.lastIndexOf('}'));
  const specs = inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return specs.length > 0 && specs.every((s) => s.startsWith('type ') || s.startsWith('type\t'));
}

const failures = [];
const files = walk(RENDERER);
for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);
  const pending = [];
  for (const line of src.split('\n')) {
    if (/^\s*(?:import|export)\b/.test(line)) pending.length = 0;
    if (/^\s*(?:import|export)\b/.test(line) || pending.length) pending.push(line);
    if (!pending.length) continue;
    if (!/from\s+['"]@sideboard-ai\/core['"]/.test(line)) continue;
    const stmt = pending.join('\n');
    pending.length = 0;
    if (/^\s*import\s+['"]@sideboard-ai\/core['"]/.test(stmt)) {
      failures.push(`${rel}: side-effect import of @sideboard-ai/core`);
      continue;
    }
    const m = stmt.match(/^\s*(import|export)\s+([\s\S]+?)\s+from\s+['"]@sideboard-ai\/core['"]/);
    if (!m) continue;
    if (!isTypeOnlyImport(m[2])) {
      failures.push(
        `${rel}: value ${m[1] === 'export' ? 're-export' : 'import'} from @sideboard-ai/core`,
      );
    }
  }
}

if (failures.length) {
  console.error('Renderer core-barrel ratchet failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(`ok: ${files.length} renderer files — type-only @sideboard-ai/core imports`);
