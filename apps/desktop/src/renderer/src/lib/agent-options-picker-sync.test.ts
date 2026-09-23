import { describe, expect, it } from 'vitest';
import { shouldSnapshotPickerFromHost } from './agent-options-picker-sync';

describe('shouldSnapshotPickerFromHost', () => {
  it('snapshots when the picker first opens and ignores live value echoes', () => {
    expect(shouldSnapshotPickerFromHost(true, false)).toBe(true);
    expect(shouldSnapshotPickerFromHost(true, true)).toBe(false);
    expect(shouldSnapshotPickerFromHost(false, true)).toBe(false);
  });
});
