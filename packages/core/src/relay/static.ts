import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function requestHostname(req: IncomingMessage): string {
  const raw = req.headers.host ?? '';
  return raw.split(':')[0]?.toLowerCase() ?? '';
}

export function hostnameAllowed(host: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(host);
}

/** Resolve a GET path under `root`, or null if it would escape the tree. */
export function resolveStaticPath(root: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://relay.local').pathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith('/') || pathname.includes('\0')) return null;
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, `.${pathname}`);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return candidate;
}

async function fileSize(file: string): Promise<number | null> {
  try {
    const st = await stat(file);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  size: number,
): boolean {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

/**
 * Serve a file from `root` for GET/HEAD. Directory URLs map to `index.html`.
 * Returns false when this request is not a static hit (caller should 404 / fall through).
 */
export async function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const candidate = resolveStaticPath(root, req.url || '/');
  if (!candidate) return false;

  const direct = await fileSize(candidate);
  if (direct != null) return sendFile(req, res, candidate, direct);

  const asIndex = path.join(candidate, 'index.html');
  const indexSize = await fileSize(asIndex);
  if (indexSize != null) return sendFile(req, res, asIndex, indexSize);
  return false;
}
