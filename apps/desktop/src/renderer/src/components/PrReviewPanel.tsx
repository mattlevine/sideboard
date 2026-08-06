import type { PrDetails } from '@sideboard/core';
import { MarkdownMessage } from './MarkdownMessage';
import { formatShortDate } from '../lib/pr-format';

function formatReviewDecision(decision: string | null): string | null {
  if (!decision) return null;
  switch (decision.toUpperCase()) {
    case 'CHANGES_REQUESTED':
      return 'Rejected';
    case 'REVIEW_REQUIRED':
      return 'Review required';
    case 'APPROVED':
      return 'Approved';
    default:
      return decision.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

function formatReviewState(state: string): string {
  switch (state.toUpperCase()) {
    case 'CHANGES_REQUESTED':
      return 'Rejected';
    case 'APPROVED':
      return 'Approved';
    case 'COMMENTED':
      return 'Commented';
    case 'DISMISSED':
      return 'Dismissed';
    case 'PENDING':
      return 'Pending';
    default:
      return state.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

interface Props {
  details: PrDetails | null;
  error: string | null;
  prUrl: string | null;
  loading: boolean;
  onRefresh: () => void;
}

/**
 * PR human-review surface — description + review decision/comments.
 * CI lives in Checks; diffs/commits live in Changes (avoid duplicating those).
 */
export function PrReviewPanel({ details, error, prUrl, loading, onRefresh }: Props) {
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
          Link a pull request to see the description and reviews here.
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
  const decisionLabel = formatReviewDecision(details.reviewDecision);

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
            {decisionLabel ? ` · ${decisionLabel}` : ''}
          </span>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="pr-review-body">
        <section className="pr-review-section">
          <h4 className="pr-review-section-title">Description</h4>
          <div className="pr-description">
            {details.body.trim() ? (
              <MarkdownMessage text={details.body} className="pr-markdown" />
            ) : (
              <div className="empty">No description</div>
            )}
          </div>
        </section>

        <section className="pr-review-section">
          <h4 className="pr-review-section-title">
            Reviews{reviewCount ? ` (${reviewCount})` : ''}
          </h4>
          <div className="pr-review-list">
            {reviewCount === 0 && (
              <div className="empty">No reviews or comments yet</div>
            )}
            {details.reviews.map((r, i) => (
              <div key={`rev-${i}`} className="pr-review-item">
                <div className="pr-review-item-head">
                  <strong>{r.author.login}</strong>
                  <span className="thread-meta">{formatReviewState(r.state)}</span>
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
        </section>
      </div>
    </div>
  );
}
