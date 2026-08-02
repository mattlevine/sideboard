import { useEffect, useMemo, useState } from 'react';
import {
  decodeBrightsyTarget,
  encodeBrightsyTarget,
  type BrightsyChatTarget,
  type BrightsyChatTargets,
} from '@sideboard/brightsy-targets';

interface Props {
  open: boolean;
  /** Current Thread.model encoding for Brightsy (`agent:…` / `model:…` / null). */
  currentModel: string | null;
  onClose: () => void;
  onPick: (model: string | null) => void;
}

const AGENT_LIMIT = 40;

export function BrightsyTargetPicker({ open, currentModel, onClose, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<BrightsyChatTargets | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = decodeBrightsyTarget(currentModel);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLoading(true);
    setError(null);
    void window.sideboard
      .listBrightsyChatTargets()
      .then((list) => {
        setTargets(list);
        const preferred =
          selected.accountId ||
          list.activeAccountId ||
          list.teams[0]?.accountId ||
          null;
        setTeamId(preferred);
      })
      .catch((err: unknown) => {
        setTargets(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
    // Only reload when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeTeam = useMemo(() => {
    if (!targets?.teams.length) return null;
    return (
      targets.teams.find((t) => t.accountId === teamId) ??
      targets.teams[0] ??
      null
    );
  }, [targets, teamId]);

  const teamAgents = activeTeam?.agents ?? targets?.agents ?? [];
  const teamModels = activeTeam?.models ?? targets?.models ?? [];

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teamAgents;
    return teamAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [teamAgents, query]);

  const filteredModels = useMemo(() => {
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

  function pick(target: BrightsyChatTarget) {
    const accountId =
      target.accountId || activeTeam?.accountId || targets?.activeAccountId || null;
    if (target.type === 'agent' && target.id === 'default' && !accountId) {
      onPick(null);
    } else {
      onPick(encodeBrightsyTarget(target.type, target.id, accountId));
    }
    onClose();
  }

  const visibleAgents = filteredAgents.slice(0, AGENT_LIMIT);
  const hiddenAgents = Math.max(0, filteredAgents.length - visibleAgents.length);
  const showTeamNav = (targets?.teams.length ?? 0) > 1;
  const teamIndex = Math.max(
    0,
    targets?.teams.findIndex((t) => t.accountId === activeTeam?.accountId) ?? 0,
  );

  function stepTeam(delta: number) {
    if (!targets?.teams.length) return;
    const next =
      (teamIndex + delta + targets.teams.length) % targets.teams.length;
    setTeamId(targets.teams[next]!.accountId);
    setQuery('');
  }

  return (
    <div className="composer-picker-backdrop" onClick={onClose}>
      <div
        className="composer-picker"
        role="dialog"
        aria-label="Choose Brightsy target"
        onClick={(e) => e.stopPropagation()}
      >
        {showTeamNav && (
          <div className="composer-picker-teams">
            <button
              type="button"
              className="composer-picker-team-nav"
              title="Previous team"
              disabled={loading}
              onClick={() => stepTeam(-1)}
            >
              ‹
            </button>
            <div className="composer-picker-team-chips" role="tablist" aria-label="Brightsy teams">
              {targets!.teams.map((team) => {
                const active = team.accountId === activeTeam?.accountId;
                return (
                  <button
                    key={team.accountId}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`composer-picker-team-chip${active ? ' active' : ''}`}
                    onClick={() => {
                      setTeamId(team.accountId);
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
              disabled={loading}
              onClick={() => stepTeam(1)}
            >
              ›
            </button>
          </div>
        )}
        <input
          className="composer-picker-search"
          autoFocus
          placeholder={
            activeTeam
              ? `Search ${activeTeam.accountSlug || activeTeam.accountName}…`
              : 'Search agents and models…'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (showTeamNav && e.key === 'ArrowLeft' && (e.metaKey || e.altKey)) {
              e.preventDefault();
              stepTeam(-1);
            }
            if (showTeamNav && e.key === 'ArrowRight' && (e.metaKey || e.altKey)) {
              e.preventDefault();
              stepTeam(1);
            }
          }}
        />
        {loading && <div className="composer-picker-empty">Loading Brightsy targets…</div>}
        {!loading && error && <div className="composer-picker-empty">{error}</div>}
        {!loading && !error && (
          <>
            {activeTeam && (
              <div className="composer-picker-section-label">
                {activeTeam.accountName}
                {activeTeam.accountSlug ? ` · @${activeTeam.accountSlug}` : ''}
                {showTeamNav
                  ? ` · ${teamIndex + 1}/${targets!.teams.length}`
                  : ''}
              </div>
            )}
            {filteredModels.length > 0 && (
              <div className="composer-picker-section">
                <div className="composer-picker-section-label">Models</div>
                {filteredModels.map((m) => {
                  const isSelected =
                    selected.type === 'model' &&
                    selected.id === m.id &&
                    (!selected.accountId || selected.accountId === m.accountId);
                  return (
                    <button
                      key={`m-${m.accountId ?? ''}-${m.id}`}
                      type="button"
                      className={`composer-picker-row${isSelected ? ' selected' : ''}`}
                      onClick={() => pick(m)}
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
                Agents
                {` · ${filteredAgents.length}`}
              </div>
              {visibleAgents.length === 0 && (
                <div className="composer-picker-empty">
                  {query.trim() ? 'No matching agents' : 'No agents found'}
                </div>
              )}
              {visibleAgents.map((a) => {
                const isSelected =
                  selected.type === 'agent' &&
                  selected.id === a.id &&
                  (!selected.accountId || selected.accountId === a.accountId);
                return (
                  <button
                    key={`a-${a.accountId ?? ''}-${a.id}`}
                    type="button"
                    className={`composer-picker-row${isSelected ? ' selected' : ''}`}
                    onClick={() => pick(a)}
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
              {hiddenAgents > 0 && (
                <div className="composer-picker-empty">
                  {hiddenAgents} more — refine your search
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
