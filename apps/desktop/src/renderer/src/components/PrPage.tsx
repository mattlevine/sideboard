import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { PrDetails, ThreadAttachment } from '@sideboard-ai/core';
import {
  prConversationItems,
  prDetailsAttachment,
  prDetailsReviewerList,
  preparePrCommentBody,
  relativePrTime,
  reviewStateLabel,
  shortPrOid,
  uniquePrLogins,
} from '../lib/pr-activity';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  threadId: string;
  onAddToChat?: (attachment: ThreadAttachment) => void;
}

function openHtmlLink(e: MouseEvent<HTMLElement>) {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (!anchor?.href) return;
  e.preventDefault();
  e.stopPropagation();
  void window.sideboard.openExternal(anchor.href);
}

function PrCommentBody({ text }: { text: string }) {
  const prepared = preparePrCommentBody(text);
  if (prepared.mode === 'html') {
    return (
      <div
        className="pr-page-html md"
        dangerouslySetInnerHTML={{ __html: prepared.html }}
        onClick={openHtmlLink}
      />
    );
  }
  return <MarkdownMessage text={prepared.text} className="md" expandImages={false} />;
}

export function PrPage({ threadId, onAddToChat }: Props) {
  const [details, setDetails] = useState<PrDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadGen = useRef(0);
  const detailsRef = useRef<PrDetails | null>(null);
  detailsRef.current = details;

  const loadDetails = useCallback(() => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    void window.sideboard
      .getPrDetails(threadId)
      .then((next) => {
        if (gen !== loadGen.current) return;
        setDetails(next);
        if (!next) setError('No pull request linked to this worktree.');
      })
      .catch((err: unknown) => {
        if (gen !== loadGen.current) return;
        if (detailsRef.current) return;
        setDetails(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (gen === loadGen.current) setLoading(false);
      });
  }, [threadId]);

  useEffect(() => {
    loadDetails();
    return () => {
      loadGen.current += 1;
    };
  }, [loadDetails]);

  const conversation = useMemo(
    () => (details ? prConversationItems(details) : []),
    [details],
  );
  const assignees = useMemo(
    () => (details ? uniquePrLogins(details.assignees) : []),
    [details],
  );
  const reviewers = useMemo(
    () => (details ? prDetailsReviewerList(details) : []),
    [details],
  );
  const labels = useMemo(
    () => (details ? uniquePrLogins(details.labels) : []),
    [details],
  );

  function addAllToChat() {
    if (!details || !onAddToChat) return;
    onAddToChat(prDetailsAttachment(details));
  }

  return (
    <div className="pr-page">
      <header className="pr-page-header">
        <div className="pr-page-title-row">
          <h2 className="pr-page-title">
            {details?.title || (loading ? 'Loading pull request…' : 'Pull request')}
            {details ? <span className="pr-page-number"> #{details.number}</span> : null}
          </h2>
          {details ? (
            <span className="pr-page-diff" aria-label="Diff stats">
              <span className="add">+{details.additions}</span>
              <span className="del">−{details.deletions}</span>
            </span>
          ) : null}
          {details?.url ? (
            <button
              type="button"
              className="pr-page-open"
              title="Open on GitHub"
              onClick={() => void window.sideboard.openExternal(details.url)}
            >
              ↗
            </button>
          ) : null}
        </div>
        {details ? (
          <dl className="pr-page-meta">
            <div className="pr-page-meta-item">
              <dt>Assignees</dt>
              <dd>{assignees.length ? assignees.join(', ') : 'None'}</dd>
            </div>
            <div className="pr-page-meta-item">
              <dt>Reviewers</dt>
              <dd>{reviewers.length ? reviewers.join(', ') : 'None'}</dd>
            </div>
            <div className="pr-page-meta-item">
              <dt>Labels</dt>
              <dd className="pr-page-tags">
                {labels.length ? (
                  labels.map((label) => (
                    <span key={label} className="pr-page-tag">
                      {label}
                    </span>
                  ))
                ) : (
                  <span>None</span>
                )}
              </dd>
            </div>
          </dl>
        ) : null}
        <div className="pr-page-toolbar">
          <div className="pr-page-actions">
            <button
              type="button"
              className="pr-page-add"
              disabled={loading}
              title="Reload pull request description, comments, and commits"
              onClick={() => loadDetails()}
            >
              {loading && details ? 'Refreshing…' : 'Refresh'}
            </button>
            {onAddToChat && details ? (
              <button type="button" className="pr-page-add" onClick={addAllToChat}>
                Add all to chat
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {loading && !details ? (
        <div className="pr-page-empty">Loading pull request…</div>
      ) : error && !details ? (
        <div className="pr-page-empty">{error}</div>
      ) : conversation.length === 0 ? (
        <div className="pr-page-empty">No description, comments, or commits yet.</div>
      ) : (
        <div className="pr-page-activity">
          {conversation.map((item) => {
            const sha = item.kind === 'commit' ? shortPrOid(item.oid) : '';
            return (
              <article
                key={item.id}
                className={`pr-page-item${item.kind === 'description' ? ' is-description' : ''}${item.kind === 'commit' ? ' is-commit' : ''}`}
              >
                <header className="pr-page-item-meta">
                  <span className="pr-page-author">{item.author}</span>
                  {item.kind === 'review' ? (
                    <span className="pr-page-kind">{reviewStateLabel(item.reviewState)}</span>
                  ) : item.kind === 'description' ? (
                    <span className="pr-page-kind">commented</span>
                  ) : item.kind === 'commit' ? (
                    <>
                      <span className="pr-page-kind">committed</span>
                      {sha ? (
                        item.url ? (
                          <a
                            className="pr-commit-sha pr-commit-link"
                            href={item.url}
                            title="Open commit on GitHub"
                            onClick={openHtmlLink}
                          >
                            {sha}
                          </a>
                        ) : (
                          <code className="pr-commit-sha">{sha}</code>
                        )
                      ) : null}
                    </>
                  ) : null}
                  {item.at ? (
                    <time dateTime={item.at}>{relativePrTime(item.at)}</time>
                  ) : null}
                </header>
                {item.body.trim() ? (
                  <div className="pr-page-item-body">
                    {item.kind === 'commit' ? (
                      item.url ? (
                        <a
                          className="pr-commit-msg pr-commit-link"
                          href={item.url}
                          title="Open commit on GitHub"
                          onClick={openHtmlLink}
                        >
                          {item.body.trim()}
                        </a>
                      ) : (
                        <div className="pr-commit-msg">{item.body.trim()}</div>
                      )
                    ) : (
                      <PrCommentBody text={item.body} />
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
