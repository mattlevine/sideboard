import { useEffect, useMemo, useState } from 'react';
import { threadDisplayLabel } from '@sideboard/worktree-labels';
import type { IssueInfo, Thread, ThreadAttachment, Workspace } from '@sideboard/core';

interface IssuePickerProps {
  open: boolean;
  agent: Thread['agent'];
  repoPath: string;
  onClose: () => void;
  onPick: (attachment: ThreadAttachment) => void;
}

export function LinkIssuePicker({ open, agent, repoPath, onClose, onPick }: IssuePickerProps) {
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<IssueInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLoading(true);
    setError(null);
    void window.sideboard
      .listLinearIssues(agent, repoPath)
      .then((list) => {
        setIssues(list);
        if (list.length === 0) setError('empty');
      })
      .catch((err) => {
        setIssues([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [open, agent, repoPath]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(
      (i) =>
        i.identifier.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [issues, query]);

  if (!open) return null;

  return (
    <div className="composer-picker-backdrop" onClick={onClose}>
      <div
        className="composer-picker"
        role="dialog"
        aria-label="Link issue"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="composer-picker-search"
          autoFocus
          placeholder="Search issues..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        {loading && <div className="composer-picker-empty">Loading issues…</div>}
        {!loading && (error || filtered.length === 0) && (
          <div className="composer-picker-section">
            <div className="composer-picker-section-label">Setup</div>
            <button
              type="button"
              className="composer-picker-row"
              onClick={() => {
                void window.sideboard.openExternal('https://linear.app');
              }}
            >
              <span className="composer-picker-icons">
                <span className="picker-logo linear" aria-hidden />
              </span>
              <span className="composer-picker-main">
                <span className="composer-picker-title">Connect Linear</span>
              </span>
              <span className="composer-picker-hint">
                Setup <kbd>↵</kbd>
              </span>
            </button>
            {error && error !== 'empty' && (
              <div className="composer-picker-empty">{error}</div>
            )}
            {!error && filtered.length === 0 && issues.length > 0 && (
              <div className="composer-picker-empty">No matching issues</div>
            )}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="composer-picker-section">
            <div className="composer-picker-section-label">Issues</div>
            {filtered.slice(0, 40).map((issue) => (
              <button
                key={issue.id || issue.identifier}
                type="button"
                className="composer-picker-row"
                onClick={() => {
                  onPick({
                    id: crypto.randomUUID(),
                    name: issue.identifier || issue.title,
                    kind: 'issue',
                    content: [
                      `Linked issue: ${issue.identifier} — ${issue.title}`,
                      issue.url ? `URL: ${issue.url}` : null,
                      issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : null,
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  });
                  onClose();
                }}
              >
                <span className="composer-picker-icons">
                  <span className="picker-logo linear" aria-hidden />
                </span>
                <span className="composer-picker-main">
                  <span className="composer-picker-title">{issue.identifier}</span>
                  <span className="composer-picker-sub">{issue.title}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkspacePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (attachment: ThreadAttachment) => void;
}

export function LinkWorkspacePicker({ open, onClose, onPick }: WorkspacePickerProps) {
  const [query, setQuery] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLoading(true);
    void Promise.all([window.sideboard.listWorkspaces(), window.sideboard.getThreads(false)])
      .then(([ws, th]) => {
        setWorkspaces(ws);
        // One row per worktree (stable worktree label, not tab title).
        const byWt = new Map<string, Thread>();
        for (const t of th) {
          const key = t.worktreePath;
          const prev = byWt.get(key);
          if (!prev || t.createdAt < prev.createdAt) byWt.set(key, t);
        }
        setThreads([...byWt.values()]);
      })
      .catch(() => {
        setWorkspaces([]);
        setThreads([]);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byRepo = new Map<string, { name: string; threads: Thread[] }>();
    for (const ws of workspaces) {
      byRepo.set(ws.path, { name: ws.name, threads: [] });
    }
    for (const t of threads) {
      const key = t.repoPath;
      const name = workspaces.find((w) => w.path === key)?.name ?? key.split('/').pop() ?? key;
      const group = byRepo.get(key) ?? { name, threads: [] };
      group.threads.push(t);
      byRepo.set(key, group);
    }
    const entries = [...byRepo.entries()].map(([path, g]) => ({
      path,
      name: g.name,
      threads: g.threads.filter((t) => {
        if (!q) return true;
        return (
          threadDisplayLabel(t).toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.branchName.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q)
        );
      }),
      matchRepo: !q || g.name.toLowerCase().includes(q),
    }));
    return entries.filter((e) => e.matchRepo || e.threads.length > 0);
  }, [workspaces, threads, query]);

  if (!open) return null;

  return (
    <div className="composer-picker-backdrop" onClick={onClose}>
      <div
        className="composer-picker"
        role="dialog"
        aria-label="Link workspaces"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="composer-picker-search"
          autoFocus
          placeholder="Search workspaces..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="composer-picker-section">
          <div className="composer-picker-section-label">Directories</div>
          <button
            type="button"
            className="composer-picker-row"
            onClick={() => {
              void window.sideboard.pickRepoPath().then((path) => {
                if (!path) return;
                const name = path.split('/').pop() || path;
                onPick({
                  id: crypto.randomUUID(),
                  name,
                  kind: 'workspace',
                  content: `Linked workspace directory:\nPath: ${path}`,
                });
                onClose();
              });
            }}
          >
            <span className="composer-picker-icons">
              <span className="picker-folder" aria-hidden />
            </span>
            <span className="composer-picker-main">
              <span className="composer-picker-title">Browse…</span>
            </span>
          </button>
        </div>
        {loading && <div className="composer-picker-empty">Loading…</div>}
        {!loading &&
          groups.map((group) => (
            <div key={group.path} className="composer-picker-section">
              <div className="composer-picker-section-label">{group.name}</div>
              {group.threads.length === 0 ? (
                <button
                  type="button"
                  className="composer-picker-row"
                  onClick={() => {
                    onPick({
                      id: crypto.randomUUID(),
                      name: group.name,
                      kind: 'workspace',
                      content: [
                        `Linked workspace: ${group.name}`,
                        `Main repo (reference only — do not edit app code here): ${group.path}`,
                        'Create or open a Sideboard thread worktree to make changes.',
                      ].join('\n'),
                    });
                    onClose();
                  }}
                >
                  <span className="composer-picker-icons">
                    <span className="picker-folder-in" aria-hidden />
                  </span>
                  <span className="composer-picker-main">
                    <span className="composer-picker-title">{group.name}</span>
                    <span className="composer-picker-sub">{group.path}</span>
                  </span>
                </button>
              ) : (
                group.threads.map((t) => {
                  const wtLabel = threadDisplayLabel(t);
                  return (
                  <button
                    key={t.id}
                    type="button"
                    className="composer-picker-row"
                    onClick={() => {
                      onPick({
                        id: crypto.randomUUID(),
                        name: wtLabel,
                        kind: 'workspace',
                        content: [
                          `Linked Sideboard worktree: ${wtLabel}`,
                          `Branch: ${t.branchName}`,
                          `Worktree path (edit here): ${t.worktreePath}`,
                          `Main repo checkout (do not edit app code here): ${t.repoPath}`,
                        ].join('\n'),
                      });
                      onClose();
                    }}
                  >
                    <span className="composer-picker-icons">
                      <span className="picker-folder-in" aria-hidden />
                    </span>
                    <span className="composer-picker-main">
                      <span className="composer-picker-title">{wtLabel}</span>
                      <span className="composer-picker-sub">{t.branchName}</span>
                    </span>
                  </button>
                  );
                })
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
