import { readWorktreeFile } from '../diff/diff.js';
import { discoverSkills, readSkillBody, type SkillInfo } from '../skills/discover.js';
import type { ThreadAttachment } from '../types/thread.js';

const FILE_MENTION_RE = /(?:^|[\s])@([A-Za-z0-9_./\-]+(?:\.[A-Za-z0-9]+)?)/g;
const SLASH_CMD_RE = /(?:^|\s)\/([a-z0-9][a-z0-9-]*)\b/g;

export interface ExpandResult {
  /** Prompt sent to the agent (may include attachments / skill bodies). */
  agentPrompt: string;
  mentionedFiles: string[];
  skillsUsed: SkillInfo[];
}

/**
 * Expand @file mentions, /skill commands, and composer attachments into agent context.
 * Display text should remain the original user prompt.
 */
export function expandComposerPrompt(
  worktreePath: string,
  prompt: string,
  opts?: {
    skills?: SkillInfo[];
    maxFileBytes?: number;
    attachments?: ThreadAttachment[];
  },
): ExpandResult {
  const skills = opts?.skills ?? discoverSkills(worktreePath);
  const byCommand = new Map(skills.map((s) => [s.command, s]));
  const maxFileBytes = opts?.maxFileBytes ?? 80_000;
  const attachments = opts?.attachments ?? [];

  const mentionedFiles = new Set<string>();
  for (const m of prompt.matchAll(FILE_MENTION_RE)) {
    const p = m[1];
    if (p) mentionedFiles.add(p);
  }

  const skillsUsed: SkillInfo[] = [];
  const seenSkill = new Set<string>();
  for (const m of prompt.matchAll(SLASH_CMD_RE)) {
    const cmd = m[1];
    if (!cmd || seenSkill.has(cmd)) continue;
    const skill = byCommand.get(cmd);
    if (skill) {
      skillsUsed.push(skill);
      seenSkill.add(cmd);
    }
  }

  if (mentionedFiles.size === 0 && skillsUsed.length === 0 && attachments.length === 0) {
    return { agentPrompt: prompt, mentionedFiles: [], skillsUsed: [] };
  }

  const parts: string[] = [prompt.trim(), '', '---', 'Sideboard context (auto-attached):'];

  for (const att of attachments) {
    parts.push('');
    parts.push(`## Attachment: ${att.name}`);
    parts.push(`Kind: ${att.kind}`);
    if (att.path) {
      parts.push(`Path in worktree: \`${att.path}\``);
    }
    parts.push('');
    parts.push(att.content);
  }

  for (const skill of skillsUsed) {
    let body = '';
    try {
      body = readSkillBody(skill.path);
    } catch {
      body = `(could not read skill at ${skill.path})`;
    }
    parts.push('');
    parts.push(`## Skill: /${skill.command} (${skill.name})`);
    parts.push(`Source: ${skill.source} · ${skill.path}`);
    parts.push('Follow this skill for the request above:');
    parts.push('');
    parts.push(body);
  }

  for (const rel of mentionedFiles) {
    parts.push('');
    parts.push(`## Referenced file: @${rel}`);
    try {
      const file = readWorktreeFile(worktreePath, rel, { maxBytes: maxFileBytes });
      if (file.binary) {
        parts.push(`(binary file — use the Read tool on \`${rel}\`)`);
      } else {
        parts.push(`Path in worktree: \`${rel}\``);
        parts.push('```');
        parts.push(file.content);
        parts.push('```');
        if (file.truncated) parts.push('(truncated)');
      }
    } catch {
      parts.push(`(file not found or unreadable — use the Read/Glob tools for \`${rel}\`)`);
    }
  }

  return {
    agentPrompt: parts.join('\n'),
    mentionedFiles: [...mentionedFiles],
    skillsUsed,
  };
}
