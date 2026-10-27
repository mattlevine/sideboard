import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AgentKind,
  Autonomy,
  ThinkingEffort,
  ThreadAttachment,
} from '@sideboard-ai/core';
import { decodeBrightsyTarget, type BrightsyChatTargets } from '@sideboard/brightsy-targets';
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
export { ComposerAttachmentChips } from './ComposerAttachmentChips';

export interface ComposerDraftOptions {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  /** Cursor Fast speed tier (~2× for Grok). Ignored for other agents. */
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
  /** Limit agents in the picker (orchestration excludes Brightsy). */
  allowedAgents?: readonly AgentKind[];
  /** ⌘U attach and ⌘I link issue, for composers that are not a live chat. */
  bindShortcuts?: boolean;
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
  bindShortcuts = false,
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

  useEffect(() => {
    if (!bindShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (key === 'u') {
        e.preventDefault();
        void addAttachmentsFromPicker();
        return;
      }
      if (key === 'i' && repoPath) {
        e.preventDefault();
        setPlusOpen(false);
        setWorkspacePickerOpen(false);
        setIssuePickerOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindShortcuts, repoPath, attachments, onAttachmentsChange]);

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
          {options.agent === 'cursor' ? (
            <button
              type="button"
              className={`chip${options.fast ? ' active fast' : ''}`}
              title="Cursor Fast — ~2× usage for Grok and other models that support it. Off uses standard speed."
              onClick={() => patch({ fast: !options.fast })}
            >
              <span className="chip-bolt" aria-hidden>
                ⚡
              </span>{' '}
              <span className="chip-label">Fast</span>
            </button>
          ) : null}
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
          fast: options.fast,
        }}
        title={isCreate ? 'Agent for new chat' : 'Choose agent'}
        allowedAgents={allowedAgents}
        onClose={() => setAgentPickerOpen(false)}
        onLiveChange={(next) => {
          patch({ effort: next.effort, fast: next.fast });
        }}
        onApply={(next) => {
          patch({
            agent: next.agent,
            model: next.model,
            autonomy: next.autonomy,
            effort: next.effort,
            fast: next.fast,
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
