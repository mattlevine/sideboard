/** Minimal Lucide-style icons for Conductor run-script `icon` names. */
import type { ReactNode } from 'react';

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden
      className="run-script-icon"
    >
      {children}
    </svg>
  );
}

export function RunScriptIcon({ name }: { name?: string | null }) {
  const key = (name ?? 'play').toLowerCase().replace(/_/g, '-');
  switch (key) {
    case 'database':
    case 'db':
      return (
        <Svg>
          <ellipse cx="12" cy="5" rx="9" ry="3" {...stroke} />
          <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" {...stroke} />
          <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" {...stroke} />
        </Svg>
      );
    case 'monitor':
    case 'desktop':
    case 'laptop':
      return (
        <Svg>
          <rect x="2" y="3" width="20" height="14" rx="2" {...stroke} />
          <path d="M8 21h8M12 17v4" {...stroke} />
        </Svg>
      );
    case 'rocket':
      return (
        <Svg>
          <path
            d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"
            {...stroke}
          />
          <path
            d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"
            {...stroke}
          />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" {...stroke} />
        </Svg>
      );
    case 'settings':
    case 'cog':
    case 'gear':
      return (
        <Svg>
          <circle cx="12" cy="12" r="3" {...stroke} />
          <path
            d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
            {...stroke}
          />
        </Svg>
      );
    case 'test-tube':
    case 'flask':
      return (
        <Svg>
          <path d="M9 3h6M10 9h4M10 3v7.5L5.5 19a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3L14 10.5V3" {...stroke} />
        </Svg>
      );
    case 'terminal':
      return (
        <Svg>
          <polyline points="4 17 10 11 4 5" {...stroke} />
          <line x1="12" y1="19" x2="20" y2="19" {...stroke} />
        </Svg>
      );
    case 'globe':
    case 'browser':
    case 'earth':
      return (
        <Svg>
          <circle cx="12" cy="12" r="10" {...stroke} />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" {...stroke} />
        </Svg>
      );
    case 'square':
    case 'stop':
      return (
        <Svg>
          <rect x="6" y="6" width="12" height="12" rx="1" {...stroke} />
        </Svg>
      );
    case 'play':
    default:
      return (
        <Svg>
          <polygon points="6 4 20 12 6 20 6 4" {...stroke} />
        </Svg>
      );
  }
}

export function scriptDisplayName(name: string): string {
  if (!name) return 'Dev';
  return name.charAt(0).toUpperCase() + name.slice(1);
}
