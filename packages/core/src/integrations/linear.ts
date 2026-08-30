import { httpFetch } from '../http/fetch.js';
import type { IssueInfo } from '../types/thread.js';
import { getLinearAuthToken, linearAuthorizationHeader } from './linear-oauth.js';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

/**
 * Linear scores each nested connection as `first` (default 50) × children.
 * A 200-issue list that also pulls `team.states` exceeds the 10k/query cap
 * (`Query too complex`). List only the fields Home / Create-from need;
 * fetch workflow states on single-issue get/create/update.
 */
const LIST_ISSUE_FIELDS = `
  id
  identifier
  title
  url
  assignee { id name }
  team { id key }
  labels(first: 10) { nodes { name } }
  cycle { name number startsAt endsAt completedAt }
`;

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  state { id name type }
  assignee { id name }
  team { id key name states(first: 50) { nodes { id name type } } }
  labels(first: 50) { nodes { name } }
  cycle { name number startsAt endsAt completedAt }
`;

const ASSIGNED_ISSUES_QUERY = `
query SideboardAssignedIssues($first: Int!) {
  viewer {
    id
    name
    assignedIssues(
      first: $first
      orderBy: updatedAt
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) {
      nodes { ${LIST_ISSUE_FIELDS} }
    }
  }
}
`;

const TEAMS_QUERY = `
query SideboardTeams {
  viewer { id name }
  teams(first: 50) {
    nodes {
      id
      key
      name
      states(first: 50) { nodes { id name type } }
    }
  }
}
`;

const ISSUE_QUERY = `
query SideboardIssue($id: String!) {
  issue(id: $id) { ${ISSUE_FIELDS} }
}
`;

const ISSUE_CREATE = `
mutation SideboardIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { ${ISSUE_FIELDS} }
  }
}
`;

const ISSUE_UPDATE = `
mutation SideboardIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { ${ISSUE_FIELDS} }
  }
}
`;

const COMMENT_CREATE = `
mutation SideboardCommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body url }
  }
}
`;

type LinearIssueNode = {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  url?: string;
  priority?: number | null;
  state?: { id?: string; name?: string; type?: string } | null;
  assignee?: { id?: string; name?: string } | null;
  team?: {
    id?: string;
    key?: string;
    name?: string;
    states?: { nodes?: Array<{ id?: string; name?: string; type?: string }> };
  } | null;
  labels?: { nodes?: Array<{ name?: string }> };
  cycle?: {
    id?: string;
    name?: string;
    number?: number;
    startsAt?: string;
    endsAt?: string;
    completedAt?: string | null;
  } | null;
};

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  states: LinearWorkflowState[];
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string;
  priority?: number;
  state?: LinearWorkflowState;
  assignee?: { id: string; name: string };
  team?: { id: string; key: string; name: string; states: LinearWorkflowState[] };
  labels: string[];
  cycle?: { name: string; number?: number; isActive: boolean } | null;
}

export interface LinearComment {
  id: string;
  body: string;
  url?: string;
}

export interface LinearTeamsResult {
  viewer: { id: string; name: string };
  teams: LinearTeam[];
}

type GraphqlJson<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export function rewriteLinearError(message: string): string {
  if (/scope|permission|not (authorized|allowed)|unauthorized|insufficient/i.test(message)) {
    return `${message} — Disconnect and Connect Linear in Account settings to grant write access.`;
  }
  return message;
}

async function requireLinearToken(apiKey?: string | null): Promise<string> {
  const token = (apiKey ?? (await getLinearAuthToken()))?.trim();
  if (!token) {
    throw new Error('Linear is not connected — sign in from Account settings');
  }
  return token;
}

export async function linearGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  opts?: { apiKey?: string | null },
): Promise<T> {
  const apiKey = await requireLinearToken(opts?.apiKey);
  const res = await httpFetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: linearAuthorizationHeader(apiKey),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      rewriteLinearError(
        `Linear API error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      ),
    );
  }

  const json = (await res.json()) as GraphqlJson<T>;
  if (json.errors?.length) {
    throw new Error(
      rewriteLinearError(json.errors.map((e) => e.message ?? 'Linear error').join('; ')),
    );
  }
  if (json.data == null) {
    throw new Error('Linear API returned no data');
  }
  return json.data;
}

