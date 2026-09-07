import { describe, expect, it } from 'vitest';
import { createModalHasDraft } from './create-modal-draft';

describe('createModalHasDraft', () => {
  it('is empty when nothing is typed or attached', () => {
    expect(
      createModalHasDraft({
        mode: 'create',
        prompt: '  ',
        goal: '',
        attachmentCount: 0,
      }),
    ).toBe(false);
  });

  it('treats typed create or orchestration text as a draft', () => {
    expect(
      createModalHasDraft({
        mode: 'create',
        prompt: 'fix the modal',
        goal: '',
        attachmentCount: 0,
      }),
    ).toBe(true);
    expect(
      createModalHasDraft({
        mode: 'orchestration',
        prompt: '',
        goal: 'coordinate the fleet',
        attachmentCount: 0,
      }),
    ).toBe(true);
  });

  it('treats attachments and a create-from selection as a draft', () => {
    expect(
      createModalHasDraft({
        mode: 'create',
        prompt: '',
        goal: '',
        attachmentCount: 1,
      }),
    ).toBe(true);
    expect(
      createModalHasDraft({
        mode: 'create',
        prompt: '',
        goal: '',
        attachmentCount: 0,
        hasSelection: true,
      }),
    ).toBe(true);
  });
});
