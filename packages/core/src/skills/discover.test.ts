import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLED_LONG_RUNNING_PATH } from './bundled/long-running.js';
import { discoverSkills, readSkillBody } from './discover.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('discoverSkills', () => {
  it('finds the committed graph-engineering skill from the repo root', () => {
    const skills = discoverSkills(repoRoot);
    const graph = skills.find((s) => s.command === 'graph-engineering');
    expect(graph).toBeDefined();
    expect(graph?.name).toBe('graph-engineering');
    expect(graph?.path).toMatch(/graph-engineering\/SKILL\.md$/);
    expect(graph?.source).toBe('workspace');
  });

  it('exposes /long-running as a bundled product skill in an empty worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-skills-empty-'));
    const skills = discoverSkills(root);
    const longRunning = skills.find((s) => s.command === 'long-running');
    expect(longRunning).toBeDefined();
    expect(longRunning?.source).toBe('bundled');
    expect(longRunning?.path).toBe(BUNDLED_LONG_RUNNING_PATH);
    expect(readSkillBody(longRunning!.path)).toMatch(/Detach/);
    expect(readSkillBody(longRunning!.path)).toMatch(/present_artifact/);
  });

  it('lets a workspace long-running skill win over the bundled copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'sb-skills-ws-'));
    mkdirSync(join(root, '.claude', 'skills', 'long-running'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'skills', 'long-running', 'SKILL.md'),
      '---\nname: long-running\ndescription: Workspace override\n---\n\n# Custom\n',
    );
    const skills = discoverSkills(root);
    const longRunning = skills.find((s) => s.command === 'long-running');
    expect(longRunning?.source).toBe('workspace');
    expect(readSkillBody(longRunning!.path)).toMatch(/Custom/);
  });
});
