import { selectionLineRange } from './phone-code-ref';

/** Unified diff rows, matching the desktop Changes view. */
export type PhoneDiffRow =
  | { kind: 'context'; lineNo: number; text: string }
  | { kind: 'del'; lineNo: number; text: string }
  | { kind: 'add'; lineNo: number; text: string };

const UNIFIED_HEADER =
  /^(diff --git |index |--- |\+\+\+ |new file |deleted file |old mode |new mode |similarity |rename |copy |Binary )/;

/** Parse a `git diff` patch the same way the desktop Changes pane does. */
export function parseUnifiedPatch(patch: string): PhoneDiffRow[] {
  if (!patch.trim()) return [];
  const rows: PhoneDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    if (!inHunk && UNIFIED_HEADER.test(raw)) continue;
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw === '') continue;
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', lineNo: newLine++, text: raw.slice(1) });
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({ kind: 'del', lineNo: oldLine++, text: raw.slice(1) });
      continue;
    }
    if (raw.startsWith('\\')) continue;
    const text = raw.startsWith(' ') ? raw.slice(1) : raw;
    rows.push({ kind: 'context', lineNo: newLine, text });
    oldLine++;
    newLine++;
  }
  return rows;
}

function diffMark(kind: PhoneDiffRow['kind']): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '-';
  return ' ';
}

/** Diff text the phone can select. Each row is one line, with a git-style mark. */
export function diffSelectableBody(rows: PhoneDiffRow[]): string {
  return rows.map((row) => `${diffMark(row.kind)}${row.text}`).join('\n');
}

/**
 * Map a character selection in `diffSelectableBody` to file line numbers.
 * The text keeps the +/− marks so the chat can see what changed.
 */
export function diffCodeSelection(
  rows: PhoneDiffRow[],
  start: number,
  end: number,
): { startLine: number; endLine: number; text: string } | null {
  const rough = selectionLineRange(diffSelectableBody(rows), start, end);
  if (!rough) return null;
  const slice = rows.slice(rough.startLine - 1, rough.endLine);
  if (slice.length === 0) return null;
  const nos = slice.map((row) => Math.max(1, row.lineNo));
  return { startLine: Math.min(...nos), endLine: Math.max(...nos), text: rough.text };
}

export type DiffRowSelection = { anchor: number; focus: number };

/**
 * First tap selects one colored row. The next tap extends that range.
 * A tap after a range starts over on the row you hit.
 */
export function tapDiffRow(current: DiffRowSelection | null, index: number): DiffRowSelection {
  if (current && current.anchor === current.focus) return { anchor: current.anchor, focus: index };
  return { anchor: index, focus: index };
}

/** File lines for a tap range on the colored diff, including the +/− marks. */
export function diffIndexSelection(
  rows: PhoneDiffRow[],
  anchor: number,
  focus: number,
): { startLine: number; endLine: number; text: string } | null {
  const lo = Math.min(anchor, focus);
  const hi = Math.max(anchor, focus);
  if (lo < 0 || hi >= rows.length) return null;
  const start = rowOffset(rows, lo);
  const end = rowOffset(rows, hi) + 1 + rows[hi].text.length;
  return diffCodeSelection(rows, start, end);
}

function rowOffset(rows: PhoneDiffRow[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += 1 + rows[i].text.length + 1;
  return offset;
}

export type ChangeBadge = {
  letter?: string;
  letterColor?: string;
  add?: number;
  del?: number;
};

const ADD = '#6a9955';
const DEL = '#f14c4c';
const MOD = '#c4a574';

/** Status letter plus non-zero counts, matching the desktop git badge. */
export function changeBadge(status: string | undefined, detail: string | undefined): ChangeBadge | null {
  const counts = detail ? parseChangeCounts(detail) : null;
  const letter = status?.[0]?.toUpperCase();
  if (!letter && !counts) return null;
  return {
    ...(letter ? { letter, letterColor: letter === 'A' ? ADD : letter === 'D' ? DEL : MOD } : {}),
    ...(counts && counts.add > 0 ? { add: counts.add } : {}),
    ...(counts && counts.del > 0 ? { del: counts.del } : {}),
  };
}

/** `+12 −3` from the Mac. The minus may be U+2212 or a hyphen. */
function parseChangeCounts(detail: string): { add: number; del: number } | null {
  const match = /^\+(\d+)\s+[−-](\d+)$/.exec(detail.trim());
  if (!match) return null;
  return { add: Number(match[1]), del: Number(match[2]) };
}
