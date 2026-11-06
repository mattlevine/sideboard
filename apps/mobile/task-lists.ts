/**
 * GFM task lists (`- [ ]` / `- [x]`). markdown-it leaves the marker as text.
 * Mark the list item and strip the marker so the row can draw a checkbox.
 */

const TASK_RE = /^\[([ xX])\][ \t]+/;

type TaskToken = {
  type: string;
  content: string;
  children?: TaskToken[] | null;
  attrSet: (name: string, value: string) => void;
};

export function taskListPlugin(md: {
  core: {
    ruler: {
      after: (afterName: string, name: string, fn: (state: { tokens: TaskToken[] }) => void) => void;
    };
  };
}): void {
  md.core.ruler.after('inline', 'sideboard_task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token || token.type !== 'inline' || !token.children?.length) continue;
      if (tokens[i - 1]?.type !== 'paragraph_open') continue;
      const item = tokens[i - 2];
      if (!item || item.type !== 'list_item_open') continue;
      const first = token.children[0];
      if (!first || first.type !== 'text') continue;
      const match = TASK_RE.exec(first.content);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      item.attrSet('task', match[1]?.toLowerCase() === 'x' ? 'checked' : 'open');
    }
  });
}
