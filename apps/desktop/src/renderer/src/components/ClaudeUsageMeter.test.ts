import { describe, expect, it } from 'vitest';
import {
  formatClaudeUsageCompact,
  formatClaudeUsageTooltip,
  parseClaudeUsagePayload,
} from '@sideboard/claude-usage';

describe('Claude plan usage labels', () => {
  const usage = parseClaudeUsagePayload(
    {
      five_hour: { utilization: 32, resets_at: '2026-04-08T18:00:00Z' },
      seven_day: { utilization: 59, resets_at: '2026-04-14T16:00:00Z' },
      seven_day_opus: { utilization: 12 },
    },
    '2026-04-08T12:00:00.000Z',
  )!;

  it('shows remaining percent per window', () => {
    expect(usage.windows.map(formatClaudeUsageCompact)).toEqual([
      '5h 68%',
      'wk 41%',
      'Opus 88%',
    ]);
  });

  it('tooltip lists remaining, used, and reset', () => {
    const tip = formatClaudeUsageTooltip(usage, new Date('2026-04-08T12:00:00Z'));
    expect(tip).toContain('5-hour session — Rolling 5-hour limit across all models');
    expect(tip).toContain('68% left');
    expect(tip).toContain('Weekly — 7-day cap across all models');
    expect(tip).toContain('41% left');
    expect(tip).toContain('Opus — Weekly Opus-only cap');
    expect(tip).toContain('88% left');
  });
});
