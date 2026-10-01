import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_MISSING_MSG,
  ARTIFACT_OPEN_EXTERNAL_MSG,
  ARTIFACT_READY_MSG,
  injectArtifactNavigationGuard,
} from './artifact-nav-guard';
import {
  ARTIFACT_PREVIEW_BOOT_BG,
  artifactPreviewUrl,
  injectArtifactPreviewBoot,
  missingArtifactPreviewHtml,
  parseArtifactPreviewId,
  prepareArtifactPreviewHtml,
} from './artifact-preview-page';

describe('injectArtifactNavigationGuard', () => {
  it('injects before </body> and is idempotent', () => {
    const html = '<!DOCTYPE html><html><body><a href="/x">x</a></body></html>';
    const once = injectArtifactNavigationGuard(html);
    expect(once).toContain('data-sideboard-artifact-nav');
    expect(once).toContain(ARTIFACT_OPEN_EXTERNAL_MSG);
    expect(once).toContain(ARTIFACT_READY_MSG);
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

describe('artifact preview page', () => {
  it('parses the artifact id from the custom-protocol URL', () => {
    expect(parseArtifactPreviewId(artifactPreviewUrl('tool-a1', 4))).toBe('tool-a1');
    expect(parseArtifactPreviewId('sideboard-artifact://preview/fence-0?v=1&t=9')).toBe('fence-0');
  });

  it('serves a dark missing page that pings the parent instead of white 404 copy', () => {
    const html = missingArtifactPreviewHtml();
    expect(html).toContain(ARTIFACT_PREVIEW_BOOT_BG);
    expect(html).toContain(ARTIFACT_MISSING_MSG);
    expect(html.toLowerCase()).not.toContain('preview missing');
    expect(html).toContain('color-scheme');
  });

  it('injects a boot cover and is idempotent', () => {
    const html = '<!DOCTYPE html><html><head></head><body><h1>Hi</h1></body></html>';
    const once = injectArtifactPreviewBoot(html);
    expect(once).toContain('data-sideboard-artifact-boot');
    expect(once).toContain('sideboard-artifact-boot');
    expect(injectArtifactPreviewBoot(once)).toBe(once);
  });

  it('prepare chains boot cover then nav/ready script', () => {
    const html = '<!DOCTYPE html><html><head></head><body><p>x</p></body></html>';
    const out = prepareArtifactPreviewHtml(html);
    expect(out.indexOf('data-sideboard-artifact-boot')).toBeGreaterThan(-1);
    expect(out.indexOf('data-sideboard-artifact-nav')).toBeGreaterThan(
      out.indexOf('data-sideboard-artifact-boot'),
    );
    expect(out).toContain(ARTIFACT_READY_MSG);
  });
});
