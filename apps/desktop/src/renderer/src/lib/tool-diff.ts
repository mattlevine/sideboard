export type DiffRow =
  | { kind: 'context'; lineNo: number; text: string }
  | { kind: 'del'; lineNo: number; text: string }
  | { kind: 'add'; lineNo: number; text: string }
  | { kind: 'collapse'; direction: 'up' | 'down'; count: number; rows: DiffRow[] };

export interface ToolDiffModel {
  path: string;
  rows: DiffRow[];
  additions: number;
  deletions: number;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function splitLines(text: string): string[] {
  if (text === '') return [''];
  const parts = text.split('\n');
  // Drop trailing empty from final newline for display consistency
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function collapseContext(
  rows: Extract<DiffRow, { kind: 'context' }>[],
  direction: 'up' | 'down',
  keep = 4,
): DiffRow[] {
  if (rows.length <= keep + 2) return rows;
  const hidden = direction === 'up' ? rows.slice(0, rows.length - keep) : rows.slice(keep);
  const visible = direction === 'up' ? rows.slice(rows.length - keep) : rows.slice(0, keep);
  const collapse: DiffRow = {
    kind: 'collapse',
    direction,
    count: hidden.length,
    rows: hidden,
  };
  return direction === 'up' ? [collapse, ...visible] : [...visible, collapse];
}

/** Build a Conductor-style hunk from Edit/Write tool input (+ optional current file). */
export function buildToolDiff(
  input: Record<string, unknown> | undefined,
  filePath: string | undefined,
  fileContent: string | null,
): ToolDiffModel | null {
  if (!input && !filePath) return null;
  const path =
    filePath ??
    str(input?.file_path) ??
    str(input?.path) ??
    str(input?.filePath) ??
    str(input?.filename) ??
    'file';

  const oldS = str(input?.old_string) ?? str(input?.oldString);
  const newS = str(input?.new_string) ?? str(input?.newString);
  const writeContent = str(input?.content);

  // Write / create: whole file as additions (prefer content; fall back to file)
  if ((oldS == null || oldS === '') && (newS != null || writeContent != null)) {
    const body = newS ?? writeContent ?? fileContent ?? '';
    const lines = splitLines(body);
    return {
      path,
      additions: lines.length,
      deletions: 0,
      rows: lines.map((text, i) => ({ kind: 'add' as const, lineNo: i + 1, text })),
    };
  }

  if (oldS == null || newS == null) {
    // Bash or non-edit: no code diff
    return null;
  }

  const oldLines = splitLines(oldS);
  const newLines = splitLines(newS);
  const rows: DiffRow[] = [];

  let before: string[] = [];
  let after: string[] = [];
  let startLine = 1;

  if (fileContent != null) {
    const idx = fileContent.indexOf(newS);
    if (idx >= 0) {
      const beforeText = fileContent.slice(0, idx);
      const afterText = fileContent.slice(idx + newS.length);
      before = beforeText === '' ? [] : splitLines(beforeText);
      // last element of before may be partial line without trailing newline handling
      if (beforeText.length > 0 && !beforeText.endsWith('\n') && before.length > 0) {
        // newS started mid-line — rare for Edit; keep as-is
      }
      after = afterText.startsWith('\n')
        ? splitLines(afterText.slice(1))
        : afterText === ''
          ? []
          : splitLines(afterText);
      startLine = before.length + 1;
    } else {
      // File may still have old content if edit failed/reverted — try old string
      const oldIdx = fileContent.indexOf(oldS);
      if (oldIdx >= 0) {
        const beforeText = fileContent.slice(0, oldIdx);
        const afterText = fileContent.slice(oldIdx + oldS.length);
        before = beforeText === '' ? [] : splitLines(beforeText);
        after = afterText.startsWith('\n')
          ? splitLines(afterText.slice(1))
          : afterText === ''
            ? []
            : splitLines(afterText);
        startLine = before.length + 1;
      }
    }
  }

  const beforeCtx = before.map((text, i) => ({
    kind: 'context' as const,
    lineNo: i + 1,
    text,
  }));
  rows.push(...collapseContext(beforeCtx, 'up'));

  for (let i = 0; i < oldLines.length; i++) {
    rows.push({ kind: 'del', lineNo: startLine + i, text: oldLines[i]! });
  }
  for (let i = 0; i < newLines.length; i++) {
    rows.push({ kind: 'add', lineNo: startLine + i, text: newLines[i]! });
  }

  const afterStart = startLine + Math.max(oldLines.length, newLines.length);
  // Prefer new line count for after numbering when lengths differ
  const afterLineBase = startLine + newLines.length;
  const afterCtx = after.map((text, i) => ({
    kind: 'context' as const,
    lineNo: afterLineBase + i,
    text,
  }));
  void afterStart;
  rows.push(...collapseContext(afterCtx, 'down'));

  return {
    path,
    rows,
    additions: newLines.length,
    deletions: oldLines.length,
  };
}

const UNIFIED_HEADER =
  /^(diff --git |index |--- |\+\+\+ |new file |deleted file |old mode |new mode |similarity |rename |copy |Binary )/;

/**
 * Parse a unified `git diff` patch into Conductor/Cursor-style DiffRows.
 * Skips git headers; uses new-side line numbers for context/add, old-side for dels.
 */
export function parseUnifiedPatch(patch: string): DiffRow[] {
  if (!patch.trim()) return [];

  const rows: DiffRow[] = [];
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

    if (!inHunk) continue;

    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', lineNo: newLine++, text: raw.slice(1) });
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({ kind: 'del', lineNo: oldLine++, text: raw.slice(1) });
      continue;
    }
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    // Context (leading space) or blank line inside a hunk
    const text = raw.startsWith(' ') ? raw.slice(1) : raw;
    rows.push({ kind: 'context', lineNo: newLine, text });
    oldLine++;
    newLine++;
  }

  return rows;
}

/** Lightweight .env / key=value tint; otherwise plain. */
export function tintLine(text: string): { key?: string; value?: string; comment?: string; plain?: string } {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return { comment: text };
  }
  const eq = text.indexOf('=');
  if (eq > 0 && !text.slice(0, eq).includes(' ')) {
    return { key: text.slice(0, eq), value: text.slice(eq) };
  }
  return { plain: text };
}
