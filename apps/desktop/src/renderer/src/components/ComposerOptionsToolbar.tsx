import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AgentKind,
  Autonomy,
  ThreadAttachment,
} from '@sideboard-ai/core';
import { decodeBrightsyTarget, type BrightsyChatTargets } from '@sideboard/brightsy-targets';
import { BrightsyTargetPicker } from './BrightsyTargetPicker';
import { LinkIssuePicker, LinkWorkspacePicker } from './ComposerLinkPickers';
import { FloatingMenu } from './FloatingMenu';

export interface ComposerDraftOptions {
  agent: AgentKind;
  model: string | null;
  fast: boolean;
  planMode: boolean;
  autonomy: Autonomy;
}

interface Props {
  options: ComposerDraftOptions;
  attachments: ThreadAttachment[];
  onPatchOptions: (patch: Partial<ComposerDraftOptions>) => void;
  onAttachmentsChange: (next: ThreadAttachment[]) => void;
  /** Needed for Link issue; omit to hide that menu item. */
  repoPath?: string;
  menuPlacement?: 'auto' | 'up' | 'down';
  /** Extra controls on the right (e.g. send button). */
  rightSlot?: ReactNode;
  /** Conductor-style create dialog chrome (paperclip, quieter chips). */
  variant?: 'default' | 'create';
}

function attachmentIconLabel(kind: ThreadAttachment['kind']): string {
  switch (kind) {
    case 'issue':
      return 'ISS';
    case 'workspace':
      return 'WS';
    case 'file':
      return 'FILE';
    case 'diff-comment':
      return 'DIFF';
    default:
      return 'MD';
  }
}

