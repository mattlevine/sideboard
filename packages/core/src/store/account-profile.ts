/** Built-in role slugs shown as Settings checkboxes. More can be added in the UI. */
export const ACCOUNT_ROLE_PRESETS = ['engineering', 'design', 'product'] as const;
export type AccountRolePreset = (typeof ACCOUNT_ROLE_PRESETS)[number];

/** Any kebab-case role slug (presets plus user-added). Never the combined `both`. */
export type AccountRole = string;

/** Coded presets — extra roles are freeform slugs. */
export const ACCOUNT_ROLES = ACCOUNT_ROLE_PRESETS;

export const ACCOUNT_ROLE_MAX = 16;

export const PROFILE_NOTES_MAX = 2000;

export const ACCOUNT_ROLE_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  design: 'Design',
  product: 'Product',
  qa: 'QA',
};

/** Roles + freeform notes for finding tickets / review PRs. */
export interface ViewerProfile {
  /** One or more roles — never a combined `both` value. */
  roles?: AccountRole[];
  /** Legacy single role — folded into `roles` when reading. */
  role?: AccountRole;
  /**
   * How to find tickets to work on and PRs to review (labels, teams, assignee
   * rules). Account notes apply everywhere; project notes add for that repo.
   */
  notes?: string;
}

/** @deprecated Use {@link ViewerProfile}. */
export type AccountProfile = ViewerProfile;

export interface ResolvedViewerProfile {
  roles: AccountRole[];
  roleLabels: string[];
  /** Team slugs to prefer when listing unclaimed review PRs. */
  reviewTeamHints: string[];
  /** Account notes, then project notes, joined when both exist. */
  notes: string;
  accountNotes: string;
  projectNotes: string;
  /** True when this repo set its own roles (does not inherit account). */
  rolesFromProject: boolean;
}

/** @deprecated Use {@link ResolvedViewerProfile}. */
export type ResolvedAccountProfile = ResolvedViewerProfile;

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

export function normalizeProfileNotes(value?: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, PROFILE_NOTES_MAX);
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

export function resolveAccountProfile(input?: ViewerProfile | null): ResolvedViewerProfile {
  return resolveViewerProfile(input);
}

/**
 * Account defaults, with optional per-project overrides.
 * Project roles replace account roles when set; notes stack (account then project).
 */
export function resolveViewerProfile(
  account?: ViewerProfile | null,
  project?: ViewerProfile | null,
): ResolvedViewerProfile {
  const accountRoles = normalizeAccountRoles(account?.roles, account?.role);
  const projectRoles = normalizeAccountRoles(project?.roles, project?.role);
  const rolesFromProject = projectRoles.length > 0;
  const roles = rolesFromProject ? projectRoles : accountRoles;
  const accountNotes = normalizeProfileNotes(account?.notes);
  const projectNotes = normalizeProfileNotes(project?.notes);
  const notes = [accountNotes, projectNotes].filter(Boolean).join('\n');
  return {
    roles,
    roleLabels: roles.map((role) => accountRoleLabel(role)),
    reviewTeamHints: reviewTeamHintsForRoles(roles),
    notes,
    accountNotes,
    projectNotes,
    rolesFromProject,
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

function compactNotes(notes: string, max = 160): string {
  const oneLine = notes.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/** One playbook / reminder line, or empty when nothing is set. */
export function formatAccountProfilePlaybookLine(profile: ResolvedViewerProfile): string {
  if (profile.roleLabels.length === 0 && !profile.notes) return '';
  const parts: string[] = [];
  if (profile.roleLabels.length) {
    parts.push(
      `roles ${profile.roleLabels.join(', ')} (tickets to work on / PRs to review; prefer those teams)`,
    );
  }
  if (profile.notes) {
    parts.push(`notes: ${compactNotes(profile.notes)}`);
  }
  return (
    `- Viewer profile: ${parts.join('. ')}. ` +
    `A team review request is not a claim — only an individual reviewer is. ` +
    `When they ask to find work, use these notes with list_issues (tickets) and list_prs(queue=review) (reviews), then create_thread and start the work.`
  );
}

/** Compact per-project overrides for the fleet playbook (empty when none). */
export function formatProjectProfilePlaybookLines(
  projects: Array<{ name: string; notes?: string; roleLabels?: string[] }>,
): string {
  const lines = projects
    .map((project) => {
      const roles = (project.roleLabels ?? []).filter(Boolean);
      const notes = normalizeProfileNotes(project.notes);
      if (!roles.length && !notes) return '';
      const bits: string[] = [];
      if (roles.length) bits.push(`roles ${roles.join(', ')}`);
      if (notes) bits.push(compactNotes(notes, 120));
      return `- ${project.name}: ${bits.join('. ')}`;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return ['Project overrides (Settings → Projects; empty roles inherit account):', ...lines].join(
    '\n',
  );
}

/** Suffix for list_workspaces / inventory lines (resolved roles + project notes). */
export function formatWorkspaceProfileSuffix(profile: ResolvedViewerProfile): string {
  const bits: string[] = [];
  if (profile.roles.length) bits.push(`roles:${profile.roles.join(',')}`);
  if (profile.projectNotes) bits.push(`notes:${compactNotes(profile.projectNotes, 80)}`);
  return bits.length ? `  ${bits.join('  ')}` : '';
}
