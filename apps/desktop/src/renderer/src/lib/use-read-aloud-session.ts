import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { PublicAppSettings } from '@sideboard-ai/core';
import { ReadAloudModal } from '../components/ReadAloudModal';
import { clampReadAloudRate, sanitizeReadAloudVoiceURI } from './read-aloud';

export function useReadAloudSession(): {
  open: (text: string) => void;
  applyFromSettings: (s: PublicAppSettings) => void;
  modal: ReactNode;
} {
  const [session, setSession] = useState<{ text: string; nonce: number } | null>(null);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState('');

  const applyFromSettings = useCallback((s: PublicAppSettings) => {
    setRate(clampReadAloudRate(s.advanced?.readAloudRate));
    setVoiceURI(sanitizeReadAloudVoiceURI(s.advanced?.readAloudVoiceURI));
  }, []);

  const persistDefaults = useCallback((next: { rate: number; voiceURI: string }) => {
    setRate(next.rate);
    setVoiceURI(next.voiceURI);
    void window.sideboard.updateAdvancedSettings({
      readAloudRate: next.rate,
      readAloudVoiceURI: next.voiceURI,
    });
  }, []);

  const open = useCallback((text: string) => {
    const next = text.trim();
    if (!next) return;
    setSession({ text: next.slice(0, 50_000), nonce: Date.now() });
  }, []);

  useEffect(() => {
    void window.sideboard.getAppSettings().then(applyFromSettings).catch(() => {});
    const off = window.sideboardUpdate.onReadAloud?.((text) => open(text));
    return () => off?.();
  }, [applyFromSettings, open]);

  const modal = session ? (
    <ReadAloudModal
      key={session.nonce}
      text={session.text}
      rate={rate}
      voiceURI={voiceURI}
      onDefaultsChange={persistDefaults}
      onClose={() => setSession(null)}
    />
  ) : null;

  return { open, applyFromSettings, modal };
}
