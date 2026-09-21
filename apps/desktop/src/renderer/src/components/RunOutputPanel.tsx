import { memo, useEffect, useRef, useState } from 'react';
import type { Thread } from '@sideboard-ai/core';
import { createKeyedScriptOutputPainter } from '../lib/script-output-paint';
import { eventOnWorktree } from '../lib/worktree-events';
import { scriptDisplayName } from '../lib/run-script-icons';

type ActiveRun = NonNullable<Thread['activeRuns']>[number];

export type RunClearRequest = { scriptName: string; token: number };

interface Props {
  threadId: string;
  worktreeKey: string;
  isCurrentWorktree: (path: string | null | undefined) => boolean;
  /** Dev port or any active run — show the log pane even before first line. */
  running: boolean;
  activeRuns: ActiveRun[];
  primaryScriptName: string | null;
  defaultScriptName: string | null;
  canStart: boolean;
  onStart: () => void;
  /** Parent bumps token when starting a script so this pane clears without owning start IPC. */
  clearRequest: RunClearRequest | null;
}

/**
 * Owns Run-tab log state so chatty Node/Vite stdout does not re-render the
 * whole right sidebar (files, diffs, PR checks) on every output chunk.
 */
export const RunOutputPanel = memo(function RunOutputPanel({
  threadId,
  worktreeKey,
  isCurrentWorktree,
  running,
  activeRuns,
  primaryScriptName,
  defaultScriptName,
  canStart,
  onStart,
  clearRequest,
}: Props) {
  const [runLogs, setRunLogs] = useState<Record<string, string>>({});
  const painterRef = useRef<ReturnType<typeof createKeyedScriptOutputPainter> | null>(null);
  const logPreRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const painter = createKeyedScriptOutputPainter(setRunLogs);
    painterRef.current = painter;
    return () => {
      painter.dispose();
      painterRef.current = null;
    };
  }, []);

  // Reset when switching worktrees.
  useEffect(() => {
    painterRef.current?.clear();
  }, [worktreeKey]);

  useEffect(() => {
    if (!clearRequest) return;
    painterRef.current?.clear(clearRequest.scriptName);
  }, [clearRequest?.token, clearRequest?.scriptName]);

  useEffect(() => {
    const off = window.sideboard.onEvent((event) => {
      if (event.type !== 'run_output') return;
      void eventOnWorktree(event.threadId, threadId, isCurrentWorktree).then((ok) => {
        if (!ok) return;
        painterRef.current?.push(event.scriptName, event.line);
      });
    });
    return off;
  }, [threadId, isCurrentWorktree]);

  useEffect(() => {
    const el = logPreRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [runLogs]);

  const hasLog = running || Object.values(runLogs).some(Boolean);
  const label =
    primaryScriptName ??
    activeRuns[0]?.scriptName ??
    defaultScriptName ??
    'Dev';

  return (
    <div className={`run-panel${hasLog ? ' has-log' : ''}`}>
      {hasLog ? (
        <>
          <div className="run-log-header">Running {scriptDisplayName(label)}</div>
          <pre ref={logPreRef} className="setup-output has-output run-log">
            {Object.entries(runLogs)
              .filter(([, log]) => log)
              .map(([name, log]) =>
                activeRuns.length > 1 ? `[${name}]\n${log}` : log,
              )
              .join('\n\n') || 'Starting…'}
          </pre>
        </>
      ) : (
        <div className="panel-empty">
          <div className="run-hero" aria-hidden>
            ▶
          </div>
          <button
            type="button"
            className="ghost-action run-start"
            disabled={!canStart}
            onClick={onStart}
          >
            Start {defaultScriptName ? scriptDisplayName(defaultScriptName) : 'Dev'}{' '}
            <kbd>⌘R</kbd>
          </button>
          <p className="panel-empty-copy">Test your changes here.</p>
        </div>
      )}
    </div>
  );
});
