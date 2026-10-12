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
