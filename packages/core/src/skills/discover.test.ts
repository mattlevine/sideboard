import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { discoverSkills } from './discover.js';

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
});
