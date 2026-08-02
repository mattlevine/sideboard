import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandComposerPrompt } from './expand.js';
import type { SkillInfo } from '../skills/discover.js';

describe('expandComposerPrompt', () => {
  it('attaches @file contents and /skill bodies', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-expand-'));
    writeFileSync(join(root, 'hello.ts'), 'export const x = 1;\n');
    const skills: SkillInfo[] = [
      {
        id: 's1',
        name: 'Git Commit',
        command: 'git-commit',
        description: 'Commit help',
        path: join(root, 'SKILL.md'),
        source: 'workspace',
      },
    ];
    writeFileSync(
      skills[0]!.path,
      '---\nname: git-commit\ndescription: Commit help\n---\n\n# Do commits well\n',
    );

    const result = expandComposerPrompt(root, 'Please /git-commit and check @hello.ts', {
      skills,
    });
    expect(result.mentionedFiles).toEqual(['hello.ts']);
    expect(result.skillsUsed).toHaveLength(1);
    expect(result.agentPrompt).toContain('export const x = 1');
    expect(result.agentPrompt).toContain('Do commits well');
    expect(result.agentPrompt.startsWith('Please /git-commit')).toBe(true);
  });

  it('passes through plain prompts', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-expand-plain-'));
    mkdirSync(root, { recursive: true });
    const result = expandComposerPrompt(root, 'just hello');
    expect(result.agentPrompt).toBe('just hello');
    expect(result.mentionedFiles).toEqual([]);
  });
});
