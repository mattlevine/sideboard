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

export interface AutocompleteSkill {
  id: string;
  name: string;
  command: string;
  description: string;
  source: string;
}

export type AutocompleteQuery = NonNullable<ReturnType<typeof getAutocompleteQuery>>;

/** Map a `/` or `@` query to picker rows (empty when suppressed or no matches). */
export function autocompleteItemsFromQuery(
  query: AutocompleteQuery | null,
  opts: {
    suppressed?: boolean;
    filePaths?: string[];
    skills: AutocompleteSkill[];
  },
): AutocompleteItem[] {
  if (!query || opts.suppressed) return [];
  if (query.kind === 'file') {
    return (opts.filePaths ?? [])
      .filter((p) => p.toLowerCase().includes(query.query))
      .slice(0, 10)
      .map((p) => ({
        id: `file:${p}`,
        label: p,
        insert: `@${p} `,
        kind: 'file' as const,
      }));
  }
  return opts.skills
    .filter(
      (s) =>
        s.command.includes(query.query) || s.name.toLowerCase().includes(query.query),
    )
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      label: `/${s.command}`,
      detail: `${s.description || s.name} · ${s.source}`,
      insert: `/${s.command} `,
      kind: 'skill' as const,
    }));
}

/** Arrow/Tab/Enter/Escape while the picker is open. Returns true when handled. */
export function consumeAutocompleteKeyDown(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  opts: {
    items: AutocompleteItem[];
    activeIndex: number;
    onIndex: (index: number) => void;
    onPick: (item: AutocompleteItem) => void;
    onSuppress: () => void;
  },
): boolean {
  const { items } = opts;
  if (items.length === 0) return false;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    opts.onIndex((opts.activeIndex + 1) % items.length);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    opts.onIndex((opts.activeIndex - 1 + items.length) % items.length);
    return true;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    const item = items[Math.min(opts.activeIndex, items.length - 1)];
    if (item) opts.onPick(item);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    opts.onSuppress();
    return true;
  }
  return false;
}
