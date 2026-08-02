export type AutocompleteKind = 'file' | 'skill';

export interface AutocompleteItem {
  id: string;
  label: string;
  detail?: string;
  insert: string;
  kind: AutocompleteKind;
}

interface Props {
  items: AutocompleteItem[];
  activeIndex: number;
  onPick: (item: AutocompleteItem) => void;
  onHover: (index: number) => void;
}

export function ComposerAutocomplete({ items, activeIndex, onPick, onHover }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="composer-ac" role="listbox">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={i === activeIndex ? 'active' : ''}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(item)}
        >
          <span className="composer-ac-kind">{item.kind === 'file' ? '@' : '/'}</span>
          <span className="composer-ac-main">
            <span className="composer-ac-label">{item.label}</span>
            {item.detail ? <span className="composer-ac-detail">{item.detail}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Detect @file or /skill query at the cursor. */
export function getAutocompleteQuery(
  value: string,
  cursor: number,
): { kind: AutocompleteKind; query: string; start: number; end: number } | null {
  const before = value.slice(0, cursor);
  const at = before.match(/(?:^|[\s])@([^\s@]*)$/);
  if (at) {
    const token = at[1] ?? '';
    const start = cursor - token.length - 1;
    return { kind: 'file', query: token.toLowerCase(), start, end: cursor };
  }
  const slash = before.match(/(?:^|[\s])\/([a-z0-9-]*)$/i);
  if (slash) {
    const token = slash[1] ?? '';
    const start = cursor - token.length - 1;
    return { kind: 'skill', query: token.toLowerCase(), start, end: cursor };
  }
  return null;
}

export function applyAutocomplete(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; cursor: number } {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return { value: next, cursor: start + insert.length };
}