export function ComposerAttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ThreadAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="composer-attachments">
      {attachments.map((a) => (
        <span key={a.id} className="attachment-chip" title={a.kind}>
          <span className={`attachment-icon kind-${a.kind}`}>
            {attachmentIconLabel(a.kind)}
          </span>
          <span className="attachment-name">{a.name}</span>
          <button
            type="button"
            className="attachment-remove"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(a.id);
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function ComposerOptionsToolbar({
  options,
  attachments,
  onPatchOptions,
  onAttachmentsChange,
  repoPath,
  menuPlacement = 'auto',
  rightSlot,
  variant = 'default',
}: Props) {
  const isCreate = variant === 'create';
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [brightsyPickerOpen, setBrightsyPickerOpen] = useState(false);
  const [brightsyTargets, setBrightsyTargets] = useState<BrightsyChatTargets | null>(null);
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  const modelLabel = useMemo(() => {
    if (options.agent === 'brightsy') {
      const target = decodeBrightsyTarget(options.model);
      const team =
        brightsyTargets?.teams.find((t) => t.accountId === target.accountId) ?? null;
      const poolAgents = team?.agents ?? brightsyTargets?.agents ?? [];
      const poolModels = team?.models ?? brightsyTargets?.models ?? [];
      const fromList =
        target.type === 'agent'
          ? poolAgents.find((a) => a.id === target.id)
          : poolModels.find((m) => m.id === target.id);
      const teamLabel =
        team?.accountSlug ||
        fromList?.accountSlug ||
        (target.accountId ? target.accountId.slice(0, 6) : null);
      const name =
        fromList?.name ||
        (target.type === 'agent' && target.id === 'default'
          ? 'Default'
          : target.type === 'model'
            ? target.id
            : target.id.slice(0, 8));
      return teamLabel ? `Brightsy · ${teamLabel} · ${name}` : `Brightsy · ${name}`;
    }
    if (options.agent !== 'claude') return options.agent;
    if (!options.model) return 'Auto';
    const labels: Record<string, string> = {
      fable: 'Fable',
      opus: 'Opus',
      sonnet: 'Sonnet',
      haiku: 'Haiku',
    };
    return labels[options.model] ?? options.model;
  }, [options.agent, options.model, brightsyTargets]);

  useEffect(() => {
    if (options.agent !== 'brightsy' || brightsyTargets) return;
    let cancelled = false;
    void window.sideboard
      .listBrightsyChatTargets()
      .then((targets) => {
        if (!cancelled) setBrightsyTargets(targets);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [options.agent, brightsyTargets]);

  function patch(next: Partial<ComposerDraftOptions>) {
    const merged: Partial<ComposerDraftOptions> = { ...next };
    if (next.agent !== undefined && next.agent !== 'claude' && next.model === undefined) {
      // Model aliases are agent-specific (except Brightsy, which sets model itself).
      if (next.agent !== 'brightsy') merged.model = null;
    }
    onPatchOptions(merged);
  }

  async function addAttachmentsFromPicker() {
    setPlusOpen(false);
    const files = await window.sideboard.pickFiles();
    if (files.length === 0) return;
    onAttachmentsChange([...attachments, ...files]);
  }

  function appendAttachments(extra: ThreadAttachment[]) {
    if (extra.length === 0) return;
    onAttachmentsChange([...attachments, ...extra]);
  }

  return (
    <>
      <div
        className={`composer-toolbar${isCreate ? ' create-variant' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
      >
        <div className="composer-left">
          <button
            ref={modelBtnRef}
            type="button"
            className="chip active"
            title="Choose model / agent"
            onClick={() => {
              setPlusOpen(false);
              setModelOpen((v) => !v);
            }}
          >
            <span className="chip-model-icon" aria-hidden>
              ✦
            </span>{' '}
            {modelLabel}
          </button>
          {isCreate ? (
            <button
              type="button"
              className={`chip${options.fast ? ' active fast' : ''}`}
              title={options.fast ? 'Fast mode (lower effort)' : 'High effort'}
              onClick={() => patch({ fast: !options.fast })}
            >
              <span className="chip-effort-icon" aria-hidden>
                ▮▮▮
              </span>{' '}
              {options.fast ? 'Fast' : 'High'}
            </button>
          ) : (
            <button
              type="button"
              className={`chip${options.fast ? ' active fast' : ''}`}
              title="Fast mode (lower effort)"
              onClick={() => patch({ fast: !options.fast })}
            >
              <span className="chip-bolt" aria-hidden>
                ⚡
              </span>{' '}
              Fast
            </button>
          )}
          <button
            type="button"
            className={`chip${options.planMode ? ' active plan' : ''}${isCreate ? ' icon-only' : ''}`}
            title="Plan mode — analyze and plan without editing files"
            onClick={() => patch({ planMode: !options.planMode })}
          >
            <span className="chip-plan-icon" aria-hidden>
              ◫
            </span>
            {isCreate ? null : ' Plan'}
          </button>
          <FloatingMenu
            open={modelOpen}
            onClose={() => setModelOpen(false)}
            anchorRef={modelBtnRef}
            align="left"
            placement={menuPlacement}
            minWidth={260}
          >
            <div className="menu-section">Claude</div>
            {(
              [
                { id: null, label: 'Auto' },
                { id: 'fable', label: 'Fable' },
                { id: 'opus', label: 'Opus' },
                { id: 'sonnet', label: 'Sonnet' },
                { id: 'haiku', label: 'Haiku' },
              ] as const
            ).map((m, i) => (
              <button
                key={m.label}
                type="button"
                className={
                  options.agent === 'claude' && options.model === m.id ? 'selected' : ''
                }
                onClick={() => {
                  setModelOpen(false);
                  patch({ agent: 'claude', model: m.id });
                }}
              >
                <span>
                  {options.agent === 'claude' && options.model === m.id ? '✓ ' : ''}
                  {m.label}
                </span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
            <div className="menu-section">Agents</div>
            <button
              type="button"
              className={options.agent === 'codex' ? 'selected' : ''}
              onClick={() => {
                setModelOpen(false);
                patch({ agent: 'codex', model: null });
              }}
            >
              <span>{options.agent === 'codex' ? '✓ ' : ''}Codex</span>
            </button>
            <button
              type="button"
              className={options.agent === 'opencode' ? 'selected' : ''}
              onClick={() => {
                setModelOpen(false);
                patch({ agent: 'opencode', model: null });
              }}
            >
              <span>{options.agent === 'opencode' ? '✓ ' : ''}OpenCode</span>
            </button>
            <button
              type="button"
              className={options.agent === 'cursor' ? 'selected' : ''}
              onClick={() => {
                setModelOpen(false);
                patch({ agent: 'cursor', model: null });
              }}
            >
              <span>{options.agent === 'cursor' ? '✓ ' : ''}Cursor</span>
            </button>
            <button
              type="button"
              className={options.agent === 'brightsy' ? 'selected' : ''}
              onClick={() => {
                setModelOpen(false);
                setBrightsyPickerOpen(true);
              }}
            >
              <span>{options.agent === 'brightsy' ? '✓ ' : ''}Brightsy</span>
              <kbd>…</kbd>
            </button>
            <div className="menu-section">Permissions</div>
            <button
              type="button"
              className={options.autonomy === 'default' ? 'selected' : ''}
              onClick={() => {
                setModelOpen(false);
                patch({ autonomy: 'default' });
              }}
            >
              <span>Default permissions</span>
            </button>
            <button
              type="button"
              className={options.autonomy === 'full' ? 'selected' : ''}
              onClick={() => {
                setModelOpen(false);
                patch({ autonomy: 'full' });
              }}
            >
              <span>Full autonomy</span>
            </button>
          </FloatingMenu>
        </div>
        <div className="composer-right">
          {isCreate ? (
            <button
              ref={plusBtnRef}
              type="button"
              className="icon-round create-attach-btn"
              title="Add attachment (⌘U)"
              onClick={() => {
                void addAttachmentsFromPicker();
              }}
            >
              <span className="tool-menu-icon paperclip" aria-hidden />
            </button>
          ) : (
            <>
              <button
                ref={plusBtnRef}
                type="button"
                className="icon-round"
                title="More"
                onClick={() => {
                  setModelOpen(false);
                  setPlusOpen((v) => !v);
                }}
              >
                +
              </button>
              <FloatingMenu
                open={plusOpen}
                onClose={() => setPlusOpen(false)}
                anchorRef={plusBtnRef}
                align="right"
                placement={menuPlacement}
                minWidth={240}
              >
                <button
                  type="button"
                  onClick={() => {
                    void addAttachmentsFromPicker();
                  }}
                >
                  <span className="menu-item-label">
                    <span className="tool-menu-icon paperclip" aria-hidden />
                    Add attachment
                  </span>
                  <kbd>⌘U</kbd>
                </button>
                {repoPath ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      setWorkspacePickerOpen(false);
                      setIssuePickerOpen(true);
                    }}
                  >
                    <span className="menu-item-label">
                      <span className="tool-menu-icon menu-issue-icons" aria-hidden>
                        <span className="picker-logo linear tiny" />
                        <span className="picker-logo github tiny" />
                      </span>
                      Link issue
                    </span>
                    <kbd>⌘I</kbd>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen(false);
                    setIssuePickerOpen(false);
                    setWorkspacePickerOpen(true);
                  }}
                >
                  <span className="menu-item-label">
                    <span className="tool-menu-icon" aria-hidden>
                      <span className="picker-folder-in" />
                    </span>
                    Link workspaces
                  </span>
                </button>
              </FloatingMenu>
            </>
          )}
          {rightSlot}
        </div>
      </div>

      {repoPath ? (
        <LinkIssuePicker
          open={issuePickerOpen}
          agent={options.agent}
          repoPath={repoPath}
          onClose={() => setIssuePickerOpen(false)}
          onPick={(att) => appendAttachments([att])}
        />
      ) : null}
      <LinkWorkspacePicker
        open={workspacePickerOpen}
        onClose={() => setWorkspacePickerOpen(false)}
        onPick={(att) => appendAttachments([att])}
      />
      <BrightsyTargetPicker
        open={brightsyPickerOpen}
        currentModel={options.agent === 'brightsy' ? options.model : null}
        onClose={() => setBrightsyPickerOpen(false)}
        onPick={(model) => {
          patch({ agent: 'brightsy', model });
          if (model) {
            void window.sideboard
              .listBrightsyChatTargets()
              .then(setBrightsyTargets)
              .catch(() => undefined);
          }
        }}
      />
    </>
  );
}
