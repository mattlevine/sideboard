import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ClaudePlanUsage, ClaudeUsageWindow } from '@sideboard-ai/core';
import {
  formatClaudeExtraUsageDetail,
  formatClaudeUsageFetchedAt,
  formatClaudeUsageReset,
  formatClaudeUsageResetClock,
  formatClaudeUsageTooltip,
  hottestClaudeWindow,
} from '@sideboard/claude-usage';
import { contextMeterTone, tabUsageRingRatio } from '../lib/tokens';
import { ContextMeter } from './ContextMeter';

function placeCard(anchor: HTMLElement, tall: boolean): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  const width = 360;
  const pad = 12;
  const estHeight = tall ? 420 : 280;
  let left = rect.right - width;
  if (left < pad) left = pad;
  if (left + width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - width - pad);
  }
  let top = rect.bottom + 8;
  if (top + estHeight > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - estHeight - 8);
  }
  return { top, left };
}

function TabUsageHoverCard({
  usage,
  contextLabel,
  contextTooltip,
  contextRatio,
  anchorRef,
  onKeep,
}: {
  usage: ClaudePlanUsage | null;
  contextLabel?: string | null;
  contextTooltip?: string;
  contextRatio?: number | null;
  anchorRef: RefObject<HTMLElement | null>;
  onKeep: (open: boolean) => void;
}) {
  const showPlan = Boolean(usage);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => setPos(placeCard(el, showPlan));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, showPlan, usage?.fetchedAt, contextRatio]);

  if (!pos || typeof document === 'undefined') return null;

  const aria = [
    contextTooltip || contextLabel,
    usage ? formatClaudeUsageTooltip(usage) : null,
  ]
    .filter(Boolean)
    .join('\n');

  return createPortal(
    <div
      className="claude-usage-card"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={aria}
      onMouseEnter={() => onKeep(true)}
      onMouseLeave={() => onKeep(false)}
    >
      <div className="claude-usage-card-section">
        <div className="claude-usage-card-head">
          <strong>Context</strong>
          <span>This chat's going-forward window</span>
        </div>
        <ContextUsageRow
          occupancy={contextLabel ?? 'Context'}
          detail={contextTooltip ?? 'Occupancy of the next request against the 1M window'}
          ratio={contextRatio ?? 0}
        />
      </div>
      {usage ? (
        <div className="claude-usage-card-section">
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
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function ContextUsageRow({
  occupancy,
  detail,
  ratio,
}: {
  occupancy: string;
  detail?: string;
  ratio: number;
}) {
  const used = Math.max(0, Math.min(100, ratio * 100));
  const tone = contextMeterTone(ratio);
  return (
    <div className={`claude-usage-card-row${tone ? ` ${tone}` : ''}`}>
      <div className="claude-usage-card-row-top">
        <span className="claude-usage-card-label">Occupancy</span>
        <span className="claude-usage-card-left">{occupancy}</span>
      </div>
      {detail ? <p className="claude-usage-card-detail">{detail}</p> : null}
      <div className="claude-usage-card-bar" aria-hidden>
        <div className="claude-usage-card-bar-fill" style={{ width: `${used}%` }} />
      </div>
      <div className="claude-usage-card-row-meta">
        <span>{Math.round(used)}% used</span>
      </div>
    </div>
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
      <div className="claude-usage-card-bar" aria-hidden>
        <div className="claude-usage-card-bar-fill" style={{ width: `${used}%` }} />
      </div>
      <div className="claude-usage-card-row-meta">
        <span>{Math.round(window.usedPercent)}% used</span>
        {reset ? <span>{reset}</span> : null}
        {clock ? <span>{clock}</span> : null}
      </div>
    </li>
  );
}

/** One tab-bar ring: thread context, with Claude plan details on hover when present. */
export function ClaudeUsageMeter({
  usage = null,
  contextRatio = null,
  contextLabel = null,
  contextTooltip,
}: {
  usage?: ClaudePlanUsage | null;
  contextRatio?: number | null;
  contextLabel?: string | null;
  contextTooltip?: string;
}) {
  const hottest = usage ? hottestClaudeWindow(usage) : null;
  const ratio = tabUsageRingRatio(contextRatio, hottest?.usedPercent);
  const tone = ratio != null ? contextMeterTone(ratio) : '';
  const breakdown = [
    contextTooltip || contextLabel,
    usage ? formatClaudeUsageTooltip(usage) : null,
  ]
    .filter(Boolean)
    .join('\n');
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

  if (ratio == null) return null;

  return (
    <>
      <span
        ref={anchorRef}
        className={`thread-meta usage-cluster${usage ? ' claude-plan-usage' : ''}${tone ? ` ${tone}` : ''}`}
        aria-label={breakdown}
        onMouseEnter={() => keep(true)}
        onMouseLeave={() => keep(false)}
      >
        <ContextMeter ratio={ratio} />
      </span>
      {open ? (
        <TabUsageHoverCard
          usage={usage}
          contextLabel={contextLabel}
          contextTooltip={contextTooltip}
          contextRatio={contextRatio}
          anchorRef={anchorRef}
          onKeep={keep}
        />
      ) : null}
    </>
  );
}
