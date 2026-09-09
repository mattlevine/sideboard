import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySystemCaEnv,
  collectSystemCaPem,
  materializeSystemCaBundle,
  NODE_EXTRA_CA_CERTS,
  NODE_USE_SYSTEM_CA,
  splitPemCertificates,
  systemCaBundlePath,
  trustSystemCertificates,
} from './system-ca.js';

const SAMPLE_PEM = `-----BEGIN CERTIFICATE-----
MIIBSample
-----END CERTIFICATE-----
`;

describe('splitPemCertificates', () => {
  it('extracts one or more PEM blocks and ignores noise', () => {
    expect(splitPemCertificates('not a cert')).toEqual([]);
    expect(splitPemCertificates(SAMPLE_PEM)).toHaveLength(1);
    expect(
      splitPemCertificates(`${SAMPLE_PEM}\nignored\n${SAMPLE_PEM}`),
    ).toHaveLength(2);
  });
});

describe('collectSystemCaPem', () => {
  it('dumps the default macOS keychain search list', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout: SAMPLE_PEM });
    expect(collectSystemCaPem({ platform: 'darwin', spawn })).toBe(SAMPLE_PEM);
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/security',
      ['find-certificate', '-a', '-p'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('returns empty when security fails or the platform has no dump', () => {
    expect(
      collectSystemCaPem({
        platform: 'darwin',
        spawn: () => ({ status: 1, stdout: '' }),
      }),
    ).toBe('');
    expect(collectSystemCaPem({ platform: 'win32' })).toBe('');
  });
});

describe('applySystemCaEnv', () => {
  const prevExtra = process.env.NODE_EXTRA_CA_CERTS;

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = prevExtra;
  });

  it('sets NODE_USE_SYSTEM_CA without overriding an existing extra CA file', () => {
    const env: Record<string, string | undefined> = {
      NODE_EXTRA_CA_CERTS: '/tmp/custom.pem',
    };
    applySystemCaEnv(env);
    expect(env[NODE_USE_SYSTEM_CA]).toBe('1');
    expect(env[NODE_EXTRA_CA_CERTS]).toBe('/tmp/custom.pem');
  });

  it('does not overwrite NODE_USE_SYSTEM_CA', () => {
    const env: Record<string, string | undefined> = { NODE_USE_SYSTEM_CA: '0' };
    applySystemCaEnv(env);
    expect(env[NODE_USE_SYSTEM_CA]).toBe('0');
  });

  it('copies NODE_EXTRA_CA_CERTS from the parent process when unset', () => {
    process.env.NODE_EXTRA_CA_CERTS = '/tmp/parent.pem';
    const env: Record<string, string | undefined> = {};
    applySystemCaEnv(env);
    expect(env[NODE_EXTRA_CA_CERTS]).toBe('/tmp/parent.pem');
  });
});

describe('materializeSystemCaBundle', () => {
  const prevExtra = process.env.NODE_EXTRA_CA_CERTS;

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = prevExtra;
  });

  it('reuses a fresh bundle and refreshes an empty one', () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    const dir = mkdtempSync(join(tmpdir(), 'sb-system-ca-mat-'));
    try {
      const dest = systemCaBundlePath({ appData: () => dir });
      mkdirSync(dir, { recursive: true });
      writeFileSync(dest, SAMPLE_PEM);
      expect(
        materializeSystemCaBundle({
          platform: 'darwin',
          appData: () => dir,
          spawn: () => {
            throw new Error('should not dump');
          },
        }),
      ).toBe(dest);

      writeFileSync(dest, 'not a cert\n');
      const dumped = materializeSystemCaBundle({
        platform: 'darwin',
        appData: () => dir,
        spawn: () => ({ status: 0, stdout: SAMPLE_PEM }),
      });
      expect(dumped).toBe(dest);
      expect(readFileSync(dest, 'utf8')).toContain('BEGIN CERTIFICATE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('trustSystemCertificates', () => {
  it('is a boolean and does not throw', () => {
    expect(typeof trustSystemCertificates({ platform: 'win32' })).toBe('boolean');
  });
});
