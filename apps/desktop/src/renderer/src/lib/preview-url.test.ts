import { describe, expect, it } from 'vitest';
import { normalizePreviewUrl, previewUrlTabLabel } from './preview-url';

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
});
