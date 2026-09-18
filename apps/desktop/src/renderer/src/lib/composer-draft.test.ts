import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearComposerDraft,
  getComposerDraft,
  rememberComposerDraft,
} from './composer-draft';

describe('composer-draft', () => {
  beforeEach(() => {
    clearComposerDraft('t1');
    clearComposerDraft('t2');
  });

  it('is empty until something is typed', () => {
    expect(getComposerDraft('t1')).toBe('');
  });

  it('remembers text after leaving a chat and coming back', () => {
    rememberComposerDraft('t1', 'look at the failing test');
    expect(getComposerDraft('t1')).toBe('look at the failing test');
  });

  it('keeps drafts isolated per thread', () => {
    rememberComposerDraft('t1', 'first chat');
    rememberComposerDraft('t2', 'second chat');
    expect(getComposerDraft('t1')).toBe('first chat');
    expect(getComposerDraft('t2')).toBe('second chat');
  });

  it('clears an empty or sent draft', () => {
    rememberComposerDraft('t1', 'will send');
    rememberComposerDraft('t1', '');
    expect(getComposerDraft('t1')).toBe('');
    rememberComposerDraft('t1', 'again');
    clearComposerDraft('t1');
    expect(getComposerDraft('t1')).toBe('');
  });
});
