import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  normalizeWorktreePath,
  threadDisplayLabel,
  worktreeDisplayLabelForGroup,
} from '@sideboard/worktree-labels';
import type { SlackReplyBadge, Thread } from '@sideboard-ai/core';
import {
  GLOBAL_WORKSPACE_ID,
  threadDisplayTitle,
} from '../lib/global-workspace';
import { closeChatTabMessage } from '../lib/close-chat-tab';
import { classifyMergeIssue, prPillModifier, prPillStatusLabel } from '../lib/pr-format';
import {
  isWorktreeUnread,
  latestAgentResponseAt,
  unreadWorktreeKey,
} from '../lib/unread-worktrees';
import { useCaffeinateHold } from '../lib/caffeinate-tab';
import {
  formatCostSuffix,
  formatTokenCount,
  sumUsage,
  totalTokens,
  usageTooltip,
} from '../lib/tokens';
import { useShowCost } from '../lib/show-cost';
import { BrandMark } from './BrandMark';
import { CaffeinateBadge } from './CaffeinateBadge';
import { SidebarToggle } from './SidebarToggle';
import { ThreadStatusIcon } from './ThreadStatusIcon';

interface Props {
  threads: Thread[];
  selectedId: string | null;
  view: 'board' | 'thread';
  multiSelected: Set<string>;
  repoPath: string;
  /** Registered workspaces (show even with zero threads). */
  workspaces?: Array<{ path: string; name: string }>;
  onShowBoard: () => void;
  onSelect: (id: string, multi: boolean) => void;
  onNew: (repoPath?: string, mode?: 'quick' | 'orchestration') => void;
  onPickRepo: () => void;
  onArchive?: (
    threadIds: string[],
    meta: { title: string; removesWorktree: boolean },
  ) => void | Promise<void>;
  /** Thread ids currently being archived (shows progress on those worktree rows). */
  archivingIds?: Set<string>;
  /** Unregister a project workspace (caller archives threads as needed). */
  onRemoveWorkspace?: (repoPath: string) => void | Promise<void>;
  onToggleSidebar: () => void;
  onOpenSettings?: () => void;
  /** Other people who replied to a Slack message this Mac posted. */
  slackReplies?: SlackReplyBadge[];
  onOpenSlackReply?: (badgeId: string) => void;
}

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

/** Paths that should never appear as a project row (e.g. packaged-app cwd `/`). */
function isProjectPath(path: string): boolean {
  if (!path || path === GLOBAL_WORKSPACE_ID) return false;
  if (path === '/' || path === '.') return false;
  return true;
}

