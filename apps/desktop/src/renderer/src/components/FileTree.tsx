import { useMemo, useState, type ReactNode } from 'react';
import { GitChangeBadge, type GitFileChange } from './GitChangeBadge';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children?: TreeNode[];
}

export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] };

  for (const full of paths) {
    const parts = full.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      cur.children ??= [];
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = {
          name: part,
          path: acc,
          kind: isFile ? 'file' : 'dir',
          children: isFile ? undefined : [],
        };
        cur.children.push(next);
      } else if (!isFile && next.kind === 'file') {
        // unlikely path conflict
        next.kind = 'dir';
        next.children ??= [];
      }
      cur = next;
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };
  sortNodes(root.children ?? []);
  return root.children ?? [];
}

function fileGlyph(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'TS';
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs')) return 'JS';
  if (name.endsWith('.sh')) return 'SH';
  if (name.endsWith('.md')) return 'MD';
  if (name.endsWith('.json')) return '{}';
  if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml')) return 'CFG';
  return '•';
}

interface Props {
  paths: string[];
  selected: string | null;
  filter?: string;
  onSelect: (path: string) => void;
  /** Git change markers keyed by relative path. */
  changes?: Record<string, GitFileChange>;
}

export function FileTree({
  paths,
  selected,
  filter = '',
  onSelect,
  changes = {},
}: Props) {
  const tree = useMemo(() => buildFileTree(paths), [paths]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['apps', 'packages', 'scripts']));

  const q = filter.trim().toLowerCase();

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: TreeNode, depth: number): ReactNode {
    if (q) {
      // When filtering, show matching files and their ancestor dirs
      if (node.kind === 'file') {
        if (!node.path.toLowerCase().includes(q)) return null;
      } else {
        const hasMatch = paths.some(
          (p) => p.startsWith(`${node.path}/`) && p.toLowerCase().includes(q),
        );
        if (!hasMatch && !node.path.toLowerCase().includes(q)) return null;
      }
    }

    if (node.kind === 'file') {
      const change = changes[node.path];
      return (
        <button
          key={node.path}
          type="button"
          className={`tree-row${selected === node.path ? ' active' : ''}${change ? ' changed' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onSelect(node.path)}
        >
          <span className="tree-glyph file">{fileGlyph(node.name)}</span>
          <span className="tree-name">{node.name}</span>
          {change && <GitChangeBadge change={change} />}
        </button>
      );
    }

    const open = q ? true : expanded.has(node.path);
    const kids = node.children ?? [];
    return (
      <div key={node.path}>
        <button
          type="button"
          className="tree-row dir"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => toggle(node.path)}
        >
          <span className="tree-chevron">{open ? '▾' : '▸'}</span>
          <span className="tree-glyph dir" />
          <span className="tree-name">{node.name}</span>
        </button>
        {open && kids.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  if (!tree.length) return <div className="empty">No files</div>;

  return <div className="file-tree">{tree.map((n) => renderNode(n, 0))}</div>;
}
