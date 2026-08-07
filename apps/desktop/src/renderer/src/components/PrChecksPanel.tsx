import type { PrCheckRun } from '@sideboard-ai/core';
import {
  checkStatusLabel,
  formatCheckDuration,
  summarizeChecks,
} from '../lib/pr-format';

interface Props {
  checks: PrCheckRun[] | null;
  error: string | null;
  prUrl: string | null;
  loading: boolean;
  onRefresh: () => void;
  onFixWithAgent: (check: PrCheckRun) => void;
}

export function PrChecksPanel({
  checks,
  error,
  prUrl,
  loading,
  onRefresh,
  onFixWithAgent,
}: Props) {
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
            Open PR checks
          </button>
        )}
      </div>
    );
  }

  if (loading && !checks) {
    return <div className="empty">Loading checks…</div>;
  }

  if (!checks) {
    return (
      <div className="pr-panel">
        <p className="thread-meta">
          {prUrl
            ? 'Could not load CI checks for this PR yet. Try Refresh, or open the PR on GitHub.'
            : 'CI checks will show here once a PR is linked. Create or open a PR for this branch.'}
        </p>
        <div className="pr-panel-actions">
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {prUrl && (
            <button
              type="button"
              className="primary"
              onClick={() => void window.sideboard.openExternal(prUrl)}
            >
              Open PR checks
            </button>
          )}
        </div>
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="pr-panel">
        <p className="thread-meta">No CI checks reported for this PR yet.</p>
        <div className="pr-panel-actions">
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
          {prUrl && (
            <button
              type="button"
              className="primary"
              onClick={() => void window.sideboard.openExternal(prUrl)}
            >
              Open on GitHub
            </button>
          )}
        </div>
      </div>
    );
  }

  const summary = summarizeChecks(checks);

  return (
    <div className="pr-panel fill">
      <div className="pr-panel-header">
        <span className={`pr-check-summary bucket-${summary.failed ? 'fail' : summary.pending ? 'pending' : 'pass'}`}>
          {summary.label}
        </span>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="pr-check-list">
        {checks.map((check) => {
          const duration = formatCheckDuration(check);
          const failed = check.bucket === 'fail';
          return (
            <div
              key={`${check.name}-${check.workflow ?? ''}-${check.link ?? ''}`}
              className={`pr-check-row bucket-${check.bucket}`}
            >
              <span className={`pr-check-icon bucket-${check.bucket}`} aria-hidden>
                {check.bucket === 'pass'
                  ? '✓'
                  : check.bucket === 'fail'
                    ? '✕'
                    : check.bucket === 'pending'
                      ? '●'
                      : '–'}
              </span>
              <div className="pr-check-main">
                <div className="pr-check-name">
                  {check.link ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => void window.sideboard.openExternal(check.link!)}
                    >
                      {check.name}
                    </button>
                  ) : (
                    check.name
                  )}
                </div>
                <div className="pr-check-meta">
                  <span>{checkStatusLabel(check)}</span>
                  {duration && <span>{duration}</span>}
                  {check.workflow && <span>{check.workflow}</span>}
                </div>
                {check.description && (
                  <div className="pr-check-desc">{check.description}</div>
                )}
              </div>
              {failed && (
                <button
                  type="button"
                  className="pr-fix-btn"
                  onClick={() => onFixWithAgent(check)}
                >
                  Fix with Agent
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