function groupByWorktree(threads: Thread[]): Thread[][] {
  const map = new Map<string, Thread[]>();
  for (const t of threads) {
    const key = normalizeWorktreePath(t.worktreePath);
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return [...map.values()].map((list) =>
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

type WorktreeDiffStat = { additions: number; deletions: number; dirty: boolean };

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

type HoverPrMeta = {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  isInMergeQueue: boolean;
  mergeable: string | null;
  mergeStateStatus: string | null;
  baseRefName: string;
};

function hoverPrFromIpc(meta: {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string | null;
  isInMergeQueue?: boolean;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  baseRefName?: string;
}): HoverPrMeta {
  return {
    number: meta.number,
    url: meta.url,
    state: meta.state,
    isDraft: meta.isDraft,
    reviewDecision: meta.reviewDecision,
    isInMergeQueue: Boolean(meta.isInMergeQueue),
    mergeable: meta.mergeable ?? null,
    mergeStateStatus: meta.mergeStateStatus ?? null,
    baseRefName: meta.baseRefName ?? '',
  };
}

function hoverPillOpts(prMeta: HoverPrMeta | null) {
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
  if (thread.lastError?.trim()) return thread.lastError.trim();
  const last = [...thread.messages].reverse().find(
    (m) => m.role === 'agent' || m.role === 'user',
  );
  if (last?.text?.trim()) {
    const t = last.text.trim().replace(/\s+/g, ' ');
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }
  if (thread.branchName?.trim()) return thread.branchName;
  return '';
}

/** Billed totals across every open chat tab on this worktree (or orchestration group). */
function groupSpendLabel(
  threads: Thread[],
  showCost: boolean,
): { label: string; tooltip: string } | null {
  const usage = sumUsage(threads.flatMap((t) => t.messages.map((m) => m.usage)));
  if (!usage) return null;
  const toks = formatTokenCount(totalTokens(usage));
  const chatNote =
    threads.length > 1 ? ` across ${threads.length} open chats` : '';
  return {
    label: `${toks} tok${formatCostSuffix(usage.costUsd, showCost)}`,
    tooltip: `Open chats${chatNote} — ${usageTooltip(usage, { showCost })}`,
  };
}

function WorktreeEditCard({
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
}) {
  const showCost = useShowCost();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prMeta, setPrMeta] = useState<HoverPrMeta | null>(null);
  const slug = worktreeSlug(thread);
  const prUrl = prMeta?.url ?? thread.prUrl ?? null;
  const prNum =
    prMeta?.number != null
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

  // Fetch live PR lifecycle (draft / open / merged / review) when the card opens.
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
  }, [open, thread.id, thread.prUrl]);

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
  // Only show a status pill once GitHub PR meta is loaded — never invent "Open".
  const prStatusLabel = prMeta ? prPillStatusLabel(pillOpts) : null;
  const prStatusMod = prMeta ? prPillModifier(pillOpts) : '';

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
        {prMeta && prNum ? (
          <button
            type="button"
            className={`worktree-hover-card-btn${prStatusMod ? ` ${prStatusMod}` : ''}`}
            title={
              prStatusLabel
                ? `${prNum ? `#${prNum}` : 'PR'} · ${prStatusLabel}`
                : (prUrl ?? undefined)
            }
            onClick={() => {
              if (prUrl) void window.sideboard.openExternal(prUrl);
            }}
          >
            <span aria-hidden>⎇</span>
            #{prNum} ↗
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

function WorktreeSidebarRow({
  primary,
  group,
  worktreeLabel,
  active,
  selected,
  archiving,
  unread,
  onSelect,
  showArchive,
  onRequestArchive,
}: {
  primary: Thread;
  group: Thread[];
  worktreeLabel: string;
  active: boolean;
  selected: boolean;
  archiving: boolean;
  unread: boolean;
  onSelect: (id: string, multi: boolean) => void;
  /** When true, show the archive control (parent handles confirm + teardown). */
  showArchive?: boolean;
  onRequestArchive: (chats: Thread[]) => void;
}) {
  const [gitCardOpen, setGitCardOpenState] = useState(false);
  const [stat, setStat] = useState<WorktreeDiffStat | null>(null);
  const [loaded, setLoaded] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const gitCloseTimer = useRef<number | null>(null);
  const fetchGen = useRef(0);

  function clearTimer(ref: { current: number | null }) {
    if (ref.current != null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }

  function setGitCardOpen(next: boolean) {
    clearTimer(gitCloseTimer);
    if (next) {
      setGitCardOpenState(true);
      return;
    }
    gitCloseTimer.current = window.setTimeout(() => {
      setGitCardOpenState(false);
      gitCloseTimer.current = null;
    }, 120);
  }

  useEffect(() => {
    return () => {
      clearTimer(gitCloseTimer);
    };
  }, []);

  // Load git dirty for the row glyph; refresh when the turn ends or on a slow poll.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const gen = ++fetchGen.current;
      try {
        const diff = await window.sideboard.getDiff(primary.id, {
          scope: 'uncommitted',
          includePatches: false,
        });
        if (cancelled || gen !== fetchGen.current) return;
        const s = diff.scopeStats?.uncommitted;
        setStat({
          additions: s?.additions ?? 0,
          deletions: s?.deletions ?? 0,
          dirty: Boolean(diff.dirty) || (s != null && (s.additions > 0 || s.deletions > 0)),
        });
        setLoaded(true);
      } catch {
        if (cancelled || gen !== fetchGen.current) return;
        setStat({ additions: 0, deletions: 0, dirty: false });
        setLoaded(true);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [primary.id, primary.status, primary.worktreePath]);

  const dirty = loaded && Boolean(stat?.dirty);

  function requestArchive() {
    void window.sideboard
      .listWorktreeChats(primary.id)
      .then(onRequestArchive)
      .catch(alert);
  }

  return (
    <div
      ref={rowRef}
      className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}${archiving ? ' archiving' : ''}${unread ? ' unread' : ''}`}
      aria-busy={archiving}
      onMouseEnter={() => {
        setGitCardOpen(true);
      }}
      onMouseLeave={() => {
        setGitCardOpen(false);
      }}
      onClick={(e) => {
        if (archiving) return;
        onSelect(primary.id, e.metaKey || e.ctrlKey || e.shiftKey);
      }}
    >
      {archiving ? (
        <span className="thread-archive-spinner" aria-hidden />
      ) : (
        <ThreadStatusIcon
          status={primary.status}
          dirty={dirty}
          dirtyLoaded={loaded}
          additions={stat?.additions ?? 0}
          deletions={stat?.deletions ?? 0}
          unread={unread}
        />
      )}
      <div className="thread-item-body">
        <div
          className="thread-title"
          title={
            primary.sourceType === 'orchestration'
              ? `${worktreeLabel} ✦`
              : worktreeLabel
          }
        >
          {worktreeLabel}
          {primary.sourceType === 'orchestration' ? ' ✦' : ''}
          {primary.cowboy ? <span className="board-badge">cowboy</span> : null}
        </div>
        <div className="thread-meta">
          {archiving
            ? 'Archiving…'
            : [
                primary.agent,
                group.length > 1 ? `${group.length} chats` : null,
                primary.devPort ? `:${primary.devPort}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </div>
      </div>
      {!archiving && showArchive ? (
        <div
          className="worktree-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="icon-btn worktree-remove-btn"
            aria-label={`Archive ${worktreeLabel}`}
            title="Archive"
            onClick={requestArchive}
          >
            ▤
          </button>
        </div>
      ) : null}
      {!archiving ? (
        <WorktreeEditCard
          open={gitCardOpen}
          anchorRef={rowRef}
          thread={primary}
          group={group}
          label={worktreeLabel}
          dirty={dirty}
          loaded={loaded}
          additions={stat?.additions ?? 0}
          deletions={stat?.deletions ?? 0}
          onOpen={() => {
            setGitCardOpen(false);
            onSelect(primary.id, false);
          }}
          onKeepOpen={setGitCardOpen}
        />
      ) : null}
    </div>
  );
}

export function Sidebar({
  threads,
  selectedId,
  view,
  multiSelected,
  repoPath,
  workspaces = [],
  onShowBoard,
  onSelect,
  onNew,
  onPickRepo,
  onArchive,
  archivingIds = new Set(),
  onRemoveWorkspace,
  onToggleSidebar,
  onOpenSettings,
  slackReplies = [],
  onOpenSlackReply,
}: Props) {
  const caffeinateHold = useCaffeinateHold();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [archiveConfirm, setArchiveConfirm] = useState<{
    threadId: string;
    title: string;
    chatCount: number;
    /** When set, archive every id (orchestration group). */
    threadIds?: string[];
    removesWorktree?: boolean;
  } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{
    path: string;
    name: string;
    threadCount: number;
  } | null>(null);

  const q = filter.trim().toLowerCase();

  const globalThreads = useMemo(() => {
    return threads
      .filter((t) => {
        if (t.repoPath !== GLOBAL_WORKSPACE_ID) return false;
        if (!q) return true;
        const hay = `${t.title} ${t.agent} global orchestration`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [threads, q]);

  const byRepo = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      if (!isProjectPath(t.repoPath)) continue;
      if (q) {
        const hay =
          `${threadDisplayLabel(t)} ${t.title} ${t.branchName} ${t.agent} ${repoName(t.repoPath)}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const list = map.get(t.repoPath) ?? [];
      list.push(t);
      map.set(t.repoPath, list);
    }
    // Registered workspaces (and current repo) show even with zero threads
    const ensurePath = (path: string, nameHint?: string) => {
      if (!isProjectPath(path) || map.has(path)) return;
      if (
        q &&
        !repoName(path).toLowerCase().includes(q) &&
        !(nameHint ?? '').toLowerCase().includes(q)
      ) {
        return;
      }
      map.set(path, []);
    };
    for (const ws of workspaces) {
      ensurePath(ws.path, ws.name);
    }
    ensurePath(repoPath);
    return [...map.entries()].sort(([a], [b]) =>
      repoName(a).localeCompare(repoName(b)),
    );
  }, [threads, repoPath, workspaces, q]);

  return (
    <aside className="sidebar">
      <div className="sidebar-chrome">
        <SidebarToggle side="left" open onClick={onToggleSidebar} />
      </div>
      <div className="sidebar-header">
        <div className="brand">
          <BrandMark size="sm" />
          <span className="brand-name">Sideboard</span>
          {caffeinateHold?.appCaffeinated ? <CaffeinateBadge /> : null}
          {slackReplies.length > 0 && (
            <div className="slack-reply-badges" role="list" aria-label="Slack replies">
              {slackReplies.map((badge) => (
                <button
                  key={badge.id}
                  type="button"
                  role="listitem"
                  className="slack-reply-badge"
                  style={{ '--slack-badge-hue': String(badge.hue) } as CSSProperties}
                  title={`${badge.userName} replied in Slack — open thread`}
                  aria-label={`${badge.userName} replied in Slack. Open thread.`}
                  onClick={() => onOpenSlackReply?.(badge.id)}
                >
                  {badge.initials}
                </button>
              ))}
            </div>
          )}
        </div>
        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-nav-btn${view === 'board' ? ' active' : ''}`}
            onClick={onShowBoard}
          >
            <span className="nav-glyph home" aria-hidden />
            Home
          </button>
          <button type="button" className="sidebar-nav-btn" onClick={() => onNew(repoPath || undefined)}>
            <span className="nav-glyph plus" aria-hidden />
            Create
          </button>
          <button
            type="button"
            className={`sidebar-nav-btn${filterOpen ? ' active' : ''}`}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <span className="nav-glyph search" aria-hidden />
            Search
          </button>
        </nav>
      </div>

      <div className="thread-list">
        <div className="sidebar-projects">
        {(!q ||
          globalThreads.length > 0 ||
          'orchestration'.includes(q) ||
          'global'.includes(q)) && (
          <div className="workspace-group">
            <div className="workspace-header">
              <button
                type="button"
                className="workspace-name-btn"
                title="New orchestration chat"
                onClick={() => onNew(undefined, 'orchestration')}
              >
                <span className="workspace-glyph" aria-hidden />
                <span className="workspace-name">Orchestration</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                title="New orchestration chat"
                onClick={() => onNew(undefined, 'orchestration')}
              >
                +
              </button>
            </div>
            {globalThreads.length === 0 ? (
              <div className="thread-meta" style={{ padding: '4px 8px' }}>
                No chats — open Home or use +
              </div>
            ) : (
              (() => {
                // One sidebar row (like a worktree); sibling chats live in the tab bar.
                const primary =
                  globalThreads.find((t) => t.id === selectedId) ??
                  [...globalThreads].sort((a, b) =>
                    b.updatedAt.localeCompare(a.updatedAt),
                  )[0]!;
                const active =
                  view === 'thread' &&
                  globalThreads.some((t) => t.id === selectedId);
                const selected = globalThreads.some((t) => multiSelected.has(t.id));
                const unread = isWorktreeUnread(
                  unreadWorktreeKey(primary),
                  latestAgentResponseAt(globalThreads),
                  { active },
                );
                return (
                  <div className="worktree-block">
                    <div
                      className={`thread-item${active ? ' active' : ''}${selected ? ' selected' : ''}${unread ? ' unread' : ''}`}
                      onClick={(e) =>
                        onSelect(primary.id, e.metaKey || e.ctrlKey || e.shiftKey)
                      }
                    >
                      <ThreadStatusIcon
                        status={primary.status}
                        unread={unread}
                      />
                      <div className="thread-item-body">
                        <div
                          className="thread-title"
                          title={threadDisplayTitle(primary)}
                        >
                          {threadDisplayTitle(primary)}
                        </div>
                        <div className="thread-meta">
                          {primary.agent}
                          {globalThreads.length > 1
                            ? ` · ${globalThreads.length} chats`
                            : ''}
                          {primary.status !== 'idle' ? ` · ${primary.status}` : ''}
                        </div>
                      </div>
                      {onArchive && (
                        <button
                          type="button"
                          className="icon-btn worktree-remove-btn"
                          title="Archive orchestration chats"
                          aria-label="Archive orchestration chats"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveConfirm({
                              threadId: primary.id,
                              title: 'Orchestration',
                              chatCount: globalThreads.length,
                              threadIds: globalThreads.map((t) => t.id),
                              removesWorktree: false,
                            });
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        <div className="projects-header">
          <span className="section-label projects-label">Projects</span>
          <div className="projects-actions">
            <button
              type="button"
              className={`icon-btn${filterOpen ? ' active' : ''}`}
              title="Filter projects"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <span className="filter-glyph" aria-hidden />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Add workspace"
              onClick={onPickRepo}
            >
              <span className="folder-plus-glyph" aria-hidden />
            </button>
          </div>
        </div>

        {filterOpen && (
          <div className="sidebar-filter">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter workspaces & threads…"
            />
          </div>
        )}

        {byRepo.length === 0 && <div className="empty">No workspaces yet</div>}
        {byRepo.map(([path, repoThreads]) => (
          <div key={path} className="workspace-group">
            <div className="workspace-header">
              <div className="workspace-label">
                <button
                  type="button"
                  className="workspace-name-btn"
                  title={`New thread in ${repoName(path)}`}
                  onClick={() => onNew(path)}
                >
                  <span className="workspace-glyph" aria-hidden />
                  <span className="workspace-name" title={path}>
                    {repoName(path)}
                  </span>
                </button>
                {onRemoveWorkspace && (
                  <button
                    type="button"
                    className="icon-btn workspace-remove-btn"
                    title={`Remove ${repoName(path)}`}
                    aria-label={`Remove ${repoName(path)}`}
                    onClick={() =>
                      setRemoveConfirm({
                        path,
                        name: repoName(path),
                        threadCount: repoThreads.length,
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                type="button"
                className="icon-btn"
                title={`New thread in ${repoName(path)}`}
                onClick={() => onNew(path)}
              >
                +
              </button>
            </div>
            {repoThreads.length === 0 && (
              <div className="thread-meta" style={{ padding: '4px 8px' }}>
                No threads
              </div>
            )}
            {groupByWorktree(repoThreads).map((group) => {
              const primary =
                group.find((t) => t.id === selectedId) ??
                [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
              const worktreeLabel = worktreeDisplayLabelForGroup(group);
              const active =
                view === 'thread' && group.some((t) => t.id === selectedId);
              const selected =
                group.some((t) => multiSelected.has(t.id));
              const archiving = group.some((t) => archivingIds.has(t.id));
              const unread = isWorktreeUnread(
                unreadWorktreeKey(primary),
                latestAgentResponseAt(group),
                { active },
              );
              return (
                <div key={primary.worktreePath} className="worktree-block">
                  <WorktreeSidebarRow
                    primary={primary}
                    group={group}
                    worktreeLabel={worktreeLabel}
                    active={active}
                    selected={selected}
                    archiving={archiving}
                    unread={unread}
                    onSelect={onSelect}
                    showArchive={Boolean(onArchive)}
                    onRequestArchive={(chats) =>
                      setArchiveConfirm({
                        threadId: primary.id,
                        title: worktreeLabel,
                        chatCount: chats.length,
                        threadIds: chats.map((c) => c.id),
                        removesWorktree: !primary.cowboy,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        ))}
        </div>
      </div>

      {archiveConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setArchiveConfirm(null)}
        >
          <div
            className="modal create-modal merge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-worktree-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="create-modal-content">
              <h3 id="archive-worktree-title" className="merge-modal-title">
                {archiveConfirm.removesWorktree === false
                  ? archiveConfirm.title === 'Orchestration'
                    ? 'Archive orchestration?'
                    : 'Archive cowboy chat?'
                  : 'Archive worktree?'}
              </h3>
              <p className="confirm-dialog-message">
                {closeChatTabMessage(archiveConfirm.title, archiveConfirm.chatCount, {
                  removesWorktree: archiveConfirm.removesWorktree !== false,
                })}
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button
                  type="button"
                  onClick={() => setArchiveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const ids = archiveConfirm.threadIds?.length
                      ? archiveConfirm.threadIds
                      : [archiveConfirm.threadId];
                    const meta = {
                      title: archiveConfirm.title,
                      removesWorktree: archiveConfirm.removesWorktree !== false,
                    };
                    // Close immediately — progress moves to the chat empty pane
                    // (same non-blocking pattern as worktree create).
                    setArchiveConfirm(null);
                    void Promise.resolve(onArchive?.(ids, meta)).catch(
                      (err: unknown) => {
                        window.alert(
                          err instanceof Error ? err.message : String(err),
                        );
                      },
                    );
                  }}
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removeConfirm && onRemoveWorkspace && (
        <div
          className="modal-backdrop"
          onClick={() => setRemoveConfirm(null)}
        >
          <div
            className="modal create-modal merge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-workspace-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="create-modal-content">
              <h3 id="remove-workspace-title" className="merge-modal-title">
                Remove {removeConfirm.name}?
              </h3>
              <p className="confirm-dialog-message">
                {removeConfirm.threadCount > 0
                  ? `Archive ${removeConfirm.threadCount} open thread${removeConfirm.threadCount === 1 ? '' : 's'} and remove this project from the sidebar. Chats stay in Settings → History.`
                  : 'Remove this project from the sidebar. You can add it again later.'}
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button
                  type="button"
                  onClick={() => setRemoveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const path = removeConfirm.path;
                    setRemoveConfirm(null);
                    void Promise.resolve(onRemoveWorkspace(path)).catch(
                      (err: unknown) => {
                        window.alert(
                          err instanceof Error ? err.message : String(err),
                        );
                      },
                    );
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-footer-btn"
          title="Sideboard"
          aria-label="Sideboard"
          onClick={() =>
            void window.sideboard.openExternal('https://www.sideboard.cloud')
          }
        >
          <span className="sidebar-footer-icon help" aria-hidden>
            ?
          </span>
        </button>
        <button
          type="button"
          className="sidebar-footer-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => onOpenSettings?.()}
        >
          <span className="sidebar-footer-icon gear" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
