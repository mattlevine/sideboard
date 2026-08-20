/**
 * Serialize async work that shares a key (git `.git` lock, last-tab worktree
 * teardown) without blocking unrelated keys.
 */
const tails = new Map<string, Promise<void>>();

export function enqueueByKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  tails.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
