import { describe, expect, it } from 'vitest';
import {
  examplePrefixedBranch,
  resolveGitBranchPrefix,
  sanitizeGitBranchPrefix,
} from './branch-prefix.js';

describe('sanitizeGitBranchPrefix', () => {
  it('lowercases and keeps a single path segment', () => {
    expect(sanitizeGitBranchPrefix('Matt/extra')).toBe('matt');
    expect(sanitizeGitBranchPrefix('/Matt/')).toBe('matt');
    expect(sanitizeGitBranchPrefix('  matt-levine  ')).toBe('matt-levine');
  });

  it('returns null for blank input', () => {
    expect(sanitizeGitBranchPrefix('')).toBeNull();
    expect(sanitizeGitBranchPrefix('   ')).toBeNull();
    expect(sanitizeGitBranchPrefix(null)).toBeNull();
  });
});

describe('resolveGitBranchPrefix', () => {
  it('uses the saved setting when set', () => {
    expect(resolveGitBranchPrefix({ setting: 'ml' })).toBe('ml');
  });

  it('stays empty when the setting is blank', () => {
    expect(resolveGitBranchPrefix({ setting: '' })).toBeNull();
    expect(resolveGitBranchPrefix({})).toBeNull();
  });
});

describe('examplePrefixedBranch', () => {
  it('matches matt/bb-1234-eng-fix-thing when prefixed', () => {
    expect(examplePrefixedBranch('matt')).toBe('matt/bb-1234-eng-fix-thing');
    expect(examplePrefixedBranch('matt', 'bb-1234')).toBe('matt/bb-1234-eng-fix-thing');
  });

  it('omits the slash when no prefix is available', () => {
    expect(examplePrefixedBranch(null, 'eng-12')).toBe('eng-12-eng-fix-thing');
  });
});
