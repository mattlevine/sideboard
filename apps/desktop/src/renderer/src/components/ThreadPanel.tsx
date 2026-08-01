import { useEffect, useMemo, useRef, useState } from 'react';
import type { LandPreview, Thread } from '@sideboard/core';
import { Changes } from './Changes';

interface Props {
  thread: Thread;
  liveOutput: string;
  onRefresh: () => void;
  composerPrefill?: string;
  onComposerPrefillConsumed?: () => void;
}

export function ThreadPanel({
  thread,
  liveOutput,
  onRefresh,
  composerPrefill,
  onComposerPrefillConsumed,
}: Props) {
  const [tab, setTab] = useState<'chat' | 'changes'>('chat');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [landPreview, setLandPreview] = useState<LandPreview | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hasHook, setHasHook] = useState(false);


  useEffect(() => {
    void window.sideboard.hasConductorHook(thread.repoPath).then(setHasHook);
  }, [thread.repoPath]);

  useEffect(() => {
    if (composerPrefill) {
      setPrompt(composerPrefill);
      setTab('chat');
      onComposerPrefillConsumed?.();
    }
  }, [composerPrefill, onComposerPrefillConsumed]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages, liveOutput]);

  const statusLabel = useMemo(() => {
    if (thread.status === 'queued') return `queued (${thread.queue.length})`;
    return thread.status;
  }, [thread.status, thread.queue.length]);

  async function send() {
    const text = prompt.trim();
    if (!text) return;
    setBusy(true);
    try {
      await window.sideboard.sendToThread(thread.id, text);
      setPrompt('');
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function land() {
    const preview = await window.sideboard.previewLand(thread.id);
    setLandPreview(preview);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{thread.title}</h2>
        <span className="thread-meta">{statusLabel}</span>
        <div className="tabs">
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
            Changes
          </button>
        </div>
        <div className="actions">
          {thread.devPort ? (
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(`http://localhost:${thread.devPort}`);
                window.alert(`Dev server: http://localhost:${thread.devPort}`);
              }}
            >
              Dev :{thread.devPort}
            </button>
          ) : hasHook ? (
            <button
              onClick={() =>
                void window.sideboard.runDevScript(thread.id).then(onRefresh).catch(alert)
              }
            >
              Start dev
            </button>
          ) : null}
          <button onClick={() => void window.sideboard.openInEditor(thread.id)}>Open</button>
          <button onClick={() => void window.sideboard.stopThread(thread.id).then(onRefresh)}>
            Stop
          </button>
          <button onClick={() => void land()}>Land</button>
          <button
            onClick={() =>
              void window.sideboard.archiveThread(thread.id).then(onRefresh).catch(alert)
            }
          >
            Archive
          </button>
        </div>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="chat">
            {thread.messages.map((m, i) => (
              <div key={`${m.ts}-${i}`} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {liveOutput && <div className="msg agent">{liveOutput}</div>}
            <div ref={bottomRef} />
          </div>
          <div className="composer">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                thread.status === 'running' || thread.status === 'queued'
                  ? 'Queued when you send…'
                  : 'Message the agent…'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="primary" disabled={busy || !prompt.trim()} onClick={() => void send()}>
              {thread.status === 'running' || thread.status === 'queued' ? 'Queue' : 'Send'}
            </button>
          </div>
        </>
      ) : (
        <Changes
          threadId={thread.id}
          onAskAboutFile={(path) => {
            setPrompt(`Look at the changes in ${path} and suggest next steps.`);
            setTab('chat');
          }}
        />
      )}

      {landPreview && (
        <div className="modal-backdrop" onClick={() => setLandPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Land preview</h3>
            <p>
              <strong>{landPreview.branch}</strong> → {landPreview.target}
            </p>
            <p>Dirty: {landPreview.dirty ? 'yes (will auto-commit)' : 'no'}</p>
            <pre className="diff-view" style={{ maxHeight: 200 }}>
              {landPreview.diffStat}
            </pre>
            {landPreview.blocked && (
              <p style={{ color: 'var(--err)' }}>{landPreview.blockReason}</p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={() => setLandPreview(null)}>Cancel</button>
              <button
                className="primary"
                disabled={landPreview.blocked}
                onClick={() =>
                  void window.sideboard
                    .confirmLand(thread.id)
                    .then((r) => {
                      alert(`PR: ${r.prUrl}`);
                      setLandPreview(null);
                      onRefresh();
                    })
                    .catch((err: unknown) =>
                      alert(err instanceof Error ? err.message : String(err)),
                    )
                }
              >
                Push & PR
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
