import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ClaudePlanUsage, ClaudeUsageWindow } from '@sideboard-ai/core';
import {
  formatClaudeExtraUsageDetail,
  formatClaudeUsageCompact,
  formatClaudeUsageFetchedAt,
  formatClaudeUsageReset,
  formatClaudeUsageResetClock,
  formatClaudeUsageTooltip,
  hottestClaudeWindow,
} from '@sideboard/claude-usage';
import { contextMeterTone } from '../lib/tokens';
import { ContextMeter } from './ContextMeter';

function placeCard(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  const width = 360;
  const pad = 12;
  let left = rect.right - width;
  if (left < pad) left = pad;
  if (left + width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - width - pad);
  }
  let top = rect.bottom + 8;
  if (top + 280 > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - 288);
  }
  return { top, left };
}

function ClaudeUsageHoverCard({
  usage,
  anchorRef,
  onKeep,
}: {
  usage: ClaudePlanUsage;
  anchorRef: RefObject<HTMLElement | null>;
  onKeep: (open: boolean) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => setPos(placeCard(el));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, usage.fetchedAt]);

  if (!pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="claude-usage-card"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={formatClaudeUsageTooltip(usage)}
      onMouseEnter={() => onKeep(true)}
      onMouseLeave={() => onKeep(false)}
    >
      <div className="claude-usage-card-head">
        <strong>Claude Code plan</strong>
        <span>Remaining per window</span>
      </div>
      <ul className="claude-usage-card-list">
        {usage.windows.map((window) => (
          <ClaudeUsageWindowRow key={window.id} window={window} />
        ))}
      </ul>
      {usage.extraUsage ? (
        <div className="claude-usage-card-extra">
          {formatClaudeExtraUsageDetail(usage.extraUsage)}
        </div>
      ) : null}
      <div className="claude-usage-card-foot">
        {formatClaudeUsageFetchedAt(usage.fetchedAt)}
      </div>
    </div>,
    document.body,
  );
}

function ClaudeUsageWindowRow({ window }: { window: ClaudeUsageWindow }) {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const tone = contextMeterTone(used / 100);
  const reset = formatClaudeUsageReset(window.resetsAt);
  const clock = formatClaudeUsageResetClock(window.resetsAt);
  return (
    <li className={`claude-usage-card-row${tone ? ` ${tone}` : ''}`}>
      <div className="claude-usage-card-row-top">
        <span className="claude-usage-card-label">{window.label}</span>
        <span className="claude-usage-card-left">
          {Math.round(window.remainingPercent)}% left
        </span>
      </div>
      <p className="claude-usage-card-detail">{window.detail}</p>
      <div
        className="claude-usage-card-bar"
        aria-hidden
      >
        <div
          className="claude-usage-card-bar-fill"
          style={{ width: `${used}%` }}
        />
      </div>
      <div className="claude-usage-card-row-meta">
        <span>{Math.round(window.usedPercent)}% used</span>
        {reset ? <span>{reset}</span> : null}
        {clock ? <span>{clock}</span> : null}
      </div>
    </li>
  );
}

/** Compact remaining-quota rings for Claude Code plan windows. */
export function ClaudeUsageMeter({ usage }: { usage: ClaudePlanUsage }) {
  const hottest = hottestClaudeWindow(usage);
  const tone = contextMeterTone((hottest?.usedPercent ?? 0) / 100);
  const breakdown = formatClaudeUsageTooltip(usage);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  function keep(next: boolean) {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (next) {
      setOpen(true);
      return;
    }
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }

  useEffect(() => {
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <>
      <span
        ref={anchorRef}
        className={`thread-meta usage-cluster claude-plan-usage${tone ? ` ${tone}` : ''}`}
        aria-label={breakdown}
        onMouseEnter={() => keep(true)}
        onMouseLeave={() => keep(false)}
      >
        {usage.windows.map((window) => (
          <span key={window.id} className="claude-plan-window">
            <ContextMeter ratio={window.usedPercent / 100} />
            <span className="usage-total">{formatClaudeUsageCompact(window)}</span>
          </span>
        ))}
      </span>
      {open ? (
        <ClaudeUsageHoverCard usage={usage} anchorRef={anchorRef} onKeep={keep} />
      ) : null}
    </>
  );
}
