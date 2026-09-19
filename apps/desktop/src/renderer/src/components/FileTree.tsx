import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { setSideboardFileDrag } from '../lib/sideboard-file-drag';
import {
  AddReferenceButton,
  AddReferenceMenu,
  contextMenuTarget,
  type PathRefTarget,
} from './AddReferenceAction';
import { GitChangeBadge, type GitFileChange } from './GitChangeBadge';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children?: TreeNode[];
}

export function ancestorDirectories(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  const dirs: string[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    dirs.push(acc);
  }
  return dirs;
}

const DEFAULT_EXPANDED = ['apps', 'packages', 'scripts'];

export function expandedWithFocus(
  base: Iterable<string>,
  focusDirectory: string | null | undefined,
): Set<string> {
  const next = new Set(base);
  if (focusDirectory && focusDirectory !== '.') {
    for (const dir of ancestorDirectories(focusDirectory)) next.add(dir);
  }
  return next;
}

export function buildFileTree(paths: string[], extraDirs: string[] = []): TreeNode[] {
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

  for (const dir of extraDirs) {
    const parts = dir.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      cur.children ??= [];
      let next = cur.children.find((c) => c.name === part);
      if (!next) {
        next = { name: part, path: acc, kind: 'dir', children: [] };
        cur.children.push(next);
      } else if (next.kind === 'file') {
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

export function filesUnderPrefix(paths: string[], prefix: string): string[] {
  const root = prefix.replace(/\/+$/, '');
  if (!root) return [...paths];
  const needle = `${root}/`;
  return paths.filter((p) => p === root || p.startsWith(needle));
}

interface Props {
  paths: string[];
  selected: string | null;
  filter?: string;
  onSelect: (path: string) => void;
  /** Git change markers keyed by relative path. */
  changes?: Record<string, GitFileChange>;
  /** When set, files can be dragged onto the CMS file manager. */
  threadId?: string;
  /** Add a file or folder as a composer reference. */
  onAddReference?: (target: PathRefTarget & { childPaths?: string[] }) => void;
  /** Expand / highlight this folder (chat path clicks). */
  focusDirectory?: string | null;
  /** Bump to re-scroll when the same folder is clicked again. */
  focusNonce?: number;
}

export function FileTree({
  paths,
  selected,
  filter = '',
  onSelect,
  changes = {},
  threadId,
  onAddReference,
  focusDirectory = null,
  focusNonce,
}: Props) {
  const extraDirs = useMemo(
    () => (focusDirectory && focusDirectory !== '.' ? ancestorDirectories(focusDirectory) : []),
    [focusDirectory],
  );
  const tree = useMemo(() => buildFileTree(paths, extraDirs), [paths, extraDirs]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandedWithFocus(DEFAULT_EXPANDED, focusDirectory),
  );
  const [menu, setMenu] = useState<{ target: PathRefTarget; x: number; y: number } | null>(
    null,
  );

  const q = filter.trim().toLowerCase();

  useLayoutEffect(() => {
    if (!focusDirectory || focusDirectory === '.') return;
    setExpanded((prev) => {
      const next = expandedWithFocus(prev, focusDirectory);
      if (next.size === prev.size && [...next].every((d) => prev.has(d))) return prev;
      return next;
    });
  }, [focusDirectory, focusNonce]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !focusDirectory) return;
    if (focusDirectory === '.') {
      host.scrollTop = 0;
      return;
    }
    const row = host.querySelector(`[data-tree-path="${CSS.escape(focusDirectory)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [focusDirectory, focusNonce, expanded]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function addRef(target: PathRefTarget) {
    onAddReference?.({
      ...target,
      childPaths: target.kind === 'dir' ? filesUnderPrefix(paths, target.path) : undefined,
    });
  }

  function renderNode(node: TreeNode, depth: number): ReactNode {
    const focused =
      Boolean(focusDirectory) &&
      (node.path === focusDirectory ||
        Boolean(focusDirectory && focusDirectory.startsWith(`${node.path}/`)));
    if (q && !focused) {
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

    const target: PathRefTarget = { path: node.path, kind: node.kind };
    const refBtn = onAddReference ? (
      <AddReferenceButton label={node.path} onAdd={() => addRef(target)} />
    ) : null;

    if (node.kind === 'file') {
      const change = changes[node.path];
      const onDragStart = (e: DragEvent) => {
        if (!threadId) return;
        setSideboardFileDrag(e.dataTransfer, [node.path], threadId);
      };
      return (
        <div
          key={node.path}
          className="tree-row-wrap"
          onContextMenu={
            onAddReference
              ? (e) => setMenu(contextMenuTarget(e, target))
              : undefined
          }
        >
          <button
            type="button"
            className={`tree-row${selected === node.path ? ' active' : ''}${change ? ' changed' : ''}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => onSelect(node.path)}
            draggable={Boolean(threadId)}
            onDragStart={onDragStart}
          >
            <span className="tree-glyph file">{fileGlyph(node.name)}</span>
            <span className="tree-name">{node.name}</span>
            {change && <GitChangeBadge change={change} />}
          </button>
          {refBtn}
        </div>
      );
    }

    const open = q ? true : expanded.has(node.path);
    const kids = node.children ?? [];
    return (
      <div key={node.path}>
        <div
          className="tree-row-wrap"
          onContextMenu={
            onAddReference
              ? (e) => setMenu(contextMenuTarget(e, target))
              : undefined
          }
        >
          <button
            type="button"
            className={`tree-row dir${focusDirectory === node.path ? ' active' : ''}`}
            data-tree-path={node.path}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => toggle(node.path)}
          >
            <span className="tree-chevron">{open ? '▾' : '▸'}</span>
            <span className="tree-glyph dir" />
            <span className="tree-name">{node.name}</span>
          </button>
          {refBtn}
        </div>
        {open && kids.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  if (!tree.length) return <div className="empty">No files</div>;

  return (
    <div ref={hostRef} className="file-tree" data-skip-native-text-menu="">
      {tree.map((n) => renderNode(n, 0))}
      {menu && onAddReference && (
        <AddReferenceMenu
          target={menu.target}
          x={menu.x}
          y={menu.y}
          onAdd={addRef}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
