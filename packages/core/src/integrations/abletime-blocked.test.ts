import { describe, expect, it } from 'vitest';
import { ableTimeBlockedByIdentifiers } from './abletime-blocked.js';

describe('ableTimeBlockedByIdentifiers', () => {
  it('reads a wait-on id from the task payload', () => {
    expect(
      ableTimeBlockedByIdentifiers({
        task: { blocked_by: { identifier: 'CRM-8' } },
      }),
    ).toEqual(['CRM-8']);
    expect(ableTimeBlockedByIdentifiers({ depends_on: 'CRM-1' })).toEqual(['CRM-1']);
  });
});
