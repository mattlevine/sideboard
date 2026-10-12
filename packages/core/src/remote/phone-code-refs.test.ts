import { describe, expect, it } from 'vitest';
import { parsePhoneCodeRefs } from './phone-code-refs.js';

describe('parsePhoneCodeRefs', () => {
  it('keeps a file selection', () => {
    expect(
      parsePhoneCodeRefs([
        { path: 'apps\\mobile\\App.tsx', startLine: 10, endLine: 12, text: '  const n = 1\n' },
      ]),
    ).toEqual([{ path: 'apps/mobile/App.tsx', startLine: 10, endLine: 12, text: '  const n = 1' }]);
  });

  it('drops a range that ends before it starts', () => {
    expect(parsePhoneCodeRefs([{ path: 'a.ts', startLine: 4, endLine: 2, text: 'n' }])).toBe('invalid');
  });

  it('drops a blank selection', () => {
    expect(parsePhoneCodeRefs([{ path: 'a.ts', startLine: 1, endLine: 1, text: '  \n' }])).toBe('invalid');
  });

  it('treats a missing list as no refs', () => {
    expect(parsePhoneCodeRefs(undefined)).toEqual([]);
  });
});
