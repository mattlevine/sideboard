import type { ReactNode } from 'react';
import type { ThreadStatus } from '@sideboard-ai/core';
import {
  type ThreadStatusKind,
  threadStatusKind,
} from '../lib/thread-status-kind';

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      {children}
    </svg>
  );
}

function labelFor(
  kind: ThreadStatusKind,
  opts: { additions: number; deletions: number; dirtyLoaded: boolean },
): string {
  switch (kind) {
    case 'running':
      return 'Running';
    case 'queued':
      return 'Queued';
    case 'error':
      return 'Error';
    case 'archived':
      return 'Archived';
    case 'dirty':
      return opts.dirtyLoaded
        ? `Uncommitted +${opts.additions} −${opts.deletions}`
        : 'Uncommitted changes';
    default:
      return 'Idle';
  }
}

function KindGlyph({ kind }: { kind: ThreadStatusKind }) {
  switch (kind) {
    case 'running':
      return (
        <Glyph>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" {...stroke} />
        </Glyph>
      );
    case 'queued':
      return (
        <Glyph>
          <circle cx="12" cy="12" r="10" {...stroke} />
          <polyline points="12 6 12 12 16 14" {...stroke} />
        </Glyph>
      );
    case 'error':
      return (
        <Glyph>
          <path
            d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
            {...stroke}
          />
          <path d="M12 9v4M12 17h.01" {...stroke} />
        </Glyph>
      );
    case 'dirty':
      return (
        <Glyph>
          <line x1="6" x2="6" y1="3" y2="15" {...stroke} />
          <circle cx="18" cy="6" r="3" {...stroke} />
          <circle cx="6" cy="18" r="3" {...stroke} />
          <path d="M18 9a9 9 0 0 1-9 9" {...stroke} />
        </Glyph>
      );
    case 'archived':
      return (
        <Glyph>
          <rect x="3" y="4" width="18" height="4" rx="1" {...stroke} />
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" {...stroke} />
        </Glyph>
      );
    default:
      return (
        <Glyph>
          <circle cx="12" cy="12" r="9" {...stroke} />
        </Glyph>
      );
  }
}

export function ThreadStatusIcon({
  status,
  dirty = false,
  dirtyLoaded = false,
  additions = 0,
  deletions = 0,
  unread = false,
}: {
  status: ThreadStatus;
  dirty?: boolean;
  dirtyLoaded?: boolean;
  additions?: number;
  deletions?: number;
  unread?: boolean;
}) {
  const kind = threadStatusKind(status, dirty && dirtyLoaded);
  const label = labelFor(kind, { additions, deletions, dirtyLoaded });
  return (
    <span
      className={`thread-status-icon is-${kind}${unread ? ' is-unread' : ''}`}
      title={label}
      aria-label={label}
      role="img"
    >
      <KindGlyph kind={kind} />
    </span>
  );
}
