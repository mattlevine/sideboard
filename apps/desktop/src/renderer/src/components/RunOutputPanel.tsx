import { memo, useEffect, useRef, useState } from 'react';
import type { Thread } from '@sideboard-ai/core';
import {
  createKeyedScriptOutputPainter,
  mergeScriptOutput,
  shouldApplyHydratedRunLog,
} from '../lib/script-output-paint';
import { eventOnWorktree } from '../lib/worktree-events';
import { RunScriptIcon, scriptDisplayName } from '../lib/run-script-icons';

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
  onStop?: (scriptName: string) => void;
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
  onStop,
  clearRequest,
}: Props) {
  const [runLogs, setRunLogs] = useState<Record<string, string>>({});
  const [focusScript, setFocusScript] = useState<string | null>(null);
  const painterRef = useRef<ReturnType<typeof createKeyedScriptOutputPainter> | null>(null);
  const logPreRef = useRef<HTMLPreElement>(null);
  const hydrateEpochRef = useRef(0);

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

  const scriptNamesKey = [
    ...new Set(
      [primaryScriptName, defaultScriptName, ...activeRuns.map((r) => r.scriptName)].filter(
        (n): n is string => Boolean(n),
      ),
    ),
  ]
    .sort()
    .join(',');

  useEffect(() => {
    if (typeof window.sideboard.getRunLog !== 'function') return;
    const names = scriptNamesKey ? scriptNamesKey.split(',') : ['dev'];
    const epoch = hydrateEpochRef.current;
    let cancelled = false;
    void Promise.all(
      names.map(async (name) => {
        const snap = await window.sideboard.getRunLog(threadId, name);
        if (
          !shouldApplyHydratedRunLog(epoch, hydrateEpochRef.current, cancelled, snap.output)
        ) {
          return;
        }
        setRunLogs((prev) => ({
          ...prev,
          [name]: mergeScriptOutput(prev[name] ?? '', snap.output),
        }));
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [worktreeKey, threadId, scriptNamesKey]);

  useEffect(() => {
    if (!clearRequest) return;
    // Invalidate in-flight getRunLog so a pre-clear snapshot cannot restore
    // the previous run after Start empties the pane. Do not re-hydrate here —
    // beginRunLog has not run yet, so a refetch would be the stale file.
    hydrateEpochRef.current += 1;
    setFocusScript(clearRequest.scriptName);
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
  const scriptNames = [
    ...new Set([
      ...activeRuns.map((r) => r.scriptName),
      ...Object.keys(runLogs).filter((name) => runLogs[name]),
    ]),
  ];
  const focused =
    focusScript && scriptNames.includes(focusScript) ? focusScript : null;
  const shown = scriptNames
    .filter((name) => !focused || name === focused)
    .map((name) => ({ name, log: runLogs[name] ?? '' }))
    .filter((row) => row.log);
  const label =
    primaryScriptName ??
    activeRuns[0]?.scriptName ??
    defaultScriptName ??
    'Dev';

  return (
    <div className={`run-panel${hasLog ? ' has-log' : ''}`}>
      {hasLog ? (
        <>
          {scriptNames.length > 1 ? (
            <div className="run-log-header run-log-scripts">
              <span>Running</span>
              {scriptNames.map((name) => {
                const live = activeRuns.some((run) => run.scriptName === name);
                return (
                  <span
                    key={name}
                    className={`run-log-script${focused === name ? ' active' : ''}${live ? ' is-live' : ''}`}
                  >
                    <button
                      type="button"
                      className="run-log-script-name"
                      onClick={() =>
                        setFocusScript((current) => (current === name ? null : name))
                      }
                    >
                      {scriptDisplayName(name)}
                    </button>
                    {live && onStop ? (
                      <button
                        type="button"
                        className="run-log-script-stop"
                        title={`Stop ${scriptDisplayName(name)}`}
                        aria-label={`Stop ${scriptDisplayName(name)}`}
                        onClick={() => onStop(name)}
                      >
                        <RunScriptIcon name="stop" />
                      </button>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="run-log-header">Running {scriptDisplayName(label)}</div>
          )}
          <pre ref={logPreRef} className="setup-output has-output run-log">
            {shown
              .map((row) =>
                shown.length > 1 ? `[${row.name}]\n${row.log}` : row.log,
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
