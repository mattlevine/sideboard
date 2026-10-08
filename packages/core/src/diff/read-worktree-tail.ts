import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** End of a text file. Matches the head cap so a live log is not stuck on the first 200KB. */
export const WORKTREE_TAIL_BYTES = 200_000;

export function readWorktreeFileTail(
  worktreePath: string,
  relativePath: string,
  maxBytes = WORKTREE_TAIL_BYTES,
): {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
  encoding: 'utf8';
} {
  if (!relativePath || relativePath.includes('..') || relativePath.startsWith('/')) {
    throw new Error('Invalid path');
  }
  const abs = join(worktreePath, relativePath);
  const fd = openSync(abs, 'r');
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`Not a file: ${relativePath}`);
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    if (length > 0) readSync(fd, buf, 0, length, start);
    if (buf.subarray(0, Math.min(buf.length, 8_000)).includes(0)) {
      return {
        path: relativePath,
        content: `(binary file, ${size} bytes)`,
        truncated: false,
        binary: true,
        encoding: 'utf8',
      };
    }
    let content = buf.toString('utf8');
    const truncated = start > 0;
    if (truncated) {
      const nl = content.indexOf('\n');
      if (nl >= 0) content = content.slice(nl + 1);
    }
    return { path: relativePath, content, truncated, binary: false, encoding: 'utf8' };
  } finally {
    closeSync(fd);
  }
}
