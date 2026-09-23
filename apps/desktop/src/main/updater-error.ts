export type UpdaterCheckKind = 'publishing' | 'offline' | 'failed';

export type UpdaterCheckMessage = {
  kind: UpdaterCheckKind;
  title: string;
  detail: string;
};

const PUBLISHING_DETAIL =
  'A new version may still be publishing. Try again in a minute.';
const OFFLINE_DETAIL = 'The update server couldn’t be reached. Check your connection and try again.';

/**
 * electron-updater includes YAML `rawData`, stacks, and the full feed URL in
 * `Error.message`. That is what blows up the Check for Updates dialog while a
 * GitHub Release is still uploading `latest-mac.yml` / the zip.
 */
export function formatUpdaterCheckError(err: unknown): UpdaterCheckMessage {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();

  if (isOfflineError(text)) {
    return {
      kind: 'offline',
      title: 'Couldn’t check for updates',
      detail: OFFLINE_DETAIL,
    };
  }

  if (isPublishingInProgress(text, raw)) {
    return {
      kind: 'publishing',
      title: 'Update not ready yet',
      detail: PUBLISHING_DETAIL,
    };
  }

  return {
    kind: 'failed',
    title: 'Couldn’t check for updates',
    detail: sanitizeUpdaterError(raw),
  };
}

export function sanitizeUpdaterError(raw: string): string {
  const withoutRaw = raw.split(/\brawData:/i)[0] ?? raw;
  const firstLine = withoutRaw.split(/\r?\n/)[0]?.trim() || 'Something went wrong.';
  if (firstLine.length > 220) return `${firstLine.slice(0, 217)}…`;
  return firstLine;
}

function isOfflineError(text: string): boolean {
  return (
    text.includes('enotfound') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('eai_again') ||
    text.includes('enetunreach') ||
    text.includes('enetdown') ||
    text.includes('net::err_')
  );
}

function isPublishingInProgress(text: string, raw: string): boolean {
  if (
    text.includes('cannot parse update info') ||
    text.includes('yamlexception') ||
    text.includes('end of the stream') ||
    text.includes('unexpected end')
  ) {
    return true;
  }

  if (text.includes('<!doctype') || text.includes('<html')) {
    return true;
  }

  if (text.includes('checksum') || text.includes('sha512') || text.includes('sha256')) {
    return true;
  }

  if (/\b404\b/.test(text) || text.includes('not found') || text.includes('enoent')) {
    return true;
  }

  // GitHub serves release assets via Azure; mid-upload curls get BlobNotFound XML
  // ("blobnotfound" — no space, so it misses the "not found" check above).
  if (text.includes('blobnotfound') || text.includes('specified blob does not exist')) {
    return true;
  }

  // GitHub often 403s assets that exist in the release but are still processing.
  if (/\b403\b/.test(text) || text.includes('forbidden')) {
    return true;
  }

  if (/\blatest-mac\.yml\b/i.test(raw) || /\blatest\.yml\b/i.test(raw)) {
    return text.includes('http') || text.includes('cannot download');
  }

  return false;
}
