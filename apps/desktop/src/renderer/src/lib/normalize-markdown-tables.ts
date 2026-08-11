/**
 * Repair common LLM markdown table mistakes so remark-gfm can parse them.
 *
 * Agents often emit a 1-cell delimiter (`|---|`) under a multi-column header.
 * GFM then rejects the table and soft-breaks collapse the rows into one paragraph.
 */

function isPipeRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.includes('|', 1);
}

function columnCount(line: string): number {
  const t = line.trim();
  if (!t.includes('|')) return 0;
  // Split and drop empty edges from leading/trailing pipes.
  const parts = t.split('|');
  const start = parts[0]?.trim() === '' ? 1 : 0;
  const end =
    parts.length > start && parts[parts.length - 1]?.trim() === ''
      ? parts.length - 1
      : parts.length;
  return Math.max(0, end - start);
}

function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('-')) return false;
  // Only pipes, dashes, colons, spaces.
  if (!/^[\s|:\-]+$/.test(t)) return false;
  return columnCount(t) >= 1;
}

function delimiterForColumns(cols: number): string {
  if (cols <= 0) return '|---|';
  return `|${' --- |'.repeat(cols)}`;
}

/** Expand underspecified GFM table delimiter rows to match the header width. */
export function normalizeMarkdownTables(text: string): string {
  if (!text.includes('|')) return text;
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (
      next != null &&
      isPipeRow(line) &&
      !isDelimiterRow(line) &&
      isDelimiterRow(next)
    ) {
      const headerCols = columnCount(line);
      const delimCols = columnCount(next);
      if (headerCols >= 2 && delimCols > 0 && delimCols < headerCols) {
        out.push(line);
        out.push(delimiterForColumns(headerCols));
        i += 1; // skip broken delimiter
        continue;
      }
    }
    out.push(line);
  }

  return out.join('\n');
}
