/** Freeform account / project context for finding tickets and review PRs. */
export const PROFILE_NOTES_MAX = 2000;

/** Leftover checkbox slugs folded into notes on read. Never a combined `both`. */
const LEGACY_ROLE_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  design: 'Design',
  product: 'Product',
  qa: 'QA',
};

export interface ViewerProfile {
  /**
   * How to find tickets and PRs to review. Account context applies everywhere;
   * project context adds for that repo. Roles belong in this text, not a
   * separate field.
   */
  notes?: string;
  /** @deprecated Folded into {@link ViewerProfile.notes} on read. */
  roles?: string[];
  /** @deprecated Folded into {@link ViewerProfile.notes} on read. */
  role?: string;
}

/** @deprecated Use {@link ViewerProfile}. */
export type AccountProfile = ViewerProfile;

export interface ResolvedViewerProfile {
  /** Account context, then project context, joined when both exist. */
  notes: string;
  accountNotes: string;
  projectNotes: string;
}

/** @deprecated Use {@link ResolvedViewerProfile}. */
export type ResolvedAccountProfile = ResolvedViewerProfile;

function legacyRoleLabel(role: string): string {
  const known = LEGACY_ROLE_LABELS[role];
  if (known) return known;
  return role
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeLegacyRole(value?: string | null): string | undefined {
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

function legacyRoleLabels(roles?: unknown, legacyRole?: unknown): string[] {
  const raw = Array.isArray(roles) ? roles : [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const role = normalizeLegacyRole(typeof value === 'string' ? value : '');
    if (!role || seen.has(role) || out.length >= 16) return;
    seen.add(role);
    out.push(legacyRoleLabel(role));
  };
  for (const item of raw) push(item);
  if (out.length === 0) push(legacyRole);
  return out;
}

export function normalizeProfileNotes(value?: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, PROFILE_NOTES_MAX);
}

/**
 * Fold leftover Settings role checkboxes into the context textarea once.
 * Skips when notes already start with `Roles:` so a second read does not stack.
 */
export function foldLegacyRolesIntoNotes(
  roles?: unknown,
  legacyRole?: unknown,
  notes?: unknown,
): string {
  const text = normalizeProfileNotes(notes);
  const labels = legacyRoleLabels(roles, legacyRole);
  if (!labels.length) return text;
  if (text.toLowerCase().startsWith('roles:')) return text;
  const prefix = `Roles: ${labels.join(', ')}`;
  return text ? `${prefix}. ${text}` : prefix;
}

export function resolveAccountProfile(input?: ViewerProfile | null): ResolvedViewerProfile {
  return resolveViewerProfile(input);
}

/**
 * Account defaults, with optional per-project additions.
 * Project context stacks after account context. Leftover role checkboxes
 * fold into each side's notes.
 */
export function resolveViewerProfile(
  account?: ViewerProfile | null,
  project?: ViewerProfile | null,
): ResolvedViewerProfile {
  const accountNotes = foldLegacyRolesIntoNotes(
    account?.roles,
    account?.role,
    account?.notes,
  );
  const projectNotes = foldLegacyRolesIntoNotes(
    project?.roles,
    project?.role,
    project?.notes,
  );
  return {
    notes: [accountNotes, projectNotes].filter(Boolean).join('\n'),
    accountNotes,
    projectNotes,
  };
}

function compactNotes(notes: string, max = 160): string {
  const oneLine = notes.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/** One playbook / reminder line, or empty when nothing is set. */
export function formatAccountProfilePlaybookLine(profile: ResolvedViewerProfile): string {
  if (!profile.accountNotes) return '';
  return (
    `- Account context (Settings → Agents): ${compactNotes(profile.accountNotes)}. ` +
    `When they ask to find work, use this with list_issues (tickets) and list_prs(queue=review) (reviews) and show the options. Only create_thread and start when they also asked to start. ` +
    `To change it, show the proposed text, ask_user (Save this context / Do not save), wait, then update_viewer_context(scope=account, confirmed=true).`
  );
}

/** Compact per-project context for the fleet playbook (empty when none). */
export function formatProjectProfilePlaybookLines(
  projects: Array<{ name: string; notes?: string }>,
): string {
  const lines = projects
    .map((project) => {
      const notes = normalizeProfileNotes(project.notes);
      if (!notes) return '';
      return `- ${project.name}: ${compactNotes(notes, 120)}`;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return [
    'Project context (Settings → Projects; adds to account context):',
    ...lines,
  ].join('\n');
}

/** Suffix for list_workspaces / inventory lines (project context only). */
export function formatWorkspaceProfileSuffix(profile: ResolvedViewerProfile): string {
  if (!profile.projectNotes) return '';
  return `  context:${compactNotes(profile.projectNotes, 80)}`;
}

/** First-turn worktree block with current context + how to update it. */
export function formatViewerContextDirective(profile: ResolvedViewerProfile): string {
  const account = profile.accountNotes || '(empty)';
  const project = profile.projectNotes || '(empty — account context applies)';
  return [
    'Viewer context (Settings → Agents / Projects) — how to find this user’s tickets and review PRs:',
    `- Account: ${compactNotes(profile.accountNotes || account, 240)}`,
    `- This project: ${compactNotes(profile.projectNotes || project, 240)}`,
    'To change these, show the proposed text in chat, call ask_user (Save this context / Do not save), wait for the answer, then update_viewer_context with confirmed=true. Never write context without confirmation. get_viewer_context reads the current values.',
  ].join('\n');
}

/** Short resume reminder — do not dump the full notes every turn. */
export function formatViewerContextReminder(): string {
  return 'Viewer context: get_viewer_context to read; update_viewer_context only after ask_user confirms (Save this context / Do not save).';
}
