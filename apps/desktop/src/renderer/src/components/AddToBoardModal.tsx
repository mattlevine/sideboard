import { useMemo, useState } from 'react';
import type { Workspace } from '@sideboard-ai/core';
import { pickDefaultRepoPath } from '../lib/home-board';
import { CreateFromPicker, type CreateFromSelection } from './CreateFromPicker';

interface Props {
  workspaces: Workspace[];
  lastUsedRepoPath?: string;
  onClose: () => void;
  onAdded: () => void;
  onOpenAccount?: () => void;
}

export function AddToBoardModal({
  workspaces,
  lastUsedRepoPath = '',
  onClose,
  onAdded,
  onOpenAccount,
}: Props) {
  const defaultRepo = pickDefaultRepoPath(workspaces, lastUsedRepoPath);
  const [repoPath, setRepoPath] = useState(defaultRepo);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const repoName =
    workspaces.find((w) => w.path === repoPath)?.name
    || repoPath.split('/').filter(Boolean).pop()
    || 'Select project';

  const canPick = useMemo(() => Boolean(repoPath) && !busy, [repoPath, busy]);

  async function add(selection: CreateFromSelection) {
    if (!repoPath) {
      setError('Add a workspace first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.sideboard.addBoardItem({
        kind: selection.kind,
        ref: selection.ref,
        repoPath,
        title: selection.title,
        url: selection.kind === 'ticket' || selection.kind === 'pr' ? selection.url : undefined,
        labels: selection.kind === 'ticket' ? selection.labels : undefined,
        provider: selection.kind === 'ticket' ? selection.provider : undefined,
        assignee: selection.kind === 'ticket' ? selection.assignee : undefined,
        cycle: selection.kind === 'ticket' ? selection.cycle : undefined,
        headRefName: selection.kind === 'pr' ? selection.headRefName : undefined,
        author: selection.kind === 'pr' ? selection.author : undefined,
        workspaceCount: workspaces.length,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="modal create-modal"
        role="dialog"
        aria-label="Add to Board"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="create-modal-content">
          <div className="create-header">
            <div className="create-header-left">
              {workspaces.length > 1 ? (
                <select
                  className="board-toolbar-select"
                  value={repoPath}
                  disabled={busy}
                  onChange={(e) => setRepoPath(e.target.value)}
                  aria-label="Workspace"
                >
                  {workspaces.map((w) => (
                    <option key={w.path} value={w.path}>{w.name}</option>
                  ))}
                </select>
              ) : (
                <span className="create-repo-name">{repoName}</span>
              )}
            </div>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
          {error ? <div className="board-card-error">{error}</div> : null}
          {canPick ? (
            <CreateFromPicker
              open
              repoPath={repoPath}
              linearConnected
              onClose={onClose}
              onSelect={(selection) => void add(selection)}
              onOpenAccount={onOpenAccount}
            />
          ) : (
            <div className="composer-picker-empty">Add a workspace first</div>
          )}
        </div>
      </div>
    </div>
  );
}
