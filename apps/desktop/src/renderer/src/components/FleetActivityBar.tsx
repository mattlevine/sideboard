import type { OrchestratorRuntime } from '@sideboard-ai/core';

interface Props {
  runtime: OrchestratorRuntime | null;
  /** Extra meta on the right (e.g. "3 children"). */
  meta?: string;
  compact?: boolean;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'err';
}) {
  return (
    <div className={`board-stat${tone ? ` ${tone}` : ''}`}>
      <div className="board-stat-value">{value}</div>
      <div className="thread-meta">{label}</div>
    </div>
  );
}

export function FleetActivityBar({ runtime, meta, compact = false }: Props) {
  return (
    <div className={`board-stats${compact ? ' compact' : ''}`}>
      <Stat label="Running" value={runtime?.running ?? 0} tone="warn" />
      <Stat label="Queued" value={runtime?.queued ?? 0} tone="warn" />
      <Stat label="Idle" value={runtime?.idle ?? 0} tone="ok" />
      <Stat label="Error" value={runtime?.error ?? 0} tone="err" />
      <Stat label="Cap" value={runtime?.maxConcurrent ?? 3} />
      {meta ? <span className="thread-meta board-stats-meta">{meta}</span> : null}
    </div>
  );
}
