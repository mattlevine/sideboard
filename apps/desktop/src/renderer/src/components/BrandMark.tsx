/** Sideboard mark — tilted outline cube over a blue offset plate. */
export function BrandMark({
  className = '',
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className={`brand-mark brand-mark-${size}${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <span className="brand-mark-plate" />
      <span className="brand-mark-cube" />
    </span>
  );
}
