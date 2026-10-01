import {
  ARTIFACT_MISSING_MSG,
  injectArtifactNavigationGuard,
} from './artifact-nav-guard';

export const ARTIFACT_PREVIEW_SCHEME = 'sideboard-artifact';

/** Dark chrome of the desktop pane — keep the iframe from painting white. */
export const ARTIFACT_PREVIEW_BOOT_BG = '#121212';

export function artifactPreviewUrl(id: string, rev = 0): string {
  return `${ARTIFACT_PREVIEW_SCHEME}://preview/${encodeURIComponent(id)}?v=${rev}`;
}

/** Parse `sideboard-artifact://preview/<id>?v=` from a protocol request URL. */
export function parseArtifactPreviewId(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    let id = decodeURIComponent((url.pathname || '').replace(/^\//, ''));
    if (!id && url.hostname && url.hostname !== 'preview') {
      id = decodeURIComponent(url.hostname);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * Shown when the map has no HTML. Must not paint light-on-white — the parent
 * keeps a loader up and republishes. Invisible dark page + postMessage.
 */
export function missingArtifactPreviewHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>html,body{margin:0;height:100%;background:${ARTIFACT_PREVIEW_BOOT_BG}}</style></head><body><script>try{parent.postMessage({type:${JSON.stringify(ARTIFACT_MISSING_MSG)},url:String(location.href)},'*')}catch(e){}</script></body></html>`;
}

/** Cover unstyled HTML until load; nav-guard script removes it and pings ready. */
export function injectArtifactPreviewBoot(html: string): string {
  if (html.includes('data-sideboard-artifact-boot')) return html;
  const style = `<style data-sideboard-artifact-boot>html{color-scheme:dark}#sideboard-artifact-boot{position:fixed;inset:0;z-index:2147483647;background:${ARTIFACT_PREVIEW_BOOT_BG}}</style>`;
  const cover = `<div id="sideboard-artifact-boot" data-sideboard-artifact-boot></div>`;
  let out = html;
  if (/<head[\s>]/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  } else if (/<html[\s>]/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`);
  } else {
    out = `${style}${out}`;
  }
  if (/<body[\s>]/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>${cover}`);
  } else {
    out = `${cover}${out}`;
  }
  return out;
}

export function prepareArtifactPreviewHtml(html: string): string {
  return injectArtifactNavigationGuard(injectArtifactPreviewBoot(html));
}
