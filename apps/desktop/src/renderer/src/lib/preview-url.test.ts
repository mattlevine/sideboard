import { describe, expect, it } from 'vitest';
import { githubPrNumber, normalizePreviewUrl, previewUrlTabLabel } from './preview-url';

describe('normalizePreviewUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(normalizePreviewUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizePreviewUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('prefixes bare hosts and ports', () => {
    expect(normalizePreviewUrl('localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizePreviewUrl('127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app');
  });

  it('rejects unsafe schemes', () => {
    expect(normalizePreviewUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePreviewUrl('file:///etc/passwd')).toBeNull();
    expect(normalizePreviewUrl('')).toBeNull();
  });
});

describe('previewUrlTabLabel', () => {
  it('shows host and path', () => {
    expect(previewUrlTabLabel('http://localhost:3000/docs')).toBe('localhost:3000/docs');
  });

  it('shows the GitHub PR number', () => {
    expect(previewUrlTabLabel('https://github.com/acme/app/pull/99')).toBe('#99');
    expect(previewUrlTabLabel('https://github.com/acme/app/pull/99/files')).toBe('#99');
  });
});


describe('githubPrNumber', () => {
  it('reads /pull/N from github.com', () => {
    expect(githubPrNumber('https://github.com/acme/app/pull/99')).toBe('99');
    expect(githubPrNumber('https://example.com/acme/app/pull/99')).toBeNull();
  });
});
