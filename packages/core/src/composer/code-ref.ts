import type { ThreadAttachment } from '../types/thread.js';

export interface CodeRefInput {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  language?: string;
  id?: string;
}

export interface CodeLineRange {
  startLine: number;
  endLine: number;
}

/** Inclusive 1-based line label, matching diff-comment chips (`L10` / `L10-20`). */
export function codeRefRangeLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}

/**
 * Normalize a Monaco-style selection to an inclusive line range.
 * Selecting down to column 1 of the next line does not include that line.
 */
export function normalizeCodeSelection(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): CodeLineRange | null {
  if (startLine < 1 || endLine < 1) return null;
  let sl = startLine;
  let sc = startColumn;
  let el = endLine;
  let ec = endColumn;
  if (el < sl || (el === sl && ec < sc)) {
    sl = endLine;
    sc = endColumn;
    el = startLine;
    ec = startColumn;
  }
  if (sl === el && sc === ec) return null;
  if (ec <= 1 && el > sl) el -= 1;
  return { startLine: sl, endLine: el };
}

function fenceLanguage(path: string, language?: string): string {
  if (language && language !== 'plaintext') return language;
  const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  const ext = base.includes('.') ? base.split('.').pop() ?? '' : '';
  return ext;
}

/**
 * Build a composer attachment from a code-file selection.
 * Expanded into agent context via `expandComposerPrompt` like other attachments.
 */
export function buildCodeRefAttachment(input: CodeRefInput): ThreadAttachment {
  const path = input.path.trim();
  const text = input.text.replace(/\n$/, '');
  if (!path) {
    throw new Error('code reference requires a file path');
  }
  if (!text.trim()) {
    throw new Error('code reference requires selected text');
  }
  if (input.startLine < 1 || input.endLine < 1 || input.endLine < input.startLine) {
    throw new Error('code reference requires a valid line range');
  }

  const range = codeRefRangeLabel(input.startLine, input.endLine);
  const lang = fenceLanguage(path, input.language);
  const fence = lang ? '```' + lang : '```';
  const content = [
    `Referenced code from \`${path}\` (${range}).`,
    '',
    fence,
    text,
    '```',
  ].join('\n');

  return {
    id:
      input.id ??
      `code-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${path}:${range}`,
    kind: 'code-ref',
    path,
    content,
  };
}

export interface PathRefInput {
  path: string;
  entry: 'file' | 'dir';
  /** Tracked files under a folder (shown as a short listing). */
  childPaths?: string[];
  id?: string;
}

const FOLDER_LISTING_CAP = 40;

function formatFolderListing(childPaths: string[]): string[] {
  if (childPaths.length === 0) return ['(no tracked files in this folder)'];
  const shown = childPaths.slice(0, FOLDER_LISTING_CAP);
  const lines = ['Tracked files:', ...shown.map((p) => `- \`${p}\``)];
  if (childPaths.length > FOLDER_LISTING_CAP) {
    lines.push(`(and ${childPaths.length - FOLDER_LISTING_CAP} more)`);
  }
  return lines;
}

/**
 * Build a composer attachment from a file-tree file or folder.
 * Folder chips use a trailing slash so they are not opened as files.
 */
export function buildPathRefAttachment(input: PathRefInput): ThreadAttachment {
  const path = input.path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!path) {
    throw new Error('path reference requires a file or folder path');
  }
  const isDir = input.entry === 'dir';
  const name = isDir ? `${path}/` : path;
  const content = isDir
    ? [
        `Referenced folder \`${path}/\`.`,
        '',
        'Use Glob, Grep, and Read under this directory when you need files in it.',
        '',
        ...formatFolderListing(input.childPaths ?? []),
      ].join('\n')
    : [
        `Referenced file \`${path}\`.`,
        '',
        `Use the Read tool on \`${path}\` when you need the contents.`,
      ].join('\n');

  return {
    id:
      input.id ??
      `path-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    kind: 'code-ref',
    path: name,
    content,
  };
}
