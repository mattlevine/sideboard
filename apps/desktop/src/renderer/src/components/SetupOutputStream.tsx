import { memo, useEffect, useRef, useState } from 'react';
import { mergeSetupOutput } from '@sideboard-ai/core';
import { createScriptOutputPainter } from '../lib/script-output-paint';
import { eventOnWorktree } from '../lib/worktree-events';

interface Props {
  threadId: string;
  worktreeKey: string;
  isCurrentWorktree: (path: string | null | undefined) => boolean;
  running: boolean;
  /** Fired when a live setup stream starts so the parent can switch tabs. */
  onLiveStarted?: () => void;
  /** Fired once when there is text to show (live or hydrated from disk). */
  onHasOutput?: () => void;
}

/**
 * Owns setup log text so `pnpm install` output does not re-render the full
 * right sidebar on every coalesced chunk. Parent still owns running/finished
 * chrome (buttons, script reload).
 */
export const SetupOutputStream = memo(function SetupOutputStream({
  threadId,
  worktreeKey,
  isCurrentWorktree,
  running,
  onLiveStarted,
  onHasOutput,
}: Props) {
  const [output, setOutput] = useState('');
  const painterRef = useRef<ReturnType<typeof createScriptOutputPainter> | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const liveRef = useRef(false);
  const onLiveStartedRef = useRef(onLiveStarted);
  const onHasOutputRef = useRef(onHasOutput);
  onLiveStartedRef.current = onLiveStarted;
  onHasOutputRef.current = onHasOutput;

  useEffect(() => {
    const painter = createScriptOutputPainter(setOutput);
    painterRef.current = painter;
    return () => {
      painter.dispose();
      painterRef.current = null;
    };
  }, []);

  useEffect(() => {
    liveRef.current = false;
    painterRef.current?.clear();
    if (typeof window.sideboard.getSetupLog !== 'function') return;
    let cancelled = false;
    void window.sideboard.getSetupLog(threadId).then((snap) => {
      if (cancelled) return;
      setOutput((prev) => {
        const merged = mergeSetupOutput(prev, snap.output);
        if (merged) onHasOutputRef.current?.();
        return merged;
      });
      if (!liveRef.current && snap.running) onLiveStartedRef.current?.();
    });
    return () => {
      cancelled = true;
    };
  }, [worktreeKey, threadId]);

  useEffect(() => {
    const off = window.sideboard.onEvent((event) => {
      if (event.type === 'setup_started') {
        void eventOnWorktree(event.threadId, threadId, isCurrentWorktree).then((ok) => {
          if (!ok) return;
          liveRef.current = true;
          painterRef.current?.clear();
          onHasOutputRef.current?.();
          onLiveStartedRef.current?.();
        });
        return;
      }
      if (event.type !== 'setup_output') return;
      void eventOnWorktree(event.threadId, threadId, isCurrentWorktree).then((ok) => {
        if (!ok) return;
        liveRef.current = true;
        onHasOutputRef.current?.();
        painterRef.current?.push(event.line);
      });
    });
    return off;
  }, [threadId, isCurrentWorktree]);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output]);

  if (!output && !running) return null;

  return (
    <pre ref={preRef} className={`setup-output${output ? ' has-output' : ''}`}>
      {output || (running ? 'Running setup…' : '')}
    </pre>
  );
});
