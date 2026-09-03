import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { PrDetails, ThreadAttachment } from '@sideboard-ai/core';
import {
  prActivityItems,
  prDetailsAttachment,
  preparePrCommentBody,
  relativePrTime,
  reviewStateLabel,
} from '../lib/pr-activity';
import { MarkdownMessage } from './MarkdownMessage';

type Section = 'activity' | 'description';

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
  const [section, setSection] = useState<Section>('activity');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.sideboard
      .getPrDetails(threadId)
      .then((next) => {
        if (cancelled) return;
        setDetails(next);
        if (!next) setError('No pull request linked to this worktree.');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetails(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const activity = useMemo(
    () => (details ? prActivityItems(details) : []),
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
        <div className="pr-page-toolbar">
          <div className="pr-page-sections" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={section === 'activity'}
              className={section === 'activity' ? 'active' : undefined}
              onClick={() => setSection('activity')}
            >
              Activity
              {activity.length > 0 ? (
                <span className="pr-page-count">{activity.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'description'}
              className={section === 'description' ? 'active' : undefined}
              onClick={() => setSection('description')}
            >
              Description
            </button>
          </div>
          {onAddToChat && details ? (
            <button type="button" className="pr-page-add" onClick={addAllToChat}>
              Add all to chat
            </button>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="pr-page-empty">Loading pull request…</div>
      ) : error ? (
        <div className="pr-page-empty">{error}</div>
      ) : section === 'description' ? (
        <div className="pr-page-body">
          {details?.body.trim() ? (
            <PrCommentBody text={details.body} />
          ) : (
            <div className="pr-page-empty">No description.</div>
          )}
        </div>
      ) : activity.length === 0 ? (
        <div className="pr-page-empty">No comments or reviews yet.</div>
      ) : (
        <div className="pr-page-activity">
          {activity.map((item) => (
            <article key={item.id} className="pr-page-item">
              <header className="pr-page-item-meta">
                <span className="pr-page-author">{item.author}</span>
                {item.kind === 'review' ? (
                  <span className="pr-page-kind">{reviewStateLabel(item.reviewState)}</span>
                ) : null}
                {item.at ? (
                  <time dateTime={item.at}>{relativePrTime(item.at)}</time>
                ) : null}
              </header>
              {item.body.trim() ? (
                <div className="pr-page-item-body">
                  <PrCommentBody text={item.body} />
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
