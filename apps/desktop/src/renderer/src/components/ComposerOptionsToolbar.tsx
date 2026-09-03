import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  AgentKind,
  Autonomy,
  ThinkingEffort,
  ThreadAttachment,
} from '@sideboard-ai/core';
import { decodeBrightsyTarget, type BrightsyChatTargets } from '@sideboard/brightsy-targets';
import { attachmentOpenPath } from '../lib/attachment-path';
import { AgentOptionsPicker } from './AgentOptionsPicker';
import {
  agentModelLabel,
  cursorModelLabel,
  prefetchAgentModels,
  useAgentModels,
  useCursorModels,
} from './CursorModelMenu';
import { LinkIssuePicker, LinkWorkspacePicker } from './ComposerLinkPickers';
import { FloatingMenu } from './FloatingMenu';
import { ThinkingEffortChip } from './ThinkingEffortChip';

export interface ComposerDraftOptions {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
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
  /** Limit agents in the picker (orchestration excludes Brightsy). */
  allowedAgents?: readonly AgentKind[];
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
    case 'code-ref':
      return 'REF';
    default:
      return 'MD';
  }
}

export function ComposerAttachmentChips({
  attachments,
  onRemove,
  onOpen,
  className,
  /** When true (default for read-only chips), image thumbnails open a Mermaid-style modal. */
  expandImages,
}: {
  attachments: ThreadAttachment[];
  /** Omit for read-only chips (e.g. attachments on sent user messages). */
  onRemove?: (id: string) => void;
  /** Open a worktree file tab when a non-image chip is clicked (if resolvable). */
  onOpen?: (path: string) => void;
  className?: string;
  expandImages?: boolean;
}) {
  const removable = Boolean(onRemove);
  const imagesExpand = expandImages ?? !removable;
  const [expanded, setExpanded] = useState<{ src: string; name: string } | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => Boolean(a.previewDataUrl));
  const rest = attachments.filter((a) => !a.previewDataUrl);

  const overlay =
    expanded &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="md-image-overlay"
        role="presentation"
        onClick={() => setExpanded(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={expanded.name}
          className="md-image-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="md-image-close"
            onClick={() => setExpanded(null)}
          >
            Close
          </button>
          <div className="md-image-dialog-body">
            <img src={expanded.src} alt={expanded.name} />
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className={className ? `composer-attachments ${className}` : 'composer-attachments'}>
        {images.length > 0 && (
          <div className="composer-attachment-images">
            {images.map((a) => {
              const openPath = onOpen && !imagesExpand ? attachmentOpenPath(a) : null;
              const canExpand = imagesExpand && Boolean(a.previewDataUrl);
              const interactive = Boolean(openPath || canExpand);
              return (
                <span
                  key={a.id}
                  className={`attachment-image${interactive ? ' is-openable' : ''}`}
                  title={
                    canExpand
                      ? `Expand ${a.name}`
                      : openPath
                        ? `Open ${openPath}`
                        : a.name
                  }
                  role={interactive ? 'button' : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={() => {
                    if (canExpand && a.previewDataUrl) {
                      setExpanded({ src: a.previewDataUrl, name: a.name });
                      return;
                    }
                    if (openPath) onOpen?.(openPath);
                  }}
                  onKeyDown={(e) => {
                    if (!interactive) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (canExpand && a.previewDataUrl) {
                        setExpanded({ src: a.previewDataUrl, name: a.name });
                        return;
                      }
                      if (openPath) onOpen?.(openPath);
                    }
                  }}
                >
                  <img src={a.previewDataUrl} alt={a.name} draggable={false} />
                  {removable && (
                    <button
                      type="button"
                      className="attachment-remove"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove?.(a.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {rest.map((a) => {
          const openPath = onOpen ? attachmentOpenPath(a) : null;
          return (
            <span
              key={a.id}
              className={`attachment-chip${openPath ? ' is-openable' : ''}`}
              title={openPath ? `Open ${openPath}` : a.kind}
              role={openPath ? 'button' : undefined}
              tabIndex={openPath ? 0 : undefined}
              onClick={() => {
                if (openPath) onOpen?.(openPath);
              }}
              onKeyDown={(e) => {
                if (!openPath) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen?.(openPath);
                }
              }}
            >
              <span className={`attachment-icon kind-${a.kind}`}>
                {attachmentIconLabel(a.kind)}
              </span>
              <span className="attachment-name">{a.name}</span>
              {removable && (
                <button
                  type="button"
                  className="attachment-remove"
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove?.(a.id);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {overlay}
    </>
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
  allowedAgents,
}: Props) {
  const isCreate = variant === 'create';
  const [plusOpen, setPlusOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [brightsyTargets, setBrightsyTargets] = useState<BrightsyChatTargets | null>(null);

  useEffect(() => {
    prefetchAgentModels();
  }, []);

  const cursorModelsEnabled = options.agent === 'cursor';
  const { models: cursorModels } = useCursorModels(cursorModelsEnabled);
  const codexModelsEnabled = options.agent === 'codex';
  const { models: codexModels } = useAgentModels('codex', codexModelsEnabled);
  const opencodeModelsEnabled = options.agent === 'opencode';
  const { models: opencodeModels } = useAgentModels('opencode', opencodeModelsEnabled);
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

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
    if (options.agent === 'cursor') {
      return `Cursor · ${cursorModelLabel(options.model, cursorModels)}`;
    }
    if (options.agent === 'codex') {
      return `Codex · ${agentModelLabel(options.model, codexModels, { fallback: 'Codex' })}`;
    }
    if (options.agent === 'opencode') {
      return `OpenCode · ${agentModelLabel(options.model, opencodeModels, { fallback: 'OpenCode' })}`;
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
  }, [options.agent, options.model, brightsyTargets, cursorModels, codexModels, opencodeModels]);

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
            type="button"
            className="chip active"
            title="Choose model / agent"
            onClick={() => {
              setPlusOpen(false);
              setAgentPickerOpen(true);
            }}
          >
            <span className="chip-model-icon" aria-hidden>
              ✦
            </span>
            <span className="chip-label">{modelLabel}</span>
          </button>
          <ThinkingEffortChip
            effort={options.effort}
            onChange={(effort) => patch({ effort })}
          />
          <button
            type="button"
            className={`chip${options.planMode ? ' active plan' : ''}`}
            title="Plan mode — analyze and plan without editing files"
            onClick={() => patch({ planMode: !options.planMode })}
          >
            <span className="chip-plan-icon" aria-hidden>
              ◫
            </span>
            <span className="chip-label">Plan</span>
          </button>
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
                  setAgentPickerOpen(false);
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
      <AgentOptionsPicker
        open={agentPickerOpen}
        value={{
          agent: options.agent,
          model: options.model,
          autonomy: options.autonomy,
          effort: options.effort,
        }}
        title={isCreate ? 'Agent for new chat' : 'Choose agent'}
        allowedAgents={allowedAgents}
        onClose={() => setAgentPickerOpen(false)}
        onApply={(next) => {
          patch({
            agent: next.agent,
            model: next.model,
            autonomy: next.autonomy,
            effort: next.effort,
          });
          if (next.agent === 'brightsy' && next.model) {
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
