import { describe, expect, it } from 'vitest';
import { formatUpdaterCheckError, sanitizeUpdaterError } from './updater-error';

const YAML_DUMP = `Cannot parse update info from https://github.com/mattlevine/sideboard/releases/download/v0.1.202/latest-mac.yml: YAMLException: end of the stream or a document separator is expected at line 3, column 1:

    ^
    at generateError (/app/node_modules/js-yaml/lib/loader.js:183:10)
    at throwError (/app/node_modules/js-yaml/lib/loader.js:187:9)
    at readDocument (/app/node_modules/js-yaml/lib/loader.js:1643:5)
    , rawData: version: 0.1.202
files:
  - url: Sideboard-0.1.202-arm64-mac.zip
    sha512: ${'A'.repeat(88)}
path: Sideboard-0.1.202-arm64-mac.zip
sha512: ${'B'.repeat(88)}
releaseDate: '2026-09-16T21:00:00.000Z'
`;

describe('formatUpdaterCheckError', () => {
  it('treats a mid-publish YAML dump as “not ready yet”', () => {
    const result = formatUpdaterCheckError(new Error(YAML_DUMP));
    expect(result.kind).toBe('publishing');
    expect(result.title).toBe('Update not ready yet');
    expect(result.detail).toBe('A new version may still be publishing. Try again in a minute.');
    expect(result.detail.length).toBeLessThan(120);
    expect(result.detail).not.toMatch(/rawData|YAMLException|sha512/i);
  });

  it('treats a missing latest-mac.yml as still publishing', () => {
    const result = formatUpdaterCheckError(
      new Error(
        'HttpError: 404 Not Found\n"method: GET url: https://github.com/mattlevine/sideboard/releases/download/v0.1.202/latest-mac.yml"',
      ),
    );
    expect(result.kind).toBe('publishing');
    expect(result.detail).toMatch(/still be publishing/);
  });

  it('treats a checksum race as still publishing', () => {
    const result = formatUpdaterCheckError(
      new Error(`sha512 checksum mismatch, expected ${'x'.repeat(88)}, got ${'y'.repeat(88)}`),
    );
    expect(result.kind).toBe('publishing');
  });

  it('treats an HTML GitHub error page as still publishing', () => {
    const result = formatUpdaterCheckError(
      new Error('Cannot parse update info from latest-mac.yml: <!DOCTYPE html><html>'),
    );
    expect(result.kind).toBe('publishing');
  });

  it('treats a network failure as offline, not a dump', () => {
    const result = formatUpdaterCheckError(
      new Error('net::ERR_NAME_NOT_RESOLVED getaddrinfo ENOTFOUND github.com'),
    );
    expect(result.kind).toBe('offline');
    expect(result.detail).toMatch(/couldn’t be reached/i);
  });

  it('keeps a real failure short and drops rawData', () => {
    const result = formatUpdaterCheckError(
      new Error('Code signature validation failed.\nrawData: huge yaml body here'),
    );
    expect(result.kind).toBe('failed');
    expect(result.title).toBe('Couldn’t check for updates');
    expect(result.detail).toBe('Code signature validation failed.');
    expect(result.detail).not.toMatch(/rawData/i);
  });
});

describe('sanitizeUpdaterError', () => {
  it('caps a long first line', () => {
    expect(sanitizeUpdaterError('x'.repeat(300)).length).toBe(218);
  });
});
