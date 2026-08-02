import { describe, expect, it } from 'vitest';
import { extractiveSummary } from './summarize.js';

describe('extractiveSummary', () => {
  it('pulls user goals and tool lines from a transcript', () => {
    const transcript = [
      '### User',
      'Fix auth redirect loop',
      '### Agent',
      'Looking at the login flow',
      'Tools:',
      '- Edit: auth.ts (src/auth.ts)',
      '### User',
      'Also add tests',
    ].join('\n');

    const summary = extractiveSummary(transcript);
    expect(summary).toContain('Fix auth redirect loop');
    expect(summary).toContain('Edit: auth.ts');
    expect(summary).toContain('extractive');
  });
});
