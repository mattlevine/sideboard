type Listener = (url: string | null) => void;

const values = new Map<string, string | null>();
const listeners = new Map<string, Set<Listener>>();

/** `undefined` until the Mac answers. `null` means it could not be shown. */
export function peekImage(src: string): string | null | undefined {
  return values.has(src) ? (values.get(src) ?? null) : undefined;
}

export function publishImage(src: string, url: string | null): void {
  values.set(src, url);
  for (const listener of listeners.get(src) ?? []) listener(url);
}

export function watchImage(src: string, listener: Listener): () => void {
  let set = listeners.get(src);
  if (!set) {
    set = new Set();
    listeners.set(src, set);
  }
  set.add(listener);
  if (values.has(src)) listener(values.get(src) ?? null);
  return () => {
    set?.delete(listener);
  };
}
