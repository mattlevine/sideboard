import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SkillInfo {
  id: string;
  name: string;
  command: string;
  description: string;
  path: string;
  source: 'workspace' | 'user' | 'cli';
}

function toCommand(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(content: string): { name: string | null; description: string | null } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { name: null, description: null };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { name: null, description: null };
  const block = lines.slice(1, end).join('\n');
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  let description: string | null = null;
  const descInline = block.match(/^description:\s*(.+)$/m);
  if (descInline && !descInline[1]!.startsWith('|') && !descInline[1]!.startsWith('>')) {
    description = descInline[1]!.trim().replace(/^["']|["']$/g, '');
  } else {
    const descBlock = block.match(/^description:\s*[|>]?-?\s*\n((?:[ \t]+.+\n?)*)/m);
    if (descBlock) {
      description = descBlock[1]!
        .split('\n')
        .map((l) => l.replace(/^[ \t]+/, ''))
        .join(' ')
        .trim();
    }
  }
  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null;
  return { name, description };
}

function readSkill(skillMd: string, source: SkillInfo['source']): SkillInfo | null {
  try {
    const content = readFileSync(skillMd, 'utf8');
    const { name: fmName, description } = parseFrontmatter(content);
    const dirName = skillMd.split('/').slice(-2, -1)[0] || 'skill';
    const name = fmName || dirName;
    const command = toCommand(name);
    if (!command) return null;
    return {
      id: `${source}:${skillMd}`,
      name,
      command,
      description: (description || '').slice(0, 240),
      path: skillMd,
      source,
    };
  } catch {
    return null;
  }
}

function scanSkillsDir(dir: string, source: SkillInfo['source'], out: SkillInfo[]): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const skillMd = join(dir, entry, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    try {
      if (!statSync(skillMd).isFile()) continue;
    } catch {
      continue;
    }
    const skill = readSkill(skillMd, source);
    if (skill) out.push(skill);
  }
}

/** Walk Claude plugins trees for skills directories without a full FS crawl. */
function scanClaudePluginSkills(pluginsRoot: string, out: SkillInfo[]): void {
  if (!existsSync(pluginsRoot)) return;

  const walk = (dir: string, depth: number, lookingForSkillsDir: boolean) => {
    if (depth > 7) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (lookingForSkillsDir && entries.includes('SKILL.md')) {
      const skill = readSkill(join(dir, 'SKILL.md'), 'cli');
      if (skill) out.push(skill);
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const full = join(dir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (entry === 'skills') {
        scanSkillsDir(full, 'cli', out);
        // Also support skills that are themselves a single SKILL.md folder nesting
        walk(full, depth + 1, true);
      } else {
        walk(full, depth + 1, lookingForSkillsDir);
      }
    }
  };

  walk(pluginsRoot, 0, false);
}

/**
 * Discover skills from the worktree + user/CLI skill locations.
 * Workspace skills win over user/CLI when command names collide.
 */
export function discoverSkills(worktreePath: string): SkillInfo[] {
  const home = homedir();
  const collected: SkillInfo[] = [];

  // Workspace (highest priority)
  for (const rel of ['.claude/skills', '.cursor/skills', '.sideboard/skills', '.brightsy/skills', 'skills']) {
    scanSkillsDir(join(worktreePath, rel), 'workspace', collected);
  }

  // User / CLI
  for (const abs of [
    join(home, '.claude/skills'),
    join(home, '.cursor/skills'),
    join(home, '.sideboard/skills'),
    join(home, '.brightsy/skills'),
  ]) {
    scanSkillsDir(abs, 'user', collected);
  }

  // Claude Code plugins (CLI-installed skills)
  scanClaudePluginSkills(join(home, '.claude/plugins'), collected);

  // Deduplicate by command — workspace > user > cli
  const rank: Record<SkillInfo['source'], number> = { workspace: 0, user: 1, cli: 2 };
  const byCommand = new Map<string, SkillInfo>();
  for (const skill of collected) {
    const prev = byCommand.get(skill.command);
    if (!prev || rank[skill.source] < rank[prev.source]) {
      byCommand.set(skill.command, skill);
    }
  }

  return [...byCommand.values()].sort((a, b) => a.command.localeCompare(b.command));
}

export function readSkillBody(skillPath: string, maxChars = 12_000): string {
  const raw = readFileSync(skillPath, 'utf8');
  // Strip frontmatter for the agent body
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end >= 0) {
      const body = raw.slice(end + 4).trim();
      return body.length > maxChars ? `${body.slice(0, maxChars)}\n\n…(truncated)` : body;
    }
  }
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n…(truncated)` : raw;
}
