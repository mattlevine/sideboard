import { describe, expect, it } from 'vitest';
import {
  artifactSourcePath,
  documentPreviewKind,
  imageMimeType,
  inferLanguageFromContent,
  isImagePath,
  resolveCodeLanguage,
} from './language';

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

const TS_SNIPPET = `/** Compact JSON for MCP tool results (no pretty-print whitespace). */
export function mcpJson(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}
`;

describe('resolveCodeLanguage', () => {
  it('maps fence language names and extensions', () => {
    expect(resolveCodeLanguage('typescript')).toBe('typescript');
    expect(resolveCodeLanguage('ts')).toBe('typescript');
    expect(resolveCodeLanguage('python')).toBe('python');
    expect(resolveCodeLanguage('rs')).toBe('rust');
    expect(resolveCodeLanguage('artifact.ts')).toBe('typescript');
  });

  it('sniffs TypeScript when the label is generic or numeric', () => {
    expect(inferLanguageFromContent(TS_SNIPPET)).toBe('typescript');
    expect(resolveCodeLanguage('code', TS_SNIPPET)).toBe('typescript');
    expect(resolveCodeLanguage('69', TS_SNIPPET)).toBe('typescript');
    expect(resolveCodeLanguage('', TS_SNIPPET)).toBe('typescript');
    expect(artifactSourcePath('69', TS_SNIPPET)).toBe('artifact.ts');
  });

  it('does not override a real language with sniffing', () => {
    expect(resolveCodeLanguage('python', TS_SNIPPET)).toBe('python');
  });
});
