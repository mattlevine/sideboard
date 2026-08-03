import { describe, expect, it } from 'vitest';
import { formatBrightsyFetchError } from './api.js';

describe('formatBrightsyFetchError', () => {
  it('includes URL and undici cause code', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND brightsy.ai'), {
      code: 'ENOTFOUND',
    });
    const err = Object.assign(new TypeError('fetch failed'), { cause });
    expect(formatBrightsyFetchError(err, 'https://brightsy.ai/api/v1beta/desktop/tasks')).toBe(
      'fetch failed [ENOTFOUND: getaddrinfo ENOTFOUND brightsy.ai] (https://brightsy.ai/api/v1beta/desktop/tasks)',
    );
  });
});
