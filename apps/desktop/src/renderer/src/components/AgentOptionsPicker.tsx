import { useEffect, useMemo, useState } from 'react';
import type { AgentKind, Autonomy } from '@sideboard-ai/core';
import {
  decodeBrightsyTarget,
  encodeBrightsyTarget,
  type BrightsyChatTarget,
  type BrightsyChatTargets,
} from '@sideboard/brightsy-targets';
import {
  prefetchAgentModels,
  useAgentModels,
  useCursorModels,
} from './CursorModelMenu';

const CLAUDE_MODELS = [
  { id: null as string | null, label: 'Auto' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];

const AGENTS: Array<{ id: AgentKind; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'brightsy', label: 'Brightsy' },
];

const BRIGHTSY_AGENT_LIMIT = 40;

export interface AgentOptionsValue {
  agent: AgentKind;
  model: string | null;
  autonomy: Autonomy;
}

interface Props {
  open: boolean;
  value: AgentOptionsValue;
  onClose: () => void;
  onApply: (next: AgentOptionsValue) => void;
  title?: string;
  /** Primary button label (e.g. "Create tab"). Defaults to "Done". */
  confirmLabel?: string;
}

type CatalogRow = {
  id: string | null;
  label: string;
  description?: string;
};

function defaultModelFor(agent: AgentKind): string | null {
  if (agent === 'cursor') return 'default';
  return null;
}

function modelSelected(
  agent: AgentKind,
  current: string | null,
  id: string | null,
): boolean {
  if (agent === 'cursor') {
    const cur = (current ?? '').trim().toLowerCase();
    const want = (id ?? 'default').trim().toLowerCase();
    if (!cur || cur === 'auto') return want === 'default';
    return cur === want;
  }
  return current === id;
}

/**
 * Unified agent / model / Brightsy / permissions picker (modal).
 * Replaces the stacked FloatingMenu + separate Brightsy dialog.
 */
