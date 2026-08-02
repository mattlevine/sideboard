/**
 * Pure Brightsy chat-target helpers — safe to import from the Electron renderer
 * (no Node / execa deps).
 */

export type BrightsyChatTarget = {
  type: 'agent' | 'model';
  id: string;
  name: string;
  description?: string | null;
  accountId?: string;
  accountSlug?: string;
  accountName?: string;
};

export type BrightsyTeamTargets = {
  accountId: string;
  accountSlug: string;
  accountName: string;
  agents: BrightsyChatTarget[];
  models: BrightsyChatTarget[];
};

export type BrightsyChatTargets = {
  /** Per connected-team agent/model lists for the composer picker. */
  teams: BrightsyTeamTargets[];
  /** Flat lists (active / first team) — backward compatible. */
  agents: BrightsyChatTarget[];
  models: BrightsyChatTarget[];
  activeAccountId: string | null;
};

export type DecodedBrightsyTarget = {
  type: 'agent' | 'model';
  id: string;
  /** Team that owns this target (when encoded). */
  accountId?: string;
};

/** Encode a Brightsy target into Thread.model (`agent:…` / `model:…` / `team:…:agent:…`). */
export function encodeBrightsyTarget(
  type: 'agent' | 'model',
  id: string,
  accountId?: string | null,
): string {
  if (accountId) return `team:${accountId}:${type}:${id}`;
  return `${type}:${id}`;
}

/** Decode Thread.model for Brightsy turns. null/`default` → platform default agent. */
export function decodeBrightsyTarget(
  model: string | null | undefined,
): DecodedBrightsyTarget {
  const raw = model?.trim();
  if (!raw || raw === 'default' || raw === 'agent:default') {
    return { type: 'agent', id: 'default' };
  }

  const teamMatch = raw.match(/^team:([^:]+):(agent|model):(.+)$/);
  if (teamMatch) {
    return {
      type: teamMatch[2] as 'agent' | 'model',
      id: teamMatch[3] || 'default',
      accountId: teamMatch[1],
    };
  }

  if (raw.startsWith('agent:')) {
    return { type: 'agent', id: raw.slice('agent:'.length) || 'default' };
  }
  if (raw.startsWith('model:')) {
    return { type: 'model', id: raw.slice('model:'.length) };
  }
  // Backward compat: bare UUIDs / ids were treated as agent ids.
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(raw) || raw === 'default') {
    return { type: 'agent', id: raw };
  }
  // Bare model slug (e.g. claude_sonnet_latest).
  return { type: 'model', id: raw };
}
