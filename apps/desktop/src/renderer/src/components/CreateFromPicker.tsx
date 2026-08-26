import { useEffect, useMemo, useState } from 'react';
import { issueSourceLabel } from '@sideboard/issue-source-labels';
import type { BranchInfo, IssueInfo, IssueSource, PrInfo } from '@sideboard-ai/core';
import { defaultTicketScope, issueInTicketScope, type TicketScope } from '../lib/home-board';

export type CreateFromTab = 'prs' | 'branches' | 'issues';

export type CreateFromSelection =
  | { kind: 'branch'; ref: string; title?: string }
  | { kind: 'pr'; ref: string; title: string; url?: string; headRefName?: string; author?: string }
  | {
      kind: 'ticket';
      ref: string;
      title: string;
      url?: string;
      labels?: string[];
      provider?: IssueInfo['provider'];
      assignee?: string;
      cycle?: string;
    };

interface Props {
  open: boolean;
  repoPath: string;
  linearConnected: boolean;
  hasSelection?: boolean;
  onClose: () => void;
  onSelect: (selection: CreateFromSelection) => void;
  onClear?: () => void;
  onOpenAccount?: () => void;
}

export function CreateFromPicker({
  open,
  repoPath,
  linearConnected,
  hasSelection = false,
  onClose,
  onSelect,
  onClear,
  onOpenAccount,
}: Props) {
  const [tab, setTab] = useState<CreateFromTab>('prs');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prs, setPrs] = useState<PrInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [issues, setIssues] = useState<IssueInfo[]>([]);
  const [issueSource, setIssueSource] = useState<IssueSource>('github');
  const [preferredSource, setPreferredSource] = useState<IssueSource>('github');
  const [linearOk, setLinearOk] = useState(linearConnected);
  const [ticketScope, setTicketScope] = useState<TicketScope>('cycle');
  const [viewerLogin, setViewerLogin] = useState('');

  useEffect(() => {
    if (!open || !repoPath) return;
    let cancelled = false;
    setQuery('');
    setError(null);
    setLoading(true);
    setPrs([]);
    setBranches([]);
    setIssues([]);
    void (async () => {
      try {
        if (tab === 'prs') {
          const list = await window.sideboard.listPrs(repoPath);
          if (!cancelled) setPrs(list);
        } else if (tab === 'branches') {
          const list = await window.sideboard.listBranches(repoPath, {
            unmergedOnly: true,
          });
          if (!cancelled) {
            setBranches(list.filter((b) => !b.name.startsWith('thread/')));
          }
        } else {
          const result = await window.sideboard.listIssues(repoPath);
          if (!cancelled) {
            setIssues(result.issues);
            setIssueSource(result.source);
            setPreferredSource(result.preferredSource);
            setLinearOk(result.linearConnected);
            setViewerLogin(result.viewer?.login || result.viewer?.name || '');
            setTicketScope(defaultTicketScope(result.source));
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        if (tab === 'prs') setPrs([]);
        else if (tab === 'branches') setBranches([]);
        else setIssues([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, repoPath, tab]);

  const q = query.trim().toLowerCase();

  const filteredPrs = useMemo(() => {
    if (!q) return prs;
    return prs.filter(
      (p) =>
        String(p.number).includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.headRefName.toLowerCase().includes(q),
    );
  }, [prs, q]);

  const filteredBranches = useMemo(() => {
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, q]);

  const scopedIssues = useMemo(
    () => issues.filter((i) => issueInTicketScope(i, ticketScope, viewerLogin)),
    [issues, ticketScope, viewerLogin],
  );

  const filteredIssues = useMemo(() => {
    if (!q) return scopedIssues;
    return scopedIssues.filter(
      (i) =>
        i.identifier.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [scopedIssues, q]);

  if (!open) return null;

  const placeholder =
    tab === 'prs'
      ? 'Search by title, number, or author'
      : tab === 'branches'
        ? 'Search by name'
        : 'Search by title, identifier, or label';

  const showLinearSetup =
    tab === 'issues' && preferredSource === 'linear' && !linearOk;

  return (
    <div
      className="composer-picker-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="composer-picker create-from-picker"
        role="dialog"
        aria-label="Create from"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="composer-picker-search"
          autoFocus
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        {repoPath ? (
          <div className="composer-picker-section-label" title={repoPath}>
            {repoPath.split('/').filter(Boolean).pop() || repoPath}
          </div>
        ) : null}
        <div className="create-from-tabs">
          {([
            { id: 'prs' as const, label: 'PRs' },
            { id: 'branches' as const, label: 'Branches' },
            { id: 'issues' as const, label: 'Issues' },
          ]).map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <div className="composer-picker-empty">Loading…</div>}
        {error && !loading && <div className="composer-picker-empty">{error}</div>}

        {!loading && hasSelection && onClear ? (
          <div className="composer-picker-section">
            <button
              type="button"
              className="composer-picker-row"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              <span className="composer-picker-icons">×</span>
              <span className="composer-picker-main">
                <span className="composer-picker-title">Clear selection</span>
                <span className="composer-picker-sub">
                  Start from the default branch
                </span>
              </span>
            </button>
          </div>
        ) : null}

        {!loading && !error && tab === 'prs' && (
          <div className="composer-picker-section">
            {filteredPrs.length === 0 ? (
              <div className="composer-picker-empty">No open PRs</div>
            ) : (
              filteredPrs.slice(0, 50).map((p) => (
                <button
                  key={p.number}
                  type="button"
                  className="composer-picker-row"
                  onClick={() => {
                    onSelect({
                      kind: 'pr',
                      ref: String(p.number),
                      title: p.title,
                      url: p.url,
                      headRefName: p.headRefName,
                      author: p.author?.login,
                    });
                    onClose();
                  }}
                >
                  <span className="composer-picker-icons">
                    <span className="picker-logo github" aria-hidden />
                  </span>
                  <span className="composer-picker-main">
                    <span className="composer-picker-title">
                      #{p.number} {p.title}
                    </span>
                    <span className="composer-picker-sub">{p.headRefName}</span>
                  </span>
                  <span className="composer-picker-hint">
                    Select <kbd>↵</kbd>
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && !error && tab === 'branches' && (
          <div className="composer-picker-section">
            <button
              type="button"
              className="composer-picker-row"
              onClick={() => {
                onSelect({ kind: 'branch', ref: 'default', title: 'default branch' });
                onClose();
              }}
            >
              <span className="composer-picker-icons">⎇</span>
              <span className="composer-picker-main">
                <span className="composer-picker-title">default branch</span>
              </span>
              <span className="composer-picker-hint">
                Select <kbd>↵</kbd>
              </span>
            </button>
            {filteredBranches.slice(0, 50).map((b) => (
              <button
                key={b.name}
                type="button"
                className="composer-picker-row"
                onClick={() => {
                  onSelect({ kind: 'branch', ref: b.name });
                  onClose();
                }}
              >
                <span className="composer-picker-icons">⎇</span>
                <span className="composer-picker-main">
                  <span className="composer-picker-title">
                    {b.current ? '* ' : ''}
                    {b.name}
                  </span>
                </span>
                <span className="composer-picker-hint">
                  Select <kbd>↵</kbd>
                </span>
              </button>
            ))}
          </div>
        )}

        {!loading && !error && tab === 'issues' && (
          <>
            <div className="create-from-tabs" role="group" aria-label="Issue scope">
              {issueSource === 'linear' ? (
                <>
                  <button
                    type="button"
                    className={ticketScope === 'cycle' ? 'active' : ''}
                    onClick={() => setTicketScope('cycle')}
                  >
                    This cycle
                  </button>
                  <button
                    type="button"
                    className={ticketScope === 'assigned' ? 'active' : ''}
                    onClick={() => setTicketScope('assigned')}
                  >
                    All assigned
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={ticketScope === 'all' ? 'active' : ''}
                    onClick={() => setTicketScope('all')}
                  >
                    All open
                  </button>
                  <button
                    type="button"
                    className={ticketScope === 'assigned' || ticketScope === 'cycle' ? 'active' : ''}
                    onClick={() => setTicketScope('assigned')}
                  >
                    Assigned to me
                  </button>
                </>
              )}
            </div>
            {showLinearSetup && (
              <div className="composer-picker-section">
                <div className="composer-picker-section-label">Setup</div>
                <button
                  type="button"
                  className="composer-picker-row"
                  onClick={() => {
                    onOpenAccount?.();
                    onClose();
                  }}
                >
                  <span className="composer-picker-icons">
                    <span className="picker-logo linear" aria-hidden />
                  </span>
                  <span className="composer-picker-main">
                    <span className="composer-picker-title">Set up Linear</span>
                    <span className="composer-picker-sub">
                      Showing GitHub Issues until Linear is connected
                    </span>
                  </span>
                  <span className="composer-picker-hint">
                    Open <kbd>↵</kbd>
                  </span>
                </button>
              </div>
            )}
            <div className="composer-picker-section">
              {filteredIssues.length === 0 ? (
                <div className="composer-picker-empty">
                  No {issueSourceLabel(issueSource)} issues
                </div>
              ) : (
                filteredIssues.slice(0, 50).map((issue) => (
                  <button
                    key={issue.id || issue.identifier}
                    type="button"
                    className="composer-picker-row"
                    onClick={() => {
                      onSelect({
                        kind: 'ticket',
                        ref: issue.identifier,
                        title: issue.title,
                        url: issue.url,
                        labels: issue.labels,
                        provider: issue.provider,
                        assignee: issue.assignee,
                        cycle: issue.cycle?.name,
                      });
                      onClose();
                    }}
                  >
                    <span className="composer-picker-icons">
                      <span
                        className={`picker-logo ${issue.provider ?? issueSource}`}
                        aria-hidden
                      />
                    </span>
                    <span className="composer-picker-main">
                      <span className="composer-picker-title">
                        {issue.identifier} {issue.title}
                      </span>
                    </span>
                    <span className="composer-picker-hint">
                      Select <kbd>↵</kbd>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