function mapState(
  node?: { id?: string; name?: string; type?: string } | null,
): LinearWorkflowState | undefined {
  if (!node?.id) return undefined;
  return {
    id: String(node.id),
    name: String(node.name ?? ''),
    type: String(node.type ?? ''),
  };
}

export function linearCycleIsActive(
  cycle:
    | {
        startsAt?: string;
        endsAt?: string;
        completedAt?: string | null;
      }
    | null
    | undefined,
  now = Date.now(),
): boolean {
  if (!cycle) return false;
  if (cycle.completedAt) return false;
  const start = cycle.startsAt ? Date.parse(cycle.startsAt) : Number.NaN;
  const end = cycle.endsAt ? Date.parse(cycle.endsAt) : Number.NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return true;
}

function mapCycle(
  node: LinearIssueNode['cycle'],
): LinearIssue['cycle'] {
  if (!node?.name && node?.number == null) return null;
  const name = String(node.name ?? (node.number != null ? `Cycle ${node.number}` : '')).trim();
  if (!name) return null;
  return {
    name,
    number: typeof node.number === 'number' ? node.number : undefined,
    isActive: linearCycleIsActive(node),
  };
}

function mapIssue(node: LinearIssueNode): LinearIssue {
  const team = node.team;
  return {
    id: String(node.id ?? node.identifier ?? ''),
    identifier: String(node.identifier ?? node.id ?? ''),
    title: String(node.title ?? ''),
    url: String(node.url ?? ''),
    description: node.description?.trim() || undefined,
    priority: typeof node.priority === 'number' ? node.priority : undefined,
    state: mapState(node.state),
    assignee: node.assignee?.id
      ? { id: String(node.assignee.id), name: String(node.assignee.name ?? '') }
      : undefined,
    team: team?.id
      ? {
          id: String(team.id),
          key: String(team.key ?? ''),
          name: String(team.name ?? ''),
          states: (team.states?.nodes ?? [])
            .map((s) => mapState(s))
            .filter((s): s is LinearWorkflowState => Boolean(s)),
        }
      : undefined,
    labels: (node.labels?.nodes ?? [])
      .map((l) => l.name)
      .filter((n): n is string => Boolean(n)),
    cycle: mapCycle(node.cycle),
  };
}

function toIssueInfo(issue: LinearIssue): IssueInfo {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    labels: issue.labels,
    provider: 'linear',
    assignee: issue.assignee?.name,
    assignees: issue.assignee?.name ? [issue.assignee.name] : undefined,
    cycle: issue.cycle ?? null,
    teamKey: issue.team?.key || undefined,
  };
}

function mapTeam(node: {
  id?: string;
  key?: string;
  name?: string;
  states?: { nodes?: Array<{ id?: string; name?: string; type?: string }> };
}): LinearTeam {
  return {
    id: String(node.id ?? ''),
    key: String(node.key ?? ''),
    name: String(node.name ?? ''),
    states: (node.states?.nodes ?? [])
      .map((s) => mapState(s))
      .filter((s): s is LinearWorkflowState => Boolean(s)),
  };
}

export function resolveLinearTeam(teams: LinearTeam[], team: string): LinearTeam {
  const t = team.trim();
  if (!t) throw new Error('Linear team is required (id, key, or name from linear_list_teams)');
  const lower = t.toLowerCase();
  const found = teams.find(
    (x) => x.id === t || x.key.toLowerCase() === lower || x.name.toLowerCase() === lower,
  );
  if (!found) {
    const keys = teams.map((x) => x.key).filter(Boolean).join(', ') || '(none)';
    throw new Error(`Linear team not found: ${team}. Known keys: ${keys}`);
  }
  return found;
}