export function AgentOptionsPicker({
  open,
  value,
  onClose,
  onApply,
  title = 'Choose agent',
  confirmLabel = 'Done',
}: Props) {
  const [agent, setAgent] = useState<AgentKind>(value.agent);
  const [model, setModel] = useState<string | null>(value.model);
  const [autonomy, setAutonomy] = useState<Autonomy>(value.autonomy);
  const [query, setQuery] = useState('');

  const [brightsyTargets, setBrightsyTargets] = useState<BrightsyChatTargets | null>(
    null,
  );
  const [brightsyTeamId, setBrightsyTeamId] = useState<string | null>(null);
  const [brightsyLoading, setBrightsyLoading] = useState(false);
  const [brightsyError, setBrightsyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAgent(value.agent);
    setModel(value.model);
    setAutonomy(value.autonomy);
    setQuery('');
    prefetchAgentModels();
  }, [open, value.agent, value.model, value.autonomy]);

  useEffect(() => {
    if (!open || agent !== 'brightsy') return;
    setBrightsyLoading(true);
    setBrightsyError(null);
    void window.sideboard
      .listBrightsyChatTargets()
      .then((list) => {
        setBrightsyTargets(list);
        const selected = decodeBrightsyTarget(model);
        setBrightsyTeamId(
          selected.accountId ||
            list.activeAccountId ||
            list.teams[0]?.accountId ||
            null,
        );
      })
      .catch((err: unknown) => {
        setBrightsyTargets(null);
        setBrightsyError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBrightsyLoading(false));
    // Reload when switching to Brightsy or reopening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent]);

  const {
    models: cursorModels,
    loading: cursorLoading,
    error: cursorError,
  } = useCursorModels(open && agent === 'cursor');
  const {
    models: codexModels,
    loading: codexLoading,
    error: codexError,
  } = useAgentModels('codex', open && agent === 'codex');
  const {
    models: opencodeModels,
    loading: opencodeLoading,
    error: opencodeError,
  } = useAgentModels('opencode', open && agent === 'opencode');

  const catalog = useMemo((): CatalogRow[] => {
    if (agent === 'claude') {
      return CLAUDE_MODELS.map((m) => ({ id: m.id, label: m.label }));
    }
    if (agent === 'codex') {
      return [
        { id: null, label: 'Auto' },
        ...(codexModels ?? []).map((m) => ({
          id: m.id,
          label: m.displayName,
          description: m.description,
        })),
      ];
    }
    if (agent === 'opencode') {
      return [
        { id: null, label: 'Auto' },
        ...(opencodeModels ?? []).map((m) => ({
          id: m.id,
          label: m.displayName,
          description: m.description,
        })),
      ];
    }
    if (agent === 'cursor') {
      const list = cursorModels ?? [];
      const hasDefault = list.some((m) => m.id === 'default');
      return [
        ...(hasDefault ? [] : [{ id: 'default', label: 'Auto' }]),
        ...list.map((m) => ({
          id: m.id,
          label: m.id === 'default' ? m.displayName || 'Auto' : m.displayName,
          description: m.description,
        })),
      ];
    }
    return [];
  }, [agent, cursorModels, codexModels, opencodeModels]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        (m.id ?? '').toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q),
    );
  }, [catalog, query]);

  const activeTeam = useMemo(() => {
    if (!brightsyTargets?.teams.length) return null;
    return (
      brightsyTargets.teams.find((t) => t.accountId === brightsyTeamId) ??
      brightsyTargets.teams[0] ??
      null
    );
  }, [brightsyTargets, brightsyTeamId]);

  const brightsySelected = decodeBrightsyTarget(agent === 'brightsy' ? model : null);
  const teamAgents = activeTeam?.agents ?? brightsyTargets?.agents ?? [];
  const teamModels = activeTeam?.models ?? brightsyTargets?.models ?? [];

  const filteredBrightsyAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teamAgents;
    return teamAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [teamAgents, query]);

  const filteredBrightsyModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teamModels;
    return teamModels.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q),
    );
  }, [teamModels, query]);

  if (!open) return null;

  function commit(next: AgentOptionsValue) {
    onApply(next);
    onClose();
  }

  function selectAgent(next: AgentKind) {
    setAgent(next);
    setModel(next === value.agent ? value.model : defaultModelFor(next));
    setQuery('');
  }

  function pickModel(id: string | null) {
    commit({ agent, model: id, autonomy });
  }

  function pickBrightsy(target: BrightsyChatTarget) {
    const accountId =
      target.accountId ||
      activeTeam?.accountId ||
      brightsyTargets?.activeAccountId ||
      null;
    let encoded: string | null;
    if (target.type === 'agent' && target.id === 'default' && !accountId) {
      encoded = null;
    } else {
      encoded = encodeBrightsyTarget(target.type, target.id, accountId);
    }
    commit({ agent: 'brightsy', model: encoded, autonomy });
  }

  const catalogLoading =
    (agent === 'cursor' && cursorLoading && !cursorModels) ||
    (agent === 'codex' && codexLoading && !codexModels) ||
    (agent === 'opencode' && opencodeLoading && !opencodeModels);
  const catalogError =
    (agent === 'cursor' && cursorError) ||
    (agent === 'codex' && codexError) ||
    (agent === 'opencode' && opencodeError) ||
    null;

  const showSearch =
    agent === 'brightsy' ||
    agent === 'opencode' ||
    agent === 'cursor' ||
    (agent === 'codex' && (codexModels?.length ?? 0) > 8);

  const showTeamNav = (brightsyTargets?.teams.length ?? 0) > 1;
  const teamIndex = Math.max(
    0,
    brightsyTargets?.teams.findIndex((t) => t.accountId === activeTeam?.accountId) ?? 0,
  );

  function stepTeam(delta: number) {
    if (!brightsyTargets?.teams.length) return;
    const next =
      (teamIndex + delta + brightsyTargets.teams.length) % brightsyTargets.teams.length;
    setBrightsyTeamId(brightsyTargets.teams[next]!.accountId);
    setQuery('');
  }

  const visibleBrightsyAgents = filteredBrightsyAgents.slice(0, BRIGHTSY_AGENT_LIMIT);
  const hiddenBrightsyAgents = Math.max(
    0,
    filteredBrightsyAgents.length - visibleBrightsyAgents.length,
  );

  return (
    <div className="composer-picker-backdrop" onClick={onClose}>
      <div
        className="composer-picker agent-options-picker"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-options-picker-header">
          <div className="agent-options-picker-title">{title}</div>
          <button type="button" className="agent-options-picker-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="composer-picker-team-chips agent-options-agent-chips" role="tablist">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={agent === a.id}
              className={`composer-picker-team-chip${agent === a.id ? ' active' : ''}`}
              onClick={() => selectAgent(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="composer-picker-team-chips agent-options-perm-chips">
          <button
            type="button"
            className={`composer-picker-team-chip${autonomy === 'default' ? ' active' : ''}`}
            onClick={() => setAutonomy('default')}
          >
            Default permissions
          </button>
          <button
            type="button"
            className={`composer-picker-team-chip${autonomy === 'full' ? ' active' : ''}`}
            onClick={() => setAutonomy('full')}
          >
            Full autonomy
          </button>
        </div>

        {agent === 'brightsy' && showTeamNav && (
          <div className="composer-picker-teams">
            <button
              type="button"
              className="composer-picker-team-nav"
              title="Previous team"
              disabled={brightsyLoading}
              onClick={() => stepTeam(-1)}
            >
              ‹
            </button>
            <div className="composer-picker-team-chips" role="tablist" aria-label="Brightsy teams">
              {brightsyTargets!.teams.map((team) => {
                const active = team.accountId === activeTeam?.accountId;
                return (
                  <button
                    key={team.accountId}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`composer-picker-team-chip${active ? ' active' : ''}`}
                    onClick={() => {
                      setBrightsyTeamId(team.accountId);
                      setQuery('');
                    }}
                  >
                    {team.accountSlug || team.accountName}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="composer-picker-team-nav"
              title="Next team"
              disabled={brightsyLoading}
              onClick={() => stepTeam(1)}
            >
              ›
            </button>
          </div>
        )}

        {showSearch && (
          <input
            className="composer-picker-search"
            autoFocus
            placeholder={
              agent === 'brightsy'
                ? activeTeam
                  ? `Search ${activeTeam.accountSlug || activeTeam.accountName}…`
                  : 'Search agents and models…'
                : 'Search models…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          />
        )}

        <div className="agent-options-picker-body">
          {agent !== 'brightsy' && (
            <>
              {catalogLoading && (
                <div className="composer-picker-empty">Loading models…</div>
              )}
              {!catalogLoading && catalogError && (
                <div className="composer-picker-empty">{catalogError}</div>
              )}
              {!catalogLoading && !catalogError && filteredCatalog.length === 0 && (
                <div className="composer-picker-empty">
                  {query.trim() ? 'No matching models' : 'No models'}
                </div>
              )}
              {!catalogLoading &&
                !catalogError &&
                filteredCatalog.map((m) => {
                  const selected = modelSelected(agent, model, m.id);
                  return (
                    <button
                      key={m.id ?? 'auto'}
                      type="button"
                      className={`composer-picker-row${selected ? ' selected' : ''}`}
                      onClick={() => pickModel(m.id)}
                    >
                      <span className="composer-picker-main">
                        <span className="composer-picker-title">
                          {selected ? '✓ ' : ''}
                          {m.label}
                        </span>
                        {m.description && (
                          <span className="composer-picker-sub">{m.description}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </>
          )}

          {agent === 'brightsy' && (
            <>
              {brightsyLoading && (
                <div className="composer-picker-empty">Loading Brightsy targets…</div>
              )}
              {!brightsyLoading && brightsyError && (
                <div className="composer-picker-empty">{brightsyError}</div>
              )}
              {!brightsyLoading && !brightsyError && (
                <>
                  {activeTeam && (
                    <div className="composer-picker-section-label">
                      {activeTeam.accountName}
                      {activeTeam.accountSlug ? ` · @${activeTeam.accountSlug}` : ''}
                    </div>
                  )}
                  {filteredBrightsyModels.length > 0 && (
                    <div className="composer-picker-section">
                      <div className="composer-picker-section-label">Models</div>
                      {filteredBrightsyModels.map((m) => {
                        const isSelected =
                          brightsySelected.type === 'model' &&
                          brightsySelected.id === m.id &&
                          (!brightsySelected.accountId ||
                            brightsySelected.accountId === m.accountId);
                        return (
                          <button
                            key={`m-${m.accountId ?? ''}-${m.id}`}
                            type="button"
                            className={`composer-picker-row${isSelected ? ' selected' : ''}`}
                            onClick={() => pickBrightsy(m)}
                          >
                            <span className="composer-picker-main">
                              <span className="composer-picker-title">
                                {isSelected ? '✓ ' : ''}
                                {m.name}
                              </span>
                              {m.description && (
                                <span className="composer-picker-sub">{m.description}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="composer-picker-section">
                    <div className="composer-picker-section-label">
                      Agents · {filteredBrightsyAgents.length}
                    </div>
                    {visibleBrightsyAgents.length === 0 && (
                      <div className="composer-picker-empty">
                        {query.trim() ? 'No matching agents' : 'No agents found'}
                      </div>
                    )}
                    {visibleBrightsyAgents.map((a) => {
                      const isSelected =
                        brightsySelected.type === 'agent' &&
                        brightsySelected.id === a.id &&
                        (!brightsySelected.accountId ||
                          brightsySelected.accountId === a.accountId);
                      return (
                        <button
                          key={`a-${a.accountId ?? ''}-${a.id}`}
                          type="button"
                          className={`composer-picker-row${isSelected ? ' selected' : ''}`}
                          onClick={() => pickBrightsy(a)}
                        >
                          <span className="composer-picker-main">
                            <span className="composer-picker-title">
                              {isSelected ? '✓ ' : ''}
                              {a.name}
                            </span>
                            {a.description && (
                              <span className="composer-picker-sub">{a.description}</span>
                            )}
                          </span>
                          <span className="composer-picker-hint">{a.id.slice(0, 8)}</span>
                        </button>
                      );
                    })}
                    {hiddenBrightsyAgents > 0 && (
                      <div className="composer-picker-empty">
                        {hiddenBrightsyAgents} more — refine your search
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="agent-options-picker-footer">
          <button
            type="button"
            className="agent-options-picker-done"
            onClick={() => commit({ agent, model, autonomy })}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
