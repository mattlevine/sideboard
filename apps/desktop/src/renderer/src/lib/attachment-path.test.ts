import { describe, expect, it } from 'vitest';
import type { ThreadAttachment } from '@sideboard-ai/core';
import { attachmentOpenPath } from './attachment-path';

function att(partial: Partial<ThreadAttachment> & Pick<ThreadAttachment, 'kind' | 'name'>): ThreadAttachment {
  return {
    id: 't',
    content: '',
    ...partial,
  };
}

describe('attachmentOpenPath', () => {
  it('opens a code-ref from path or chip name', () => {
    expect(
      attachmentOpenPath(
        att({
          kind: 'code-ref',
          name: 'src/app.ts:L10-12',
          path: 'src/app.ts',
        }),
      ),
    ).toBe('src/app.ts');
    expect(
      attachmentOpenPath(
        att({
          kind: 'code-ref',
          name: 'apps/desktop/src/App.tsx:L4',
        }),
      ),
    ).toBe('apps/desktop/src/App.tsx');
  });

  it('does not open a folder path-ref as a file', () => {
    expect(
      attachmentOpenPath(
        att({
          kind: 'code-ref',
          name: 'apps/desktop/',
          path: 'apps/desktop/',
        }),
      ),
    ).toBeNull();
  });
});
