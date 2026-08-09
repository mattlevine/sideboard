import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_OPEN_EXTERNAL_MSG,
  injectArtifactNavigationGuard,
} from './artifact-nav-guard';

describe('injectArtifactNavigationGuard', () => {
  it('injects before </body> and is idempotent', () => {
    const html = '<!DOCTYPE html><html><body><a href="/x">x</a></body></html>';
    const once = injectArtifactNavigationGuard(html);
    expect(once).toContain('data-sideboard-artifact-nav');
    expect(once).toContain(ARTIFACT_OPEN_EXTERNAL_MSG);
    expect(once.indexOf('</body>')).toBeGreaterThan(once.indexOf('data-sideboard-artifact-nav'));
    expect(injectArtifactNavigationGuard(once)).toBe(once);
  });

  it('appends when there is no body tag', () => {
    const html = '<a href="https://example.com">go</a>';
    const out = injectArtifactNavigationGuard(html);
    expect(out.startsWith(html)).toBe(true);
    expect(out).toContain('data-sideboard-artifact-nav');
  });
});
