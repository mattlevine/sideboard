import { useEffect } from 'react';
import type { AgentKind, Autonomy } from '@sideboard-ai/core';
import {
  AgentModelMenuItems,
  prefetchAgentModels,
  useAgentModels,
  useCursorModels,
} from './CursorModelMenu';

const CLAUDE_MODELS = [
  { id: null, label: 'Auto' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
] as const;

const AGENTS: Array<{ id: AgentKind; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'brightsy', label: 'Brightsy' },
];

export interface AgentOptionsSelection {
  agent: AgentKind;
  model: string | null;
  autonomy: Autonomy;
}

interface Props {
  agent: AgentKind;
  model: string | null;
  autonomy: Autonomy;
  /** Load model catalogs (menu open or agent already selected). */
  enabled?: boolean;
  onSelectAgent: (agent: AgentKind, model: string | null) => void;
  onSelectModel: (model: string | null) => void;
  onSelectAutonomy: (autonomy: Autonomy) => void;
  /** Brightsy opens a separate target picker. */
  onSelectBrightsy: () => void;
}

function defaultModelFor(agent: AgentKind): string | null {
  if (agent === 'cursor') return 'default';
  return null;
}

/**
 * Shared agent / model / permissions menu used by the composer, create/
 * orchestration dialog, and new-tab picker.
 */
export function AgentOptionsMenu({
  agent,
  model,
  autonomy,
  enabled = true,
  onSelectAgent,
  onSelectModel,
  onSelectAutonomy,
  onSelectBrightsy,
}: Props) {
  useEffect(() => {
    if (!enabled) return;
    prefetchAgentModels();
  }, [enabled]);

  const loadModels = enabled;
  const {
    models: cursorModels,
    loading: cursorModelsLoading,
    error: cursorModelsError,
  } = useCursorModels(loadModels && agent === 'cursor');
  const {
    models: codexModels,
    loading: codexModelsLoading,
    error: codexModelsError,
  } = useAgentModels('codex', loadModels && agent === 'codex');
  const {
    models: opencodeModels,
    loading: opencodeModelsLoading,
    error: opencodeModelsError,
  } = useAgentModels('opencode', loadModels && agent === 'opencode');

  return (
    <>
      <div className="menu-section">Agents</div>
      {AGENTS.map((a) => {
        const selected = agent === a.id;
        if (a.id === 'brightsy') {
          return (
            <button
              key={a.id}
              type="button"
              className={selected ? 'selected' : ''}
              onClick={onSelectBrightsy}
            >
              <span>
                {selected ? '✓ ' : ''}
                {a.label}
              </span>
              <kbd>…</kbd>
            </button>
          );
        }
        return (
          <button
            key={a.id}
            type="button"
            className={selected ? 'selected' : ''}
            onClick={() => onSelectAgent(a.id, defaultModelFor(a.id))}
          >
            <span>
              {selected ? '✓ ' : ''}
              {a.label}
            </span>
          </button>
        );
      })}

      {agent !== 'brightsy' && (
        <>
          <div className="menu-section">Model</div>
          {agent === 'claude' &&
            CLAUDE_MODELS.map((m, i) => (
              <button
                key={m.label}
                type="button"
                className={model === m.id ? 'selected' : ''}
                onClick={() => onSelectModel(m.id)}
              >
                <span>
                  {model === m.id ? '✓ ' : ''}
                  {m.label}
                </span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          {agent === 'codex' && (
            <AgentModelMenuItems
              active
              currentModel={model}
              models={codexModels}
              loading={codexModelsLoading}
              error={codexModelsError}
              autoModelId={null}
              onPick={onSelectModel}
            />
          )}
          {agent === 'opencode' && (
            <AgentModelMenuItems
              active
              currentModel={model}
              models={opencodeModels}
              loading={opencodeModelsLoading}
              error={opencodeModelsError}
              autoModelId={null}
              onPick={onSelectModel}
            />
          )}
          {agent === 'cursor' && (
            <AgentModelMenuItems
              active
              currentModel={model}
              models={cursorModels}
              loading={cursorModelsLoading}
              error={cursorModelsError}
              autoModelId="default"
              onPick={(id) => onSelectModel(id || 'default')}
            />
          )}
        </>
      )}

      <div className="menu-section">Permissions</div>
      <button
        type="button"
        className={autonomy === 'default' ? 'selected' : ''}
        onClick={() => onSelectAutonomy('default')}
      >
        <span>{autonomy === 'default' ? '✓ ' : ''}Default permissions</span>
      </button>
      <button
        type="button"
        className={autonomy === 'full' ? 'selected' : ''}
        onClick={() => onSelectAutonomy('full')}
      >
        <span>{autonomy === 'full' ? '✓ ' : ''}Full autonomy</span>
      </button>
    </>
  );
}