export function resolveLinearState(
  team: Pick<LinearTeam, 'key' | 'states'>,
  state: string,
): LinearWorkflowState {
  const s = state.trim();
  if (!s) throw new Error('Linear state is empty');
  const lower = s.toLowerCase();
  const found =
    team.states.find((x) => x.id === s) ||
    team.states.find((x) => x.name.toLowerCase() === lower) ||
    team.states.find((x) => x.type.toLowerCase() === lower);
  if (!found) {
    const available =
      team.states.map((x) => `${x.name} (${x.type})`).join(', ') || '(none)';
    throw new Error(`Linear state not found on ${team.key}: ${state}. Available: ${available}`);
  }
  return found;
}

function normalizePriority(priority: number | undefined): number | undefined {
  if (priority == null) return undefined;
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new Error('Linear priority must be 0 (none), 1 (urgent), 2 (high), 3 (medium), or 4 (low)');
  }
  return priority;
}

export type LinearAssignedIssuesResult = {
  viewer: { id: string; name: string };
  issues: IssueInfo[];
};

/**
 * List open issues assigned to the authenticated Linear user via GraphQL.
 * Uses Sideboard-stored OAuth token or API key (Settings → Issues → Linear), not agent MCP.
 */
export async function listLinearAssignedIssues(
  opts?: { limit?: number; apiKey?: string | null },
): Promise<LinearAssignedIssuesResult> {
  const first = Math.max(1, Math.min(250, opts?.limit ?? 200));
  const json = await linearGraphql<{
    viewer?: {
      id?: string;
      name?: string;
      assignedIssues?: { nodes?: LinearIssueNode[] };
    };
  }>(ASSIGNED_ISSUES_QUERY, { first }, opts);
  return {
    viewer: {
      id: String(json.viewer?.id ?? ''),
      name: String(json.viewer?.name ?? ''),
    },
    issues: (json.viewer?.assignedIssues?.nodes ?? []).map((node) =>
      toIssueInfo(mapIssue(node)),
    ),
  };
}

export async function listLinearIssuesDirect(
  opts?: { limit?: number; apiKey?: string | null },
): Promise<IssueInfo[]> {
  return (await listLinearAssignedIssues(opts)).issues;
}

export async function listLinearTeams(
  opts?: { apiKey?: string | null },
): Promise<LinearTeamsResult> {
  const json = await linearGraphql<{
    viewer?: { id?: string; name?: string };
    teams?: {
      nodes?: Array<{
        id?: string;
        key?: string;
        name?: string;
        states?: { nodes?: Array<{ id?: string; name?: string; type?: string }> };
      }>;
    };
  }>(TEAMS_QUERY, undefined, opts);
  return {
    viewer: {
      id: String(json.viewer?.id ?? ''),
      name: String(json.viewer?.name ?? ''),
    },
    teams: (json.teams?.nodes ?? []).map(mapTeam),
  };
}

export async function getLinearIssue(
  id: string,
  opts?: { apiKey?: string | null },
): Promise<LinearIssue> {
  const issueId = id.trim();
  if (!issueId) throw new Error('Linear issue id is required (uuid or ENG-123)');
  const json = await linearGraphql<{ issue?: LinearIssueNode | null }>(
    ISSUE_QUERY,
    { id: issueId },
    opts,
  );
  if (!json.issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }
  return mapIssue(json.issue);
}

