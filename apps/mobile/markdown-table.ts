/** Approximate column widths so phone tables share a column grid. */

const CELL_MIN = 64;
const CELL_MAX = 280;
const CHAR_PX = 8;
const PAD = 20;

type MdNode = {
  content?: string;
  children?: MdNode[];
};

function plainText(node: MdNode): string {
  const kids = node.children ?? [];
  if (kids.length) return kids.map(plainText).join('');
  return typeof node.content === 'string' ? node.content : '';
}

/** Longest line in each column, clamped so a wide cell scrolls instead of filling the screen. */
export function tableColumnWidths(table: MdNode): number[] {
  const widths: number[] = [];
  for (const section of table.children ?? []) {
    for (const row of section.children ?? []) {
      (row.children ?? []).forEach((cell, index) => {
        const longest = plainText(cell)
          .split('\n')
          .reduce((max, line) => Math.max(max, line.trimEnd().length), 0);
        const width = Math.min(CELL_MAX, Math.max(CELL_MIN, longest * CHAR_PX + PAD));
        widths[index] = Math.max(widths[index] ?? 0, width);
      });
    }
  }
  return widths;
}
