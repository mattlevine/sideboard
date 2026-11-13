import { useCallback, useRef, useState } from 'react';
import type { Thread } from '@sideboard-ai/core';
import type { ScheduleThisPrefill } from './schedule-this';

type AppView = 'board' | 'thread' | 'automations' | 'orchestration';

export function useScheduleThis(opts: {
  setView: (view: AppView) => void;
  setSelectedId: (id: string | null) => void;
  threadsRef: { current: Thread[] };
  archivedRef: { current: Thread[] };
  refresh: () => Promise<void>;
  onSelect: (id: string, multi: boolean) => void;
}) {
  const [scheduleRequest, setScheduleRequest] = useState<{
    nonce: number;
    prefill: ScheduleThisPrefill;
  } | null>(null);
  const nonce = useRef(0);
  const clearScheduleRequest = useCallback(() => setScheduleRequest(null), []);

  function openScheduleThis(prefill: ScheduleThisPrefill) {
    nonce.current += 1;
    setScheduleRequest({ nonce: nonce.current, prefill });
    opts.setView('automations');
    opts.setSelectedId(null);
  }

  async function openAutomationChat(threadId: string) {
    const id = threadId.trim();
    if (!id) throw new Error('That chat is no longer in History.');
    const known =
      opts.threadsRef.current.find((t) => t.id === id) ??
      opts.archivedRef.current.find((t) => t.id === id) ??
      (await window.sideboard.getThread(id).catch(() => null));
    if (!known) throw new Error('That chat is no longer in History.');
    if (known.status === 'archived') {
      await window.sideboard.restoreThread(id);
      await opts.refresh();
    }
    opts.onSelect(id, false);
  }

  return {
    scheduleRequest,
    clearScheduleRequest,
    openScheduleThis,
    openAutomationChat,
  };
}
