import { describe, expect, it } from 'vitest';
import { documentPreviewKind, imageMimeType, isImagePath } from './language';

describe('image preview helpers', () => {
  it('detects image extensions', () => {
    expect(isImagePath('assets/logo.png')).toBe(true);
    expect(isImagePath('photo.JPEG')).toBe(true);
    expect(isImagePath('icon.svg')).toBe(true);
    expect(isImagePath('readme.md')).toBe(false);
  });

  it('maps mime types', () => {
    expect(imageMimeType('a.jpg')).toBe('image/jpeg');
    expect(imageMimeType('b.svg')).toBe('image/svg+xml');
  });

  it('includes image in documentPreviewKind', () => {
    expect(documentPreviewKind('shot.webp')).toBe('image');
    expect(documentPreviewKind('notes.md')).toBe('markdown');
    expect(documentPreviewKind('index.html')).toBe('html');
    expect(documentPreviewKind('app.ts')).toBeNull();
  });
});
