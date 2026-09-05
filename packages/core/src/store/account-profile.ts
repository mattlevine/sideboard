/** Account-level roles for ticket / PR recommendations (Settings → Agents). */
export const ACCOUNT_ROLES = ['engineering', 'design', 'product'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  engineering: 'Engineering',
  design: 'Design',
  product: 'Product',
};

export interface AccountProfile {
  /** One or more coded roles — never a combined `both` value. */
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

const ROLE_TEAM_HINTS: Record<AccountRole, string[]> = {
  engineering: ['engineering-team', 'engineering', 'eng-team'],
  design: ['design-team', 'design'],
  product: ['product-team', 'product'],
};

export function isAccountRole(value: string | null | undefined): value is AccountRole {
  const key = (value ?? '').trim().toLowerCase();
  return (ACCOUNT_ROLES as readonly string[]).includes(key);
}

export function normalizeAccountRole(value?: string | null): AccountRole | undefined {
  const key = (value ?? '').trim().toLowerCase();
  if (key === 'both') return undefined;
  return isAccountRole(key) ? key : undefined;
}

export function normalizeAccountRoles(
  roles?: unknown,
  legacyRole?: unknown,
): AccountRole[] {
  const raw = Array.isArray(roles) ? roles : [];
  const out: AccountRole[] = [];
  const seen = new Set<AccountRole>();
  const push = (value: unknown) => {
    const role = normalizeAccountRole(typeof value === 'string' ? value : '');
    if (!role || seen.has(role)) return;
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
    for (const hint of ROLE_TEAM_HINTS[role]) {
      const key = hint.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hint);
    }
  }
  return out;
}

export function resolveAccountProfile(input?: AccountProfile | null): ResolvedAccountProfile {
  const roles = normalizeAccountRoles(input?.roles, input?.role);
  return {
    roles,
    roleLabels: roles.map((role) => ACCOUNT_ROLE_LABELS[role]),
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
