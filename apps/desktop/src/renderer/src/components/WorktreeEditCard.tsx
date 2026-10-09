import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { latestVisibleMessageText } from '@sideboard/home-board';
import type { Thread } from '@sideboard-ai/core';
import { hidesLastErrorPreview } from '../lib/pane-progress';
import {
  followThreadPrMeta,
  sidebarPrHasKnownStatus,
  type SidebarPrMeta,
} from '../lib/follow-thread-pr';
import { classifyMergeIssue, prPillModifier, prPillStatusLabel } from '../lib/pr-format';
import { billedUsageLabel, sumUsage, usageTooltip } from '../lib/tokens';
import { useShowCost } from '../lib/show-cost';

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function prNumberFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/pull\/(\d+)/);
  return m?.[1] ?? null;
}

function hoverPrFromIpc(meta: {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  title?: string;
  reviewDecision: string | null;
  isInMergeQueue?: boolean;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  baseRefName?: string;
}): SidebarPrMeta {
  return {
    number: meta.number,
    url: meta.url,
    state: meta.state,
    isDraft: meta.isDraft,
    title: meta.title ?? '',
    reviewDecision: meta.reviewDecision,
    isInMergeQueue: Boolean(meta.isInMergeQueue),
    mergeable: meta.mergeable ?? null,
    mergeStateStatus: meta.mergeStateStatus ?? null,
    baseRefName: meta.baseRefName ?? '',
  };
}

function hoverPillOpts(prMeta: SidebarPrMeta | null) {
  const prState = (prMeta?.state ?? '').toUpperCase();
  const prMerged = prState === 'MERGED';
  const prClosed = prState === 'CLOSED';
  const prIsOpen = Boolean(prMeta) && !prMerged && !prClosed;
  const prDraft = Boolean(prMeta?.isDraft) && prIsOpen;
  const inMergeQueue = prIsOpen && Boolean(prMeta?.isInMergeQueue);
  const mergeIssue = classifyMergeIssue({
    mergeable: prMeta?.mergeable,
    mergeStateStatus: prMeta?.mergeStateStatus,
    inMergeQueue,
  });
  return {
    merged: prMerged,
    closed: prClosed,
    draft: prDraft,
    reviewDecision: prIsOpen && !prDraft ? (prMeta?.reviewDecision ?? null) : null,
    inMergeQueue,
    mergeConflicts: mergeIssue === 'conflicts',
    branchBehind: mergeIssue === 'behind',
    baseRefName: prMeta?.baseRefName,
  };
}

