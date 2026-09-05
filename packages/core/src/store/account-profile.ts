/** Built-in role slugs shown as Settings checkboxes. More can be added in the UI. */
export const ACCOUNT_ROLE_PRESETS = ['engineering', 'design', 'product'] as const;
export type AccountRolePreset = (typeof ACCOUNT_ROLE_PRESETS)[number];

/** Any kebab-case role slug (presets plus user-added). Never the combined `both`. */
export type AccountRole = string;

/** Coded presets — extra roles are freeform slugs. */
export const ACCOUNT_ROLES = ACCOUNT_ROLE_PRESETS;

export const ACCOUNT_ROLE_MAX = 16;

export const ACCOUNT_ROLE_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  design: 'Design',
  product: 'Product',
  qa: 'QA',
};

export interface AccountProfile {
  /** One or more roles — never a combined `both` value. */
  roles?: AccountRole[];
  /** Legacy single role — folded into `roles` when reading. */
  role?: AccountRole;
}

export interface ResolvedAccountProfile {
  roles: AccountRole[];
  roleLabels: string[];
  /** Team slugs to prefer when listing unclaimed review PRs. */
  reviewTeamHints: string[];
}

const ROLE_TEAM_HINTS: Record<string, string[]> = {
  engineering: ['engineering-team', 'engineering', 'eng-team'],
  design: ['design-team', 'design'],
  product: ['product-team', 'product'],
};

export function accountRoleLabel(role: string): string {
  const known = ACCOUNT_ROLE_LABELS[role];
  if (known) return known;
  return role
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeAccountRole(value?: string | null): AccountRole | undefined {
  const key = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (key === 'both') return undefined;
  if (key.length < 2 || key.length > 40) return undefined;
  if (!/^[a-z][a-z0-9-]*$/.test(key)) return undefined;
  return key;
}

export function isAccountRole(value: string | null | undefined): value is AccountRole {
  return Boolean(normalizeAccountRole(value));
}

export function normalizeAccountRoles(
  roles?: unknown,
  legacyRole?: unknown,
): AccountRole[] {
  const raw = Array.isArray(roles) ? roles : [];
  const out: AccountRole[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const role = normalizeAccountRole(typeof value === 'string' ? value : '');
    if (!role || seen.has(role) || out.length >= ACCOUNT_ROLE_MAX) return;
    seen.add(role);
    out.push(role);
  };
  for (const item of raw) push(item);
  if (out.length === 0) push(legacyRole);
  return out;
}

export function reviewTeamHintsForRoles(roles: AccountRole[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of roles) {
    const hints = ROLE_TEAM_HINTS[role] ?? teamHintsForCustomRole(role);
    for (const hint of hints) {
      const key = hint.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hint);
    }
  }
  return out;
}

function teamHintsForCustomRole(role: string): string[] {
  const slug = role.trim().toLowerCase();
  if (!slug) return [];
  if (slug.endsWith('-team') || slug.endsWith('-squad')) return [slug];
  return [`${slug}-team`, slug];
}

export function resolveAccountProfile(input?: AccountProfile | null): ResolvedAccountProfile {
  const roles = normalizeAccountRoles(input?.roles, input?.role);
  return {
    roles,
    roleLabels: roles.map((role) => accountRoleLabel(role)),
    reviewTeamHints: reviewTeamHintsForRoles(roles),
  };
}

/**
 * Prefer GitHub teams that match the selected account roles. Engineering +
 * Design on both `engineering-team` and `design-team` keeps both lists;
 * Engineering-only drops design-team.
 */
export function preferTeamsForRole(viewerTeams: string[], hints: string[]): string[] {
  const teams = viewerTeams.map((t) => t.trim()).filter(Boolean);
  const want = hints.map((t) => t.trim()).filter(Boolean);
  if (!want.length) return teams;
  if (!teams.length) return want;
  const hintKeys = want.map((t) => t.toLowerCase());
  const matched = teams.filter((team) => {
    const key = team.toLowerCase();
    return hintKeys.some((hint) => key === hint || key.includes(hint) || hint.includes(key));
  });
  return matched.length ? matched : teams;
}

/** One playbook / reminder line, or empty when no roles are selected. */
export function formatAccountProfilePlaybookLine(profile: ResolvedAccountProfile): string {
  if (profile.roleLabels.length === 0) return '';
  return (
    `- Account roles (tickets to work on / PRs to review): ${profile.roleLabels.join(', ')}. ` +
    `Prefer those teams' tickets and PRs. A team review request is not a claim — only an individual reviewer is.`
  );
}
