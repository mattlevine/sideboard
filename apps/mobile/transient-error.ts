import { useCallback, useEffect, useRef, useState } from 'react';

const ERROR_VISIBLE_MS = 5000;

/** Chat and list error lines, such as a file outside the worktree, leave after a few seconds. */
export function useTransientError(): [string | null, (message: string | null) => void] {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setError(message);
    if (!message) return;
    const id = setTimeout(() => {
      if (timer.current !== id) return;
      timer.current = null;
      setError((current) => (current === message ? null : current));
    }, ERROR_VISIBLE_MS);
    timer.current = id;
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [error, show];
}
