import type { ThreadAttachment } from '../types/thread.js';

export interface DiffCommentLine {
  side: 'add' | 'del' | 'context';
  lineNo: number;
  text: string;
}

export interface DiffCommentInput {
  path: string;
  comment: string;
  lines: DiffCommentLine[];
  id?: string;
}

function lineRangeLabel(lines: DiffCommentLine[]): string {
  const nos = lines.map((l) => l.lineNo);
  const start = Math.min(...nos);
  const end = Math.max(...nos);
  return start === end ? `L${start}` : `L${start}-${end}`;
}

function formatDiffBody(lines: DiffCommentLine[]): string {
  return lines
    .map((l) => {
      const prefix = l.side === 'add' ? '+' : l.side === 'del' ? '-' : ' ';
      return `${prefix}${l.text}`;
    })
    .join('\n');
}

/**
 * Build a composer attachment from a Changes/diff line selection + reviewer note.
 * Expanded into agent context via `expandComposerPrompt` like other attachments.
 */
export function buildDiffCommentAttachment(input: DiffCommentInput): ThreadAttachment {
  const comment = input.comment.trim();
  if (!input.path.trim()) {
    throw new Error('diff comment requires a file path');
  }
  if (!comment) {
    throw new Error('diff comment requires a note');
  }
  if (input.lines.length === 0) {
    throw new Error('diff comment requires at least one cited line');
  }

  const range = lineRangeLabel(input.lines);
  const name = `${input.path}:${range}`;
  const content = [
    `Diff review comment on \`${input.path}\` (${range}).`,
    '',
    'Address this feedback on the cited lines. Prefer a precise fix over rewriting unrelated code.',
    '',
    '### Reviewer comment',
    comment,
    '',
    '### Cited diff',
    '```diff',
    formatDiffBody(input.lines),
    '```',
  ].join('\n');

  return {
    id:
      input.id ??
      `diff-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    kind: 'diff-comment',
    path: input.path.trim(),
    content,
  };
}
