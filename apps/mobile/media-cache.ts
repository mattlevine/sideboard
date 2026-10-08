type Listener = (url: string | null) => void;

const values = new Map<string, string | null>();
const listeners = new Map<string, Set<Listener>>();

/** Same relative path in two chats can be two different worktree files. */
export function imageCacheKey(chatId: string, src: string): string {
  return `${chatId}\0${src}`;
}

/** `undefined` until the Mac answers. `null` means it could not be shown. */
export function peekImage(key: string): string | null | undefined {
  return values.has(key) ? (values.get(key) ?? null) : undefined;
}

export function publishImage(key: string, url: string | null): void {
  values.set(key, url);
  for (const listener of listeners.get(key) ?? []) listener(url);
}

export function watchImage(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  if (values.has(key)) listener(values.get(key) ?? null);
  return () => {
    set?.delete(listener);
  };
}
