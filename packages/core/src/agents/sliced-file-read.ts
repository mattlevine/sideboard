/**
 * Bounded file read for worktree agents. Cursor's built-in Read has no
 * offset/limit in the SDK schema — a whole `architecture.md` / CSS bundle
 * blows the protobuf payload and kills the turn. This replacement defaults
 * to a slice and tells the model how to continue.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TOOL_RESULT_STORE_MAX_CHARS } from './error-detail.js';

export const SLICED_READ_DEFAULT_LIMIT = 200;
export const SLICED_READ_MAX_LINE_CHARS = 2_000;

export const SLICED_READ_DESCRIPTION =
  'Read a text file. Defaults to 200 lines (and a small char budget). Pass offset (1-based) + limit to continue — never request the whole file when it is large.';

export const SLICED_READ_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Absolute or cwd-relative path inside the worktree.',
    },
    offset: {
      type: 'number',
      description: '1-based start line (default 1).',
    },
    limit: {
      type: 'number',
      description: `Max lines to return (default ${SLICED_READ_DEFAULT_LIMIT}).`,
    },
  },
  required: ['path'],
} as const;

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isOutsideWorktree(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function resolveWithinCwd(cwd: string, input: string): string {
  const root = realpathOrSelf(cwd);
  const abs = isAbsolute(input) ? resolve(input) : resolve(root, input);
  if (isOutsideWorktree(root, abs)) {
    throw new Error(`Path is outside the worktree: ${input}`);
  }
  const real = realpathOrSelf(abs);
  if (isOutsideWorktree(root, real)) {
    throw new Error(`Path is outside the worktree: ${input}`);
  }
  return real;
}

function capLine(line: string): string {
  if (line.length <= SLICED_READ_MAX_LINE_CHARS) return line;
  return `${line.slice(0, SLICED_READ_MAX_LINE_CHARS)}…(${line.length - SLICED_READ_MAX_LINE_CHARS} more chars on this line)`;
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8_192);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export type SlicedFileReadArgs = {
  path?: unknown;
  offset?: unknown;
  limit?: unknown;
};

export type SlicedFileReadTool = {
  description: string;
  inputSchema: typeof SLICED_READ_INPUT_SCHEMA;
  execute: (args: Record<string, unknown>) => string;
};

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

/** Numbered slice of a worktree file — never the whole blob when it is large. */
export function executeSlicedFileRead(cwd: string, args: SlicedFileReadArgs): string {
  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  if (!rawPath) return 'Error: path is required.';
  let abs: string;
  try {
    abs = resolveWithinCwd(cwd, rawPath);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  let buf: Buffer;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return `Error: not a file: ${rawPath}`;
    buf = readFileSync(abs);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (looksBinary(buf)) {
    return `Error: ${rawPath} looks binary (${buf.length} bytes). Do not dump it into the turn.`;
  }

  const text = buf.toString('utf8');
  const lines = text.split('\n');
  // split keeps a trailing empty line when the file ends with \n
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const totalLines = lines.length;
  const offset = asPositiveInt(args.offset, 1);
  const limit = asPositiveInt(args.limit, SLICED_READ_DEFAULT_LIMIT);
  const start = Math.min(offset, totalLines + 1);
  const end = Math.min(start + limit - 1, totalLines);

  const numbered: string[] = [];
  let used = 0;
  let stoppedEarly = false;
  for (let i = start; i <= end; i += 1) {
    const row = `${String(i).padStart(6, ' ')}|${capLine(lines[i - 1] ?? '')}`;
    if (used + row.length + 1 > TOOL_RESULT_STORE_MAX_CHARS && numbered.length > 0) {
      stoppedEarly = true;
      break;
    }
    numbered.push(row);
    used += row.length + 1;
  }

  const header = `${rawPath} (${totalLines} lines, ${buf.length} bytes)`;
  if (totalLines === 0) return `${header}\n(empty file)`;
  if (start > totalLines) {
    return `${header}\noffset ${offset} is past EOF. Last line is ${totalLines}.`;
  }

  const shownEnd = start + numbered.length - 1;
  const truncated = stoppedEarly || shownEnd < totalLines;
  const body = numbered.join('\n');
  if (!truncated && start === 1) return `${header}\n${body}`;
  const next = shownEnd + 1;
  const hint = truncated
    ? `\n\n…truncated; ${totalLines - shownEnd} lines remain. Re-call with offset=${next} (and limit) — do not read the whole file.`
    : start > 1
      ? `\n\n(lines ${start}–${shownEnd} of ${totalLines})`
      : '';
  return `${header}\n${body}${hint}`;
}

export function slicedReadCustomToolConfig(cwd: string): SlicedFileReadTool {
  return {
    description: SLICED_READ_DESCRIPTION,
    inputSchema: SLICED_READ_INPUT_SCHEMA,
    execute: (args) => executeSlicedFileRead(cwd, args),
  };
}