export async function createLinearIssue(
  input: {
    team: string;
    title: string;
    description?: string;
    state?: string;
    assignee?: string | null;
    priority?: number;
  },
  opts?: { apiKey?: string | null },
): Promise<LinearIssue> {
  const title = input.title.trim();
  if (!title) throw new Error('Linear issue title is required');
  const { viewer, teams } = await listLinearTeams(opts);
  const team = resolveLinearTeam(teams, input.team);
  const mutationInput: Record<string, unknown> = {
    teamId: team.id,
    title,
  };
  const description = input.description?.trim();
  if (description) mutationInput.description = description;
  if (input.state?.trim()) {
    mutationInput.stateId = resolveLinearState(team, input.state).id;
  }
  const assignee = input.assignee === undefined ? undefined : input.assignee?.trim() || null;
  if (assignee === 'me') mutationInput.assigneeId = viewer.id;
  else if (assignee) mutationInput.assigneeId = assignee;
  const priority = normalizePriority(input.priority);
  if (priority != null) mutationInput.priority = priority;

  const json = await linearGraphql<{
    issueCreate?: { success?: boolean; issue?: LinearIssueNode | null };
  }>(ISSUE_CREATE, { input: mutationInput }, opts);
  if (!json.issueCreate?.success || !json.issueCreate.issue) {
    throw new Error('Linear issueCreate failed');
  }
  return mapIssue(json.issueCreate.issue);
}

export async function updateLinearIssue(
  input: {
    id: string;
    title?: string;
    description?: string;
    state?: string;
    assignee?: string | null;
    priority?: number;
  },
  opts?: { apiKey?: string | null },
): Promise<LinearIssue> {
  const issueId = input.id.trim();
  if (!issueId) throw new Error('Linear issue id is required (uuid or ENG-123)');
  const mutationInput: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error('Linear issue title cannot be empty');
    mutationInput.title = title;
  }
  if (input.description !== undefined) {
    mutationInput.description = input.description;
  }
  if (input.state?.trim()) {
    const existing = await getLinearIssue(issueId, opts);
    const team = existing.team;
    if (!team?.states.length) {
      throw new Error(`Linear issue ${existing.identifier} has no workflow states to resolve "${input.state}"`);
    }
    mutationInput.stateId = resolveLinearState(team, input.state).id;
  }
  if (input.assignee !== undefined) {
    const assignee = input.assignee?.trim() || null;
    if (assignee === 'me') {
      const { viewer } = await listLinearTeams(opts);
      mutationInput.assigneeId = viewer.id;
    } else {
      mutationInput.assigneeId = assignee;
    }
  }
  if (input.priority !== undefined) {
    mutationInput.priority = normalizePriority(input.priority);
  }
  if (Object.keys(mutationInput).length === 0) {
    throw new Error('linear_update_issue needs at least one of title, description, state, assignee, priority');
  }

  const json = await linearGraphql<{
    issueUpdate?: { success?: boolean; issue?: LinearIssueNode | null };
  }>(ISSUE_UPDATE, { id: issueId, input: mutationInput }, opts);
  if (!json.issueUpdate?.success || !json.issueUpdate.issue) {
    throw new Error('Linear issueUpdate failed');
  }
  return mapIssue(json.issueUpdate.issue);
}

export async function commentLinearIssue(
  input: { id: string; body: string },
  opts?: { apiKey?: string | null },
): Promise<LinearComment> {
  const issueId = input.id.trim();
  const body = input.body.trim();
  if (!issueId) throw new Error('Linear issue id is required (uuid or ENG-123)');
  if (!body) throw new Error('Linear comment body is required');
  const json = await linearGraphql<{
    commentCreate?: { success?: boolean; comment?: { id?: string; body?: string; url?: string } | null };
  }>(COMMENT_CREATE, { input: { issueId, body } }, opts);
  if (!json.commentCreate?.success || !json.commentCreate.comment?.id) {
    throw new Error('Linear commentCreate failed');
  }
  return {
    id: String(json.commentCreate.comment.id),
    body: String(json.commentCreate.comment.body ?? body),
    url: json.commentCreate.comment.url?.trim() || undefined,
  };
}

/** Probe Linear with the stored key (or provided key). */
export async function validateLinearApiKey(apiKey: string): Promise<boolean> {
  const key = apiKey.trim();
  if (!key) return false;
  try {
    await listLinearIssuesDirect({ limit: 1, apiKey: key });
    return true;
  } catch {
    return false;
  }
}
