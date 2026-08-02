import { describe, expect, it } from 'vitest';
import { titleFromPrompt } from './title.js';

describe('titleFromPrompt', () => {
  it('uses the first line and capitalizes', () => {
    expect(titleFromPrompt('fix the resizable panel width persistence\nmore detail')).toBe(
      'Fix the resizable panel width persistence',
    );
  });

  it('strips chatty prefixes', () => {
    expect(titleFromPrompt('please can you add dark mode to settings')).toBe(
      'Add dark mode to settings',
    );
  });

  it('truncates long prompts at a word boundary', () => {
    const title = titleFromPrompt(
      'Rewrite the entire authentication stack to support SSO and MFA across all products',
      40,
    );
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title).not.toMatch(/\s…$/);
  });

  it('returns empty for blank input', () => {
    expect(titleFromPrompt('   ')).toBe('');
  });
});
