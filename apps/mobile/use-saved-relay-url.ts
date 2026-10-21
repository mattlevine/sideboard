import { useEffect, useRef, useState } from 'react';
import { loadRelayUrl, relaySocketUrl, saveRelayUrl } from './relay-url';

/** Relay address for the pair screen. Remembers a valid URL across launches. */
export function useSavedRelayUrl(fallback: string) {
  const [url, setUrlState] = useState(fallback);
  const urlRef = useRef(url);
  const ready = useRef(false);
  const [loaded, setLoaded] = useState(false);
  urlRef.current = url;

  const setUrl = (value: string) => {
    urlRef.current = value;
    setUrlState(value);
  };

  useEffect(() => {
    if (!ready.current) return;
    void saveRelayUrl(url);
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    void loadRelayUrl().then((saved) => {
      if (cancelled) return;
      const next = saved || fallback;
      urlRef.current = next;
      setUrlState(next);
      ready.current = true;
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fallback]);

  return {
    url,
    setUrl,
    loaded,
    socketUrl: () => relaySocketUrl(urlRef.current, fallback),
  };
}
