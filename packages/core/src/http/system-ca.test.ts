import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySystemCaEnv,
  bootstrapSystemCa,
  collectSystemCaPem,
  materializeSystemCaBundle,
  mergeSystemCaIntoTlsOptions,
  NODE_EXTRA_CA_CERTS,
  NODE_USE_SYSTEM_CA,
  splitPemCertificates,
  systemCaBundlePath,
  systemCaTlsOptions,
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

  it('wraps createSecureContext when setDefaultCACertificates is missing', () => {
    const prevExtra = process.env.NODE_EXTRA_CA_CERTS;
    const dir = mkdtempSync(join(tmpdir(), 'sb-system-ca-n20-'));
    const pemPath = join(dir, 'ca.pem');
    writeFileSync(pemPath, SAMPLE_PEM);
    process.env.NODE_EXTRA_CA_CERTS = pemPath;
    try {
      const extra = splitPemCertificates(SAMPLE_PEM)[0];
      const create = vi.fn((opts?: { ca?: Array<string | Buffer> }) => opts);
      const fakeTls = {
        createSecureContext: create,
        rootCertificates: ['ROOT'],
      };
      expect(trustSystemCertificates({ tls: fakeTls, platform: 'win32' })).toBe(true);
      fakeTls.createSecureContext({});
      expect(create).toHaveBeenCalledWith({ ca: ['ROOT', extra] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (prevExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = prevExtra;
    }
  });
});

describe('mergeSystemCaIntoTlsOptions', () => {
  const extra = ['EXTRA'];
  const roots = ['ROOT'];

  it('uses Mozilla roots plus extra when ca is omitted', () => {
    expect(mergeSystemCaIntoTlsOptions(undefined, extra, roots).ca).toEqual(['ROOT', 'EXTRA']);
  });

  it('appends extra to an existing ca list', () => {
    expect(mergeSystemCaIntoTlsOptions({ ca: ['GIVEN'] }, extra, roots).ca).toEqual([
      'GIVEN',
      'EXTRA',
    ]);
  });

  it('appends extra to a single ca string', () => {
    expect(mergeSystemCaIntoTlsOptions({ ca: 'GIVEN' }, extra, roots).ca).toEqual([
      'GIVEN',
      'EXTRA',
    ]);
  });
});

describe('systemCaTlsOptions', () => {
  const prevExtra = process.env.NODE_EXTRA_CA_CERTS;

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = prevExtra;
  });

  it('includes the extra bundle after Mozilla roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-system-ca-tls-'));
    const pemPath = join(dir, 'ca.pem');
    writeFileSync(pemPath, SAMPLE_PEM);
    process.env.NODE_EXTRA_CA_CERTS = pemPath;
    try {
      const extra = splitPemCertificates(SAMPLE_PEM)[0];
      const opts = systemCaTlsOptions({ platform: 'win32' });
      expect(opts.ca?.at(-1)).toBe(extra);
      expect(opts.ca?.length).toBeGreaterThan(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns no ca when there are no extra OS certificates', () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    expect(systemCaTlsOptions({ platform: 'win32', appData: () => '/tmp/sb-missing-ca' })).toEqual(
      {},
    );
  });
});

describe('bootstrapSystemCa', () => {
  const prevExtra = process.env.NODE_EXTRA_CA_CERTS;
  const prevUse = process.env.NODE_USE_SYSTEM_CA;

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = prevExtra;
    if (prevUse === undefined) delete process.env.NODE_USE_SYSTEM_CA;
    else process.env.NODE_USE_SYSTEM_CA = prevUse;
  });

  it('exports the Keychain dump for Node children', () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.NODE_USE_SYSTEM_CA;
    const dir = mkdtempSync(join(tmpdir(), 'sb-system-ca-boot-'));
    try {
      const setDefault = vi.fn();
      bootstrapSystemCa({
        platform: 'darwin',
        appData: () => dir,
        spawn: () => ({ status: 0, stdout: SAMPLE_PEM }),
        tls: {
          getCACertificates: (type) => (type === 'system' ? [] : ['BUNDLED']),
          setDefaultCACertificates: setDefault,
        },
      });
      expect(process.env.NODE_USE_SYSTEM_CA).toBe('1');
      expect(process.env.NODE_EXTRA_CA_CERTS).toBe(systemCaBundlePath({ appData: () => dir }));
      expect(setDefault).toHaveBeenCalled();
      const trusted = setDefault.mock.calls[0]?.[0] as string[];
      expect(trusted).toContain('BUNDLED');
      expect(trusted).toContain(splitPemCertificates(SAMPLE_PEM)[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
