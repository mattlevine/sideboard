import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** True when this worktree has the announce-on-x skill. Node-only; the renderer must not import it. */
export function announceSkillPresent(worktreePath: string | null | undefined): boolean {
  const root = worktreePath?.trim();
  return !!root && existsSync(join(root, '.claude/skills/announce-on-x/SKILL.md'));
}
