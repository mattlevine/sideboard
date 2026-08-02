import { useMemo, useState } from 'react';
import type { PrCheckRun, PrDetails } from '@sideboard/core';
import { MarkdownMessage } from './MarkdownMessage';
import { formatShortDate, summarizeChecks } from '../lib/pr-format';
import { PrChecksPanel } from './PrChecksPanel';

type ReviewSubTab = 'description' | 'commits' | 'checks' | 'reviews';

interface Props {
  details: PrDetails | null;
  error: string | null;
  prUrl: string | null;
  loading: boolean;
  onRefresh: () => void;
  onFixWithAgent: (check: PrCheckRun) => void;
}

export function PrReviewPanel({
  details,
  error,
  prUrl,
  loading,
  onRefresh,
  onFixWithAgent,
}: Props) {
  const [sub, setSub] = useState<ReviewSubTab>('description');
  const checkSummary = useMemo(
    () => (details ? summarizeChecks(details.checks) : null),
    [details],
  );

  if (error) {
    return (
      <div className="pr-panel">
        <div className="empty">{error}</div>
        {prUrl && (
          <button
            type="button"
            className="primary"
            onClick={() => void window.sideboard.openExternal(prUrl)}
          >
            Open PR
          </button>
        )}
      </div>
    );
  }

  if (loading && !details) {
    return <div className="empty">Loading review…</div>;
  }

  if (!details) {
    return (
      <div className="pr-panel">
        <p className="thread-meta">
          Link a pull request to see the description, commits, and reviews here.
        </p>
        {prUrl && (
          <button
            type="button"
            className="primary"
            onClick={() => void window.sideboard.openExternal(prUrl)}
          >
            Open PR
          </button>
        )}
      </div>
    );
  }

  const reviewCount = details.reviews.length + details.comments.length;

  return (
    <div className="pr-panel fill">
      <div className="pr-panel-header">
        <div className="pr-review-title">
          <button
            type="button"
            className="linkish"
            onClick={() => void window.sideboard.openExternal(details.url)}
          >
            #{details.number} {details.title}
          </button>
          <span className="thread-meta">
            {details.headRefName} → {details.baseRefName}
            {details.reviewDecision ? ` · ${details.reviewDecision}` : ''}
          </span>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="right-tabs pr-subtabs">
        {(
          [
            ['description', 'Description'],
            ['commits', `Commits (${details.commits.length})`],
            [
              'checks',
              checkSummary?.total
                ? checkSummary.failed > 0 || checkSummary.pending > 0
                  ? `Checks ${checkSummary.label}`
                  : `Checks (${checkSummary.total})`
                : 'Checks',
            ],
            ['reviews', `Reviews (${reviewCount})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={sub === id ? 'active' : ''}
            onClick={() => setSub(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pr-review-body">
        {sub === 'description' && (
          <div className="pr-description">
            {details.body.trim() ? (
              <MarkdownMessage text={details.body} className="pr-markdown" />
            ) : (
              <div className="empty">No description</div>
            )}
          </div>
        )}

        {sub === 'commits' && (
          <div className="pr-commit-list">
            {details.commits.length === 0 && (
              <div className="empty">No commits</div>
            )}
            {details.commits.map((c) => (
              <div key={c.oid} className="pr-commit-row">
                <code className="pr-commit-sha">{c.oid.slice(0, 7)}</code>
                <div className="pr-commit-main">
                  <div className="pr-commit-msg">{c.messageHeadline}</div>
                  <div className="pr-check-meta">
                    <span>
                      {c.authors.map((a) => a.login).join(', ') || 'unknown'}
                    </span>
                    <span>{formatShortDate(c.committedDate)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {sub === 'checks' && (
          <PrChecksPanel
            checks={details.checks}
            error={null}
            prUrl={details.url}
            loading={loading}
            onRefresh={onRefresh}
            onFixWithAgent={onFixWithAgent}
          />
        )}

        {sub === 'reviews' && (
          <div className="pr-review-list">
            {reviewCount === 0 && (
              <div className="empty">No reviews or comments yet</div>
            )}
            {details.reviews.map((r, i) => (
              <div key={`rev-${i}`} className="pr-review-item">
                <div className="pr-review-item-head">
                  <strong>{r.author.login}</strong>
                  <span className="thread-meta">{r.state}</span>
                  <span className="thread-meta">{formatShortDate(r.submittedAt)}</span>
                </div>
                {r.body.trim() ? (
                  <MarkdownMessage text={r.body} className="pr-markdown compact" />
                ) : (
                  <p className="thread-meta">No comment body</p>
                )}
              </div>
            ))}
            {details.comments.map((c, i) => (
              <div key={`cmt-${i}`} className="pr-review-item">
                <div className="pr-review-item-head">
                  <strong>{c.author.login}</strong>
                  <span className="thread-meta">comment</span>
                  <span className="thread-meta">{formatShortDate(c.createdAt)}</span>
                </div>
                <MarkdownMessage text={c.body} className="pr-markdown compact" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
