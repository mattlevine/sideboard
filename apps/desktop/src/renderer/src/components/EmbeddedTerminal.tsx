import { useEffect, useRef, useState } from 'react';
import { shouldApplyPtyResize } from '../lib/pty-resize';
import { xtermHostVisibility } from '../lib/xterm-host-visibility';

interface Props {
  /** Any live chat in the worktree — main uses it to resolve cwd. */
  threadId: string;
  /** One shell PTY per worktree, shared across chat tabs. */
  worktreePath: string;
  mode?: 'shell' | 'attach';
  /** False while the panel is parked (another lower tab). Refresh xterm when shown. */
  active?: boolean;
}

/**
 * Full-bleed worktree terminal (Conductor-style). xterm when available;
 * otherwise a minimal scrollback + line input.
 *
 * The PTY lives in the main process and is reused across chat tabs in the same
 * worktree (switching chats must not spawn a second shell). Do not kill the
 * session on unmount — archive and purge tear it down when the last tab goes.
 */
export function EmbeddedTerminal({
  threadId,
  worktreePath,
  mode = 'shell',
  active = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [xtermState, setXtermState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const termRef = useRef<{
    write: (d: string) => void;
    dispose: () => void;
    refresh: () => void;
  } | null>(null);

  useEffect(() => {
    if (!active) return;
    // Hidden canvases often come back blank after a worktree switch.
    const id = requestAnimationFrame(() => termRef.current?.refresh());
    return () => cancelAnimationFrame(id);
  }, [active]);

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  useEffect(() => {
    let cancelled = false;
    let offData: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    let attached = false;

    async function boot() {
      setError(null);
      setLines([]);
      setXtermState('loading');
      try {
        if (!window.sideboard.terminal?.start) {
          setError('Restart Sideboard to enable the embedded terminal.');
          return;
        }
        const start =
          mode === 'attach' && typeof window.sideboard.terminal.attach === 'function'
            ? window.sideboard.terminal.attach
            : window.sideboard.terminal.start;
        const { id } = await start(threadIdRef.current, 100, 24);
        if (cancelled) return;
        setSessionId(id);

        offData = window.sideboard.terminal.onData((payload) => {
          if (payload.id !== id) return;
          if (!attached) return;
          if (termRef.current) {
            termRef.current.write(payload.data);
          } else {
            setLines((prev) => [...prev.slice(-500), payload.data]);
          }
        });
        offExit = window.sideboard.terminal.onExit((payload) => {
          if (payload.id !== id) return;
          setSessionId(null);
          setLines((prev) => [
            ...prev,
            `\n[process exited ${payload.exitCode ?? '?'}]\n`,
          ]);
        });

        const snapshot = async (): Promise<string> => {
          if (typeof window.sideboard.terminal.snapshot !== 'function') return '';
          try {
            return (await window.sideboard.terminal.snapshot(id)) ?? '';
          } catch {
            return '';
          }
        };

        try {
          const [{ Terminal }, { FitAddon }] = await Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
          ]);
          await import('@xterm/xterm/css/xterm.css');
          if (cancelled || !hostRef.current) return;
          hostRef.current.innerHTML = '';
          const term = new Terminal({
            convertEol: true,
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            cursorBlink: true,
            theme: {
              background: '#141210',
              foreground: '#e8e4df',
              cursor: '#e8e4df',
              selectionBackground: '#3a3530',
            },
          });
          const fit = new FitAddon();
          term.loadAddon(fit);
          term.open(hostRef.current);
          term.onData((data) => {
            void window.sideboard.terminal.write(id, data);
          });
          let lastPtySize: { cols: number; rows: number } | null = null;
          let fitting = false;
          let fitRaf = 0;
          const applyFit = (alsoRefresh = false) => {
            if (fitting) return;
            fitting = true;
            try {
              fit.fit();
              if (alsoRefresh) {
                term.refresh(0, Math.max(0, term.rows - 1));
              }
              const next = { cols: term.cols, rows: term.rows };
              if (shouldApplyPtyResize(lastPtySize, next)) {
                lastPtySize = next;
                void window.sideboard.terminal.resize(id, next.cols, next.rows);
              }
            } catch {
              // ignore
            } finally {
              fitting = false;
            }
          };
          const scheduleFit = () => {
            if (fitRaf) return;
            fitRaf = requestAnimationFrame(() => {
              fitRaf = 0;
              applyFit();
            });
          };
          applyFit();
          const ro = new ResizeObserver(() => {
            scheduleFit();
          });
          ro.observe(hostRef.current);
          termRef.current = {
            write: (d) => term.write(d),
            dispose: () => {
              if (fitRaf) cancelAnimationFrame(fitRaf);
              ro.disconnect();
              term.dispose();
            },
            refresh: () => {
              applyFit(true);
            },
          };
          const first = await snapshot();
          if (cancelled) {
            termRef.current.dispose();
            termRef.current = null;
            return;
          }
          if (first) term.write(first);
          const second = await snapshot();
          if (cancelled) {
            termRef.current.dispose();
            termRef.current = null;
            return;
          }
          if (second.length > first.length && second.startsWith(first)) {
            term.write(second.slice(first.length));
          }
          attached = true;
          setXtermState('ready');
          requestAnimationFrame(() => termRef.current?.refresh());
        } catch {
          const snap = await snapshot();
          if (!cancelled && snap) setLines([snap]);
          attached = true;
          setXtermState('fallback');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    void boot();
    return () => {
      cancelled = true;
      attached = false;
      offData?.();
      offExit?.();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [worktreePath, mode]);

  async function sendLine(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !input) return;
    await window.sideboard.terminal.write(sessionId, `${input}\n`);
    setInput('');
  }

  return (
    <div className="embedded-terminal">
      {error ? <div className="panel-empty-copy terminal-error">{error}</div> : null}
      <div
        ref={hostRef}
        className="embedded-terminal-xterm"
        style={{
          visibility: xtermHostVisibility(xtermState === 'ready', active),
          display: xtermState === 'fallback' ? 'none' : undefined,
        }}
      />
      {xtermState === 'fallback' && !error ? (
        <div className="embedded-terminal-fallback">
          <pre className="terminal-fallback-log">
            {lines.join('') || 'Starting shell…'}
          </pre>
          <form onSubmit={(e) => void sendLine(e)} className="terminal-fallback-form">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder=""
              aria-label="Terminal input"
              disabled={!sessionId}
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}
