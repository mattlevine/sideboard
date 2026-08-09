import { describe, expect, it } from 'vitest';
import { CLAUDE_MODEL_CATALOG, listModelsForAgent } from './list-models.js';

describe('listModelsForAgent', () => {
  it('returns Claude catalog when agent=claude', async () => {
    const catalogs = await listModelsForAgent('claude');
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]?.agent).toBe('claude');
    expect(catalogs[0]?.auto).toBe(true);
    expect(catalogs[0]?.models).toEqual(CLAUDE_MODEL_CATALOG);
  });

  it('includes all agents when agent omitted', async () => {
    const catalogs = await listModelsForAgent();
    expect(catalogs.map((c) => c.agent)).toEqual([
      'claude',
      'codex',
      'opencode',
      'cursor',
      'brightsy',
    ]);
    for (const c of catalogs) {
      expect(c.auto).toBe(true);
      expect(Array.isArray(c.models)).toBe(true);
    }
  });
});
