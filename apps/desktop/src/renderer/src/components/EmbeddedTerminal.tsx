import { useEffect, useRef, useState } from 'react';

interface Props {
  threadId: string;
  mode?: 'shell' | 'attach';
}

/**
 * Full-bleed worktree terminal (Conductor-style). xterm when available;
 * otherwise a minimal scrollback + line input.
 */
export function EmbeddedTerminal({ threadId, mode = 'shell' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [xtermReady, setXtermReady] = useState(false);
  const termRef = useRef<{ write: (d: string) => void; dispose: () => void } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    let offData: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    let localSession: string | null = null;

    async function boot() {
      setError(null);
      setLines([]);
      setXtermReady(false);
      try {
        if (!window.sideboard.terminal?.start) {
          setError('Restart Sideboard to enable the embedded terminal.');
          return;
        }
        const start =
          mode === 'attach' && typeof window.sideboard.terminal.attach === 'function'
            ? window.sideboard.terminal.attach
            : window.sideboard.terminal.start;
        const { id } = await start(threadId, 100, 24);
        if (cancelled) {
          await window.sideboard.terminal.kill(id);
          return;
        }
        localSession = id;
        setSessionId(id);

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
          fit.fit();
          term.onData((data) => {
            void window.sideboard.terminal.write(id, data);
          });
          const ro = new ResizeObserver(() => {
            try {
              fit.fit();
              void window.sideboard.terminal.resize(id, term.cols, term.rows);
            } catch {
              // ignore
            }
          });
          ro.observe(hostRef.current);
          termRef.current = {
            write: (d) => term.write(d),
            dispose: () => {
              ro.disconnect();
              term.dispose();
            },
          };
          setXtermReady(true);
        } catch {
          setXtermReady(false);
        }

        offData = window.sideboard.terminal.onData((payload) => {
          if (payload.id !== id) return;
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
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    void boot();
    return () => {
      cancelled = true;
      offData?.();
      offExit?.();
      termRef.current?.dispose();
      termRef.current = null;
      if (localSession) void window.sideboard.terminal.kill(localSession);
    };
  }, [threadId, mode]);

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
        style={{ display: xtermReady ? 'block' : 'none' }}
      />
      {!xtermReady && !error ? (
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
