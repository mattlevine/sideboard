import { ipcMain, protocol } from 'electron';
import { mcpUiContentSecurityPolicy } from '@sideboard-ai/core';
import {
  ARTIFACT_PREVIEW_SCHEME,
  artifactPreviewUrl,
  mcpUiPreviewUrl,
  missingArtifactPreviewHtml,
  parseArtifactPreviewId,
  prepareArtifactPreviewHtml,
} from './artifact-preview-page';

export { ARTIFACT_PREVIEW_SCHEME, artifactPreviewUrl };
export {
  ARTIFACT_MISSING_MSG,
  ARTIFACT_OPEN_EXTERNAL_MSG,
  ARTIFACT_READY_MSG,
  injectArtifactNavigationGuard,
} from './artifact-nav-guard';

const htmlById = new Map<string, string>();
const revById = new Map<string, number>();
const cspById = new Map<string, string>();
const MAX_HTML_CHARS = 5_000_000;
const MCP_UI_ID = /^mcpui-[a-f0-9]{8}$/;

/**
 * Must run before app.ready — lets artifact iframes load outside the renderer CSP
 * (srcdoc inherits script-src 'self' and blocks inline JS).
 */
export function registerArtifactPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARTIFACT_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/** Register protocol handler + IPC after app is ready. */
export function bindArtifactPreviewProtocol(): void {
  protocol.handle(ARTIFACT_PREVIEW_SCHEME, (request) => {
    const id = parseArtifactPreviewId(request.url);
    const html = id ? htmlById.get(id) : undefined;
    if (id?.startsWith('mcpui-')) {
      if (!html) {
        return new Response(missingArtifactPreviewHtml(), {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': cspById.get(id) || mcpUiContentSecurityPolicy(),
        },
      });
    }
    if (!html) {
      return new Response(missingArtifactPreviewHtml(), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(prepareArtifactPreviewHtml(html), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Artifacts are agent-authored demos; allow typical inline JS/CSS + CDNs.
        'content-security-policy':
          "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline' data:; img-src * data: blob:; font-src * data:; connect-src *; media-src * data: blob:; frame-src *;",
      },
    });
  });

  ipcMain.handle('artifactPreview:publish', (_e, id: unknown, html: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('invalid artifact id');
    }
    if (typeof html !== 'string') {
      throw new Error('invalid artifact html');
    }
    if (html.length > MAX_HTML_CHARS) {
      throw new Error('artifact too large');
    }
    const key = id.trim();
    htmlById.set(key, html);
    const rev = (revById.get(key) ?? 0) + 1;
    revById.set(key, rev);
    return { url: artifactPreviewUrl(key, rev) };
  });

  ipcMain.handle('artifactPreview:clear', (_e, id: unknown) => {
    if (typeof id === 'string' && id.trim()) {
      const key = id.trim();
      htmlById.delete(key);
      revById.delete(key);
      cspById.delete(key);
    }
  });

  ipcMain.handle('mcpUiPreview:publish', (_e, id: unknown, html: unknown, csp: unknown) => {
    if (typeof id !== 'string' || !MCP_UI_ID.test(id)) {
      throw new Error('invalid mcp-ui id');
    }
    if (typeof html !== 'string') throw new Error('invalid mcp-ui html');
    if (html.length > MAX_HTML_CHARS) throw new Error('mcp-ui app too large');
    const policy = typeof csp === 'string' && csp.trim() ? csp : mcpUiContentSecurityPolicy();
    htmlById.set(id, html);
    cspById.set(id, policy);
    const rev = (revById.get(id) ?? 0) + 1;
    revById.set(id, rev);
    return { url: mcpUiPreviewUrl(id, rev) };
  });

  ipcMain.handle('mcpUiPreview:clear', (_e, id: unknown) => {
    if (typeof id !== 'string' || !MCP_UI_ID.test(id)) return;
    htmlById.delete(id);
    cspById.delete(id);
    revById.delete(id);
  });
}
