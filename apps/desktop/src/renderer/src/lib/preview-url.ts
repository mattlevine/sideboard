/** Normalize user input into an http(s) URL for the in-app preview tab. */
export function normalizePreviewUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const u = new URL(trimmed);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    }

    // localhost:3000, 127.0.0.1:5173, example.com, example.com/path
    if (
      /^localhost(:\d+)?(\/|$)/i.test(trimmed) ||
      /^127\.0\.0\.1(:\d+)?(\/|$)/.test(trimmed) ||
      /^[\w.-]+\.\w{2,}(:\d+)?(\/|$)/.test(trimmed) ||
      /^[\w.-]+:\d+(\/|$)/.test(trimmed)
    ) {
      return new URL(`http://${trimmed}`).href;
    }
  } catch {
    return null;
  }

  return null;
}

/** Short label for a URL tab (hostname + path, trimmed). */
export function previewUrlTabLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const label = `${u.host}${path}${u.search}${u.hash}`;
    return label.length > 40 ? `${label.slice(0, 37)}…` : label || url;
  } catch {
    return url.length > 40 ? `${url.slice(0, 37)}…` : url;
  }
}
