import { describe, expect, it } from 'vitest';
import { keepPaneOnOpenedChat } from './phone-pane-types';

describe('keepPaneOnOpenedChat', () => {
  it('stays on Changes when the Mac refreshes the chat already open', () => {
    expect(keepPaneOnOpenedChat('changes', true)).toBe(true);
    expect(keepPaneOnOpenedChat('files', true)).toBe(true);
    expect(keepPaneOnOpenedChat('checks', true)).toBe(true);
    expect(keepPaneOnOpenedChat('doc', true)).toBe(true);
  });

  it('returns to the transcript for a different chat, or when already on Chat', () => {
    expect(keepPaneOnOpenedChat('changes', false)).toBe(false);
    expect(keepPaneOnOpenedChat('chat', true)).toBe(false);
  });
});
