/** Compact circular context-fill meter (Cursor-style ring). */
export function ContextMeter({
  ratio,
  title,
  size = 14,
}: {
  /** 0–1 fill of the context window. */
  ratio: number;
  title?: string;
  size?: number;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const stroke = 2.25;
  const r = (16 - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = pct * c;
  const hot = pct >= 0.85;
  const warn = !hot && pct >= 0.65;

  return (
    <svg
      className={`context-meter${hot ? ' hot' : warn ? ' warn' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-label={title ?? `Context ${Math.round(pct * 100)}%`}
      role="img"
    >
      {title ? <title>{title}</title> : null}
      <circle
        className="context-meter-track"
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="context-meter-fill"
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={`${filled} ${c - filled}`}
        strokeLinecap="butt"
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}
