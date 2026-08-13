import { useCallback, useEffect, useState } from 'react';
import type { PrStack, Thread } from '@sideboard-ai/core';

interface Props {
  thread: Thread;
  onRefresh: () => void;
  onSelectChat?: (id: string, created?: Thread) => void;
}

/** Compact stack map for the right sidebar (Conductor / gh-stack style). */
export function StackMap({ thread, onRefresh, onSelectChat }: Props) {
  const [stack, setStack] = useState<PrStack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBranch, setAddBranch] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await window.sideboard.getPrStack(thread.id);
      setStack(next);
      setError(null);
    } catch (err) {
      setStack(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [thread.id]);

  useEffect(() => {
    void load();
  }, [load, thread.branchName, thread.prUrl, thread.stackId]);

  if (!stack) {
    if (!error) return null;
    return (
      <div className="stack-map stack-map-empty">
        <p className="stack-map-error">{error}</p>
      </div>
    );
  }

  async function focusLayer(position: number) {
    setBusy(true);
    setError(null);
    try {
      const { threads } = await window.sideboard.openPrStackLayers(thread.id, {
        layer: position,
      });
      const target = threads[0];
      if (target) onSelectChat?.(target.id, target);
      onRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openAll() {
    setBusy(true);
    setError(null);
    try {
      await window.sideboard.openPrStackLayers(thread.id);
      onRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addLayer() {
    const name = addBranch.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const { thread: created } = await window.sideboard.addStackLayer(
        thread.id,
        name,
      );
      setAddOpen(false);
      setAddBranch('');
      onSelectChat?.(created.id, created);
      onRefresh();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const label =
    stack.stackNumber != null ? `Stack #${stack.stackNumber}` : 'Stack';

  return (
    <div className="stack-map">
      <div className="stack-map-header">
        <span className="stack-map-title">{label}</span>
        <div className="stack-map-actions">
          <button
            type="button"
            className="stack-map-action"
            disabled={busy}
            onClick={() => void openAll()}
            title="Open a worktree for every layer"
          >
            Open all
          </button>
          <button
            type="button"
            className="stack-map-action"
            disabled={busy}
            onClick={() => setAddOpen((v) => !v)}
          >
            Add layer
          </button>
        </div>
      </div>
      <ol className="stack-map-layers">
        {[...stack.layers].reverse().map((layer) => {
          const current =
            layer.position === thread.stackLayer || layer.isCurrent;
          const pr =
            layer.prNumber != null ? `#${layer.prNumber}` : layer.branchName;
          const queued =
            !layer.isMerged &&
            (layer.isQueued || (layer.prState ?? '').toUpperCase() === 'QUEUED');
          return (
            <li key={`${layer.position}-${layer.branchName}`}>
              <button
                type="button"
                className={`stack-map-layer${current ? ' is-current' : ''}${
                  layer.isMerged ? ' is-merged' : ''
                }${queued ? ' is-queued' : ''}${layer.needsRebase ? ' needs-rebase' : ''}`}
                disabled={busy}
                onClick={() => void focusLayer(layer.position)}
                title={
                  layer.needsRebase
                    ? `${pr} needs rebase`
                    : queued
                      ? `${pr} in merge queue`
                    : layer.title || layer.branchName
                }
              >
                <span className="stack-map-pos">L{layer.position}</span>
                <span className="stack-map-pr">{pr}</span>
                {layer.needsRebase ? (
                  <span className="stack-map-badge">rebase</span>
                ) : null}
                {queued ? (
                  <span className="stack-map-badge">queued</span>
                ) : null}
                {layer.isMerged ? (
                  <span className="stack-map-badge">merged</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="stack-map-trunk">→ {stack.trunk}</p>
      {!stack.readyToMerge && stack.blockedReason ? (
        <p className="stack-map-blocked">{stack.blockedReason}</p>
      ) : (
        <p className="stack-map-ready">Ready to merge through current layer</p>
      )}
      {addOpen ? (
        <div className="stack-map-add">
          <input
            value={addBranch}
            onChange={(e) => setAddBranch(e.target.value)}
            placeholder="new-layer-branch"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addLayer();
            }}
          />
          <button
            type="button"
            className="stack-map-action"
            disabled={busy || !addBranch.trim()}
            onClick={() => void addLayer()}
          >
            Add
          </button>
        </div>
      ) : null}
      {error ? <p className="stack-map-error">{error}</p> : null}
    </div>
  );
}
