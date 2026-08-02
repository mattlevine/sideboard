import { useEffect, useRef, useState } from 'react';
import type { DiffCommit, DiffScope, DiffScopeStat } from '@sideboard/core';

const SCOPES: Array<{
  id: DiffScope;
  label: string;
  triggerLabel: string;
  icon: 'turn' | 'uncommitted' | 'staged' | 'unstaged' | 'commits';
}> = [
  {
    id: 'last_turn',
    label: 'Last Agent Turn',
    triggerLabel: 'Last Agent Turn',
    icon: 'turn',
  },
  {
    id: 'uncommitted',
    label: 'Uncommitted',
    triggerLabel: 'Uncommitted',
    icon: 'uncommitted',
  },
  {
    id: 'staged',
    label: 'Staged',
    triggerLabel: 'Staged',
    icon: 'staged',
  },
  {
    id: 'unstaged',
    label: 'Unstaged',
    triggerLabel: 'Unstaged',
    icon: 'unstaged',
  },
  {
    id: 'commits',
    label: 'Commits',
    triggerLabel: 'All Commits',
    icon: 'commits',
  },
];

function formatCounts(stat?: DiffScopeStat): { add: string; del: string } | null {
  if (!stat || (stat.additions === 0 && stat.deletions === 0 && stat.files === 0)) {
    return null;
  }
  return {
    add: `+${stat.additions}`,
    del: `-${stat.deletions}`,
  };
}

function ScopeIcon({ kind }: { kind: (typeof SCOPES)[number]['icon'] }) {
  return <span className={`changes-scope-icon ${kind}`} aria-hidden />;
}

interface Props {
  scope: DiffScope;
  commitSha: string | null;
  commits?: DiffCommit[];
  scopeStats?: Record<DiffScope, DiffScopeStat>;
  hasLastTurnBase: boolean;
  onChange: (scope: DiffScope, commitSha?: string | null) => void;
}

export function ChangesScopeMenu({
  scope,
  commitSha,
  commits = [],
  scopeStats,
  hasLastTurnBase,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedCommit = commitSha
    ? commits.find((c) => c.sha === commitSha || c.shortSha === commitSha)
    : null;

  const active = SCOPES.find((s) => s.id === scope) ?? SCOPES[SCOPES.length - 1]!;
  const triggerLabel =
    scope === 'commits' && selectedCommit
      ? selectedCommit.shortSha
      : active.triggerLabel;

  useEffect(() => {
    if (!open) {
      setCommitsOpen(false);
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="changes-scope-menu" ref={ref}>
      <button
        type="button"
        className="changes-scope-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ScopeIcon kind={active.icon} />
        <span className="changes-scope-trigger-label" title={selectedCommit?.subject}>
          {triggerLabel}
        </span>
        <span className="changes-scope-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="changes-scope-dropdown" role="listbox">
          {SCOPES.map((item) => {
            const disabled = item.id === 'last_turn' && !hasLastTurnBase;
            const counts = formatCounts(scopeStats?.[item.id]);
            const selected =
              item.id === scope && (item.id !== 'commits' || !commitSha);
            const isCommits = item.id === 'commits';
            return (
              <div key={item.id} className="changes-scope-row">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  className={`changes-scope-option${selected ? ' selected' : ''}${
                    isCommits && (scope === 'commits' || commitsOpen) ? ' active-group' : ''
                  }`}
                  title={
                    disabled
                      ? 'Run an agent turn to compare against its starting point'
                      : undefined
                  }
                  onClick={() => {
                    if (isCommits) {
                      setCommitsOpen((v) => !v);
                      onChange('commits', null);
                      return;
                    }
                    onChange(item.id, null);
                    setOpen(false);
                  }}
                  onMouseEnter={() => {
                    if (isCommits) setCommitsOpen(true);
                    else setCommitsOpen(false);
                  }}
                >
                  <ScopeIcon kind={item.icon} />
                  <span className="changes-scope-option-label">{item.label}</span>
                  {counts && (
                    <span className="changes-scope-counts">
                      <span className="add">{counts.add}</span>{' '}
                      <span className="del">{counts.del}</span>
                    </span>
                  )}
                  {selected && !isCommits && (
                    <span className="changes-scope-check" aria-hidden>
                      ✓
                    </span>
                  )}
                  {isCommits && (
                    <span className="changes-scope-more" aria-hidden>
                      ›
                    </span>
                  )}
                </button>
                {isCommits && commitsOpen && (
                  <div
                    className="changes-commits-flyout"
                    role="listbox"
                    aria-label="Commits"
                    onMouseEnter={() => setCommitsOpen(true)}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={scope === 'commits' && !commitSha}
                      className={`changes-scope-option${
                        scope === 'commits' && !commitSha ? ' selected' : ''
                      }`}
                      onClick={() => {
                        onChange('commits', null);
                        setOpen(false);
                      }}
                    >
                      <span className="changes-scope-option-label">All Commits</span>
                      {scope === 'commits' && !commitSha && (
                        <span className="changes-scope-check" aria-hidden>
                          ✓
                        </span>
                      )}
                    </button>
                    {commits.length === 0 && (
                      <div className="changes-commits-empty">No commits on branch</div>
                    )}
                    {commits.map((c) => (
                      <button
                        key={c.sha}
                        type="button"
                        role="option"
                        aria-selected={commitSha === c.sha}
                        className={`changes-scope-option commit${
                          commitSha === c.sha ? ' selected' : ''
                        }`}
                        title={c.subject}
                        onClick={() => {
                          onChange('commits', c.sha);
                          setOpen(false);
                        }}
                      >
                        <span className="changes-commit-sha">{c.shortSha}</span>
                        <span className="changes-scope-option-label">{c.subject}</span>
                        <span className="changes-commit-time">{c.relativeTime}</span>
                        {commitSha === c.sha && (
                          <span className="changes-scope-check" aria-hidden>
                            ✓
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
