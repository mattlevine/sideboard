import { ipcMain, protocol } from 'electron';

export const ARTIFACT_PREVIEW_SCHEME = 'sideboard-artifact';

const htmlById = new Map<string, string>();
const MAX_HTML_CHARS = 5_000_000;

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

export function artifactPreviewUrl(id: string, rev = 0): string {
  return `${ARTIFACT_PREVIEW_SCHEME}://preview/${encodeURIComponent(id)}?v=${rev}`;
}

/** Register protocol handler + IPC after app is ready. */
export function bindArtifactPreviewProtocol(): void {
  protocol.handle(ARTIFACT_PREVIEW_SCHEME, (request) => {
    let id = '';
    try {
      const url = new URL(request.url);
      // sideboard-artifact://preview/<id> → host=preview, pathname=/<id>
      id = decodeURIComponent((url.pathname || '').replace(/^\//, ''));
      if (!id && url.hostname && url.hostname !== 'preview') {
        id = decodeURIComponent(url.hostname);
      }
    } catch {
      id = '';
    }
    const html = id ? htmlById.get(id) : undefined;
    if (!html) {
      return new Response(
        '<!DOCTYPE html><html><body style="font:14px system-ui;padding:16px;color:#444">Artifact preview missing — reload the pane.</body></html>',
        {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      );
    }
    return new Response(html, {
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
    return { url: artifactPreviewUrl(key) };
  });

  ipcMain.handle('artifactPreview:clear', (_e, id: unknown) => {
    if (typeof id === 'string' && id.trim()) htmlById.delete(id.trim());
  });
}
