import { describe, expect, it } from 'vitest';
import { highlightHtml, languageFromPath } from './code-language';

describe('languageFromPath', () => {
  it('maps extensions and well-known filenames', () => {
    expect(languageFromPath('apps/mobile/App.tsx')).toBe('typescript');
    expect(languageFromPath('script.py')).toBe('python');
    expect(languageFromPath('styles.css')).toBe('css');
    expect(languageFromPath('data.json')).toBe('json');
    expect(languageFromPath('run.sh')).toBe('bash');
    expect(languageFromPath('Dockerfile')).toBe('dockerfile');
    expect(languageFromPath('Dockerfile.prod')).toBe('dockerfile');
    expect(languageFromPath('Makefile')).toBe('makefile');
  });

  it('leaves unknown paths plain', () => {
    expect(languageFromPath('README')).toBe('');
    expect(languageFromPath('notes.unknown')).toBe('');
    expect(languageFromPath('')).toBe('');
  });

  it('colors a keyword in source', () => {
    expect(highlightHtml('const n = 1', 'typescript')).toContain('hljs-keyword');
    expect(highlightHtml('const n = 1', 'nope')).toBeNull();
  });
});
