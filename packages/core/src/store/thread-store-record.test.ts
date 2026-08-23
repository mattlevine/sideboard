import { describe, expect, it } from 'vitest';
import { isThreadRecordFile } from './thread-store.js';

describe('isThreadRecordFile', () => {
  it('accepts thread records and rejects live sidecars and tmp writes', () => {
    expect(isThreadRecordFile('abc.json')).toBe(true);
    expect(isThreadRecordFile('/data/threads/abc.json')).toBe(true);
    expect(isThreadRecordFile('abc.live.json')).toBe(false);
    expect(isThreadRecordFile('/data/threads/abc.live.json')).toBe(false);
    expect(isThreadRecordFile('abc.live.json.12.tmp')).toBe(false);
    expect(isThreadRecordFile('abc.json.12.tmp')).toBe(false);
  });
});
