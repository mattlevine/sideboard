import { useEffect, useState } from 'react';
import type { TeamName } from '@sideboard-ai/core';

export type TeamToastItem = {
  id: string;
  team: TeamName;
};

interface Props {
  toasts: TeamToastItem[];
  onDismiss: (id: string) => void;
  /** Auto-dismiss after this many ms (default 6s). */
  durationMs?: number;
}

function TeamToastCard({
  item,
  onDismiss,
  durationMs,
}: {
  item: TeamToastItem;
  onDismiss: (id: string) => void;
  durationMs: number;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const hide = window.setTimeout(() => setLeaving(true), durationMs);
    return () => window.clearTimeout(hide);
  }, [durationMs, item.id]);

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(() => onDismiss(item.id), 220);
    return () => window.clearTimeout(done);
  }, [leaving, item.id, onDismiss]);

  return (
    <div
      className={`team-toast${leaving ? ' leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="team-toast-text">
        <strong>{item.team.name}</strong>
        <span>{item.team.location}</span>
        <span className="team-toast-league">{item.team.league}</span>
      </div>
      <button
        type="button"
        className="team-toast-dismiss"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => setLeaving(true)}
      >
        ×
      </button>
    </div>
  );
}

/** Bottom-right stack of soccer-team nickname toasts. */
export function TeamToastStack({ toasts, onDismiss, durationMs = 6000 }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="team-toast-stack" aria-label="Team nicknames">
      {toasts.map((item) => (
        <TeamToastCard
          key={item.id}
          item={item}
          onDismiss={onDismiss}
          durationMs={durationMs}
        />
      ))}
    </div>
  );
}