function worktreeSlug(thread: Thread): string {
  const base = thread.worktreePath.replace(/\/$/, '').split('/').pop();
  return base || thread.branchName.replace(/^thread\//, '') || 'workspace';
}

function previewSnippet(thread: Thread): string {
  if (
    thread.lastError?.trim() &&
    thread.status !== 'running' &&
    thread.status !== 'queued' &&
    !hidesLastErrorPreview(thread.lastError, thread.messages.length)
  ) {
    return thread.lastError.trim();
  }
  const last = latestVisibleMessageText(thread.messages);
  if (last) {
    const t = last.replace(/\s+/g, ' ');
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }
  if (thread.branchName?.trim()) return thread.branchName;
  return '';
}

function groupSpendLabel(
  threads: Thread[],
  showCost: boolean,
): { label: string; tooltip: string } | null {
  const usage = sumUsage(threads.flatMap((t) => t.messages.map((m) => m.usage)));
  if (!usage) return null;
  const chatNote =
    threads.length > 1 ? ` across ${threads.length} open chats` : '';
  return {
    label: billedUsageLabel(usage, showCost),
    tooltip: `Open chats${chatNote} — ${usageTooltip(usage, { showCost })}`,
  };
}

export function WorktreeEditCard({
  open,
  anchorRef,
  thread,
  group,
  label,
  dirty,
  loaded,
  additions,
  deletions,
  onOpen,
  onKeepOpen,
  onOpenPr,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  thread: Thread;
  group: Thread[];
  label: string;
  dirty: boolean;
  loaded: boolean;
  additions: number;
  deletions: number;
  onOpen: () => void;
  onKeepOpen: (v: boolean) => void;
  onOpenPr?: () => void;
}) {
  const showCost = useShowCost();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prMeta, setPrMeta] = useState<SidebarPrMeta | null>(null);
  const slug = worktreeSlug(thread);
  const prUrl = prMeta?.url ?? thread.prUrl ?? null;
  const prNum =
    prMeta?.number != null && prMeta.number > 0
      ? String(prMeta.number)
      : prNumberFromUrl(prUrl ?? thread.prUrl);
  const preview = previewSnippet(thread);
  const spend = groupSpendLabel(group, showCost);
  const ok =
    thread.status === 'idle' ||
    thread.status === 'stopped' ||
    thread.status === 'archived';

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = 320;
      let left = rect.right + 10;
      if (left + width > window.innerWidth - 12) {
        left = Math.max(12, rect.left - width - 10);
      }
      let top = rect.top - 8;
      if (top + 200 > window.innerHeight - 12) {
        top = Math.max(12, window.innerHeight - 212);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, thread.id]);

  useEffect(() => {
    setPrMeta((prev) => followThreadPrMeta(prev, thread));
  }, [
    thread.prUrl,
    thread.prState,
    thread.prIsDraft,
    thread.prTitle,
    thread.prReviewDecision,
    thread.prMergeable,
    thread.prMergeStateStatus,
    thread.prIsInMergeQueue,
  ]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const meta = await window.sideboard.getPrMeta(thread.id);
        if (cancelled) return;
        if (!meta) {
          setPrMeta(null);
          return;
        }
        setPrMeta(hoverPrFromIpc(meta));
      } catch {
        if (!cancelled) setPrMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, thread.id, thread.prUrl, thread.branchName, thread.prState, thread.prIsDraft]);

  async function createPr() {
    if (prBusy) return;
    setPrBusy(true);
    try {
      await window.sideboard.sendToThread(
        thread.id,
        'Commit, push, and open a draft PR.',
      );
      onKeepOpen(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPrBusy(false);
    }
  }

  if (!open || !pos) return null;

  const gitLabel = !loaded
    ? '…'
    : dirty
      ? `+${additions} −${deletions}`
      : 'clean';

  const pillOpts = hoverPillOpts(prMeta);
  const prStatusLabel = sidebarPrHasKnownStatus(prMeta)
    ? prPillStatusLabel(pillOpts)
    : null;
  const prStatusMod = sidebarPrHasKnownStatus(prMeta)
    ? prPillModifier(pillOpts)
    : '';

  return createPortal(
    <div
      className="worktree-hover-card"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Open ${label}`}
      onMouseEnter={() => onKeepOpen(true)}
      onMouseLeave={() => onKeepOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="worktree-hover-card-top">
        <span className="worktree-hover-card-slug">{slug}</span>
        <span
          className={`worktree-hover-card-git${dirty ? ' is-dirty' : ''}${loaded ? '' : ' is-loading'}`}
          title={
            dirty
              ? `Uncommitted +${additions} −${deletions}`
              : loaded
                ? 'Working tree clean'
                : 'Loading git status…'
          }
          aria-label={
            dirty
              ? `Uncommitted +${additions} −${deletions}`
              : loaded
                ? 'Working tree clean'
                : 'Loading git status'
          }
        >
          {dirty && loaded ? (
            <>
              <span className="add">+{additions}</span>
              <span className="del">−{deletions}</span>
            </>
          ) : (
            gitLabel
          )}
        </span>
        <span
          className={`worktree-hover-card-status${ok ? ' ok' : ''}${dirty ? ' dirty' : ''}`}
          title={thread.status}
          aria-label={thread.status}
        >
          {ok && !dirty ? '✓' : '●'}
        </span>
      </div>
      <button
        type="button"
        className="worktree-hover-card-title"
        title={label}
        onClick={onOpen}
      >
        {label}
      </button>
      {preview ? (
        <p className="worktree-hover-card-preview">{preview}</p>
      ) : null}
      <div className="worktree-hover-card-footer">
        {prNum ? (
          <button
            type="button"
            className={`worktree-hover-card-btn${prStatusMod ? ` ${prStatusMod}` : ''}`}
            title={
              prStatusLabel
                ? `Open #${prNum} · ${prStatusLabel}`
                : `Open #${prNum}`
            }
            onClick={() => {
              onKeepOpen(false);
              if (onOpenPr) onOpenPr();
              else onOpen();
            }}
          >
            <span aria-hidden>⎇</span>
            #{prNum}
            {prStatusLabel ? (
              <span className="worktree-hover-card-btn-status">{prStatusLabel}</span>
            ) : null}
          </button>
        ) : (
          <button
            type="button"
            className="worktree-hover-card-btn"
            disabled={prBusy}
            onClick={() => void createPr()}
          >
            <span aria-hidden>⎇</span>
            {prBusy ? 'Creating…' : 'Create PR'}
          </button>
        )}
        <div className="worktree-hover-card-meta">
          {spend ? (
            <span className="worktree-hover-card-usage" title={spend.tooltip}>
              {spend.label}
            </span>
          ) : null}
          <span className="worktree-hover-card-age">
            {relativeTime(thread.updatedAt)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
