import { describe, expect, it } from 'vitest';
import { automationEditorShouldCloseOnEscape } from './automation-escape';

describe('automation editor escape', () => {
  const escape = { key: 'Escape', defaultPrevented: false };

  it('closes the editor when no nested overlay is open', () => {
    expect(automationEditorShouldCloseOnEscape(escape, { busy: false, nestedOverlayOpen: false })).toBe(
      true,
    );
  });

  it('leaves the editor open for a menu, image, or confirm dialog', () => {
    expect(automationEditorShouldCloseOnEscape(escape, { busy: false, nestedOverlayOpen: true })).toBe(
      false,
    );
    expect(
      automationEditorShouldCloseOnEscape(
        { key: 'Escape', defaultPrevented: true },
        { busy: false, nestedOverlayOpen: false },
      ),
    ).toBe(false);
    expect(automationEditorShouldCloseOnEscape(escape, { busy: true, nestedOverlayOpen: false })).toBe(
      false,
    );
  });
});
