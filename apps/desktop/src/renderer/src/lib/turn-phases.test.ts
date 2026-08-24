import { describe, expect, it } from 'vitest';
import type { MessagePart } from '@sideboard-ai/core';
import { phaseDurationMs, splitTurnPhases } from './turn-phases';

describe('splitTurnPhases', () => {
  it('interleaves thought, mid-turn text, work, and the outcome', () => {
    const parts: MessagePart[] = [
      { type: 'thinking', text: 'plan the edit' },
      { type: 'text', text: 'I will update the handler.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'done', description: 'Read foo.ts' },
      { type: 'tool', id: 't2', name: 'Edit', status: 'done', description: 'Edit foo.ts' },
      { type: 'text', text: 'Done — the handler now returns 200.' },
    ];
    expect(splitTurnPhases(parts).map((p) => p.kind)).toEqual([
      'trace',
      'text',
      'trace',
      'text',
    ]);
    const texts = splitTurnPhases(parts).filter((p) => p.kind === 'text');
    expect(texts[0]?.kind === 'text' && texts[0].text).toBe('I will update the handler.');
    expect(texts[1]?.kind === 'text' && texts[1].text).toBe(
      'Done — the handler now returns 200.',
    );
  });

  it('groups thinking and tools when there is no agent text between them', () => {
    const parts: MessagePart[] = [
      { type: 'thinking', text: 'plan the edit' },
      { type: 'tool', id: 't1', name: 'Read', status: 'done', description: 'Read foo.ts' },
      { type: 'thinking', text: 'apply the patch' },
      { type: 'tool', id: 't2', name: 'Edit', status: 'done', description: 'Edit foo.ts' },
      { type: 'text', text: 'Done — the handler now returns 200.' },
    ];
    const phases = splitTurnPhases(parts);
    expect(phases.map((p) => p.kind)).toEqual(['trace', 'text']);
    expect(phases[0]?.kind === 'trace' && phases[0].parts.map((p) => p.type)).toEqual([
      'thinking',
      'tool',
      'thinking',
      'tool',
    ]);
  });

  it('skips present_plan / ask_user tools so they do not become a work block', () => {
    const parts: MessagePart[] = [
      { type: 'thinking', text: 'ask' },
      {
        type: 'tool',
        id: 'p1',
        name: 'mcp__sideboard__present_plan',
        status: 'done',
      },
      { type: 'text', text: 'Here is the plan.' },
    ];
    expect(splitTurnPhases(parts).map((p) => p.kind)).toEqual(['trace', 'text']);
  });
});

describe('phaseDurationMs', () => {
  it('uses startedAt/updatedAt span', () => {
    expect(
      phaseDurationMs([
        { startedAt: 1000, updatedAt: 4000 },
        { startedAt: 2000, updatedAt: 63000 },
      ]),
    ).toBe(62000);
  });

  it('ticks from startedAt while live', () => {
    expect(
      phaseDurationMs([{ startedAt: 1000, updatedAt: 2000 }], {
        live: true,
        now: 1000 + 62_000,
      }),
    ).toBe(62_000);
  });
});
