import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns', async () => {
  const actual = await vi.importActual<typeof import('node:dns')>('node:dns');
  class FakeResolver {
    setServers(_servers: string[]) {}
    resolve4(
      _hostname: string,
      callback: (err: Error | null, addresses: string[]) => void,
    ) {
      callback(null, ['66.241.125.177']);
    }
  }
  return { ...actual, Resolver: FakeResolver };
});

describe('lookupPreferPublicDns', () => {
  it('returns LookupAddress[] when callers pass all: true (ws Happy Eyeballs)', async () => {
    const { lookupPreferPublicDns } = await import('./public-dns.js');
    const result = await new Promise<{
      address: string | Array<{ address: string; family: number }>;
      family?: number;
    }>((resolve, reject) => {
      lookupPreferPublicDns('relay.sideboard.cloud', { all: true, hints: 1024 }, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });
    expect(result.address).toEqual([{ address: '66.241.125.177', family: 4 }]);
  });

  it('returns a single IPv4 string when all is not set', async () => {
    const { lookupPreferPublicDns } = await import('./public-dns.js');
    const result = await new Promise<{
      address: string | Array<{ address: string }>;
      family?: number;
    }>((resolve, reject) => {
      lookupPreferPublicDns('relay.sideboard.cloud', {}, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });
    expect(result.address).toBe('66.241.125.177');
    expect(result.family).toBe(4);
  });
});
