import { httpFetch } from '../http/fetch.js';
import type { IssueActivityComment, IssueInfo } from '../types/thread.js';
import { previewIssueCommentBody } from './issue-since.js';
import { getLinearAuthToken, linearAuthorizationHeader } from './linear-oauth.js';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

/**
 * Linear scores each nested connection as `first` (default 50) × children.
 * A 200-issue list that also pulls `team.states` / `comments` / `relations`
 * exceeds the 10k/query cap (`Query too complex`). List only the fields
 * Home / Create-from need; fetch comments, relations, and the rest of the
 * metadata on single-issue get. Workflow states live on `linear_list_teams`.
 */
const LIST_ISSUE_FIELDS = `
  id
  identifier
  title
  url
  createdAt
  updatedAt
  assignee { id name }
  team { id key }
  labels(first: 10) { nodes { name } }
  cycle { id name number startsAt endsAt completedAt }
`;

const ISSUE_REF_FIELDS = `
  id
  identifier
  title
  url
`;

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  estimate
  dueDate
  branchName
  createdAt
  updatedAt
  completedAt
  state { id name type }
  assignee { id name }
  creator { id name }
  team { id key name }
  labels(first: 50) { nodes { name } }
  cycle { id name number startsAt endsAt completedAt }
  project { id name }
  parent { ${ISSUE_REF_FIELDS} }
  children(first: 25) { nodes { ${ISSUE_REF_FIELDS} } }
  relations(first: 25) {
    nodes {
      type
      relatedIssue { ${ISSUE_REF_FIELDS} }
    }
  }
  inverseRelations(first: 25) {
    nodes {
      type
      issue { ${ISSUE_REF_FIELDS} }
    }
  }
  comments(first: 50) {
    nodes {
      id
      body
      url
      createdAt
      updatedAt
      user { id name }
    }
  }
  attachments(first: 20) {
    nodes { id title url subtitle }
  }
`;

const ASSIGNED_ISSUES_QUERY = `
query SideboardAssignedIssues($first: Int!, $filter: IssueFilter) {
  viewer {
    id
    name
    assignedIssues(
      first: $first
      orderBy: updatedAt
      filter: $filter
    ) {
      nodes { ${LIST_ISSUE_FIELDS} }
    }
  }
}
`;

const COMMENTS_SINCE_QUERY = `
query SideboardCommentsSince($first: Int!, $filter: CommentFilter) {
  viewer { id name }
  comments(first: $first, orderBy: createdAt, filter: $filter) {
    nodes {
      id
      body
      url
      createdAt
      user { id name }
      issue { identifier title url }
    }
  }
}
`;

const ISSUES_QUERY = `
query SideboardIssues($first: Int!, $filter: IssueFilter) {
  viewer { id name }
  issues(first: $first, orderBy: updatedAt, filter: $filter) {
    nodes { ${LIST_ISSUE_FIELDS} }
  }
}
`;

const SEARCH_ISSUES_QUERY = `
query SideboardSearchIssues($term: String!, $first: Int!, $filter: IssueFilter) {
  viewer { id name }
  searchIssues(term: $term, first: $first, includeArchived: false, filter: $filter) {
    nodes { ${LIST_ISSUE_FIELDS} }
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
      activeCycle { id name number startsAt endsAt completedAt }
    }
  }
}
`;

const TEAM_CYCLES_QUERY = `
query SideboardTeamCycles($id: String!) {
  team(id: $id) {
    id
    key
    activeCycle { id name number startsAt endsAt completedAt }
    cycles(first: 40) {
      nodes { id name number startsAt endsAt completedAt }
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

type LinearUserNode = { id?: string; name?: string } | null;

type LinearIssueRefNode = {
  id?: string;
  identifier?: string;
  title?: string;
  url?: string;
} | null;

type LinearIssueNode = {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  url?: string;
  priority?: number | null;
  estimate?: number | null;
  dueDate?: string | null;
  branchName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  state?: { id?: string; name?: string; type?: string } | null;
  assignee?: LinearUserNode;
  creator?: LinearUserNode;
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
  project?: { id?: string; name?: string } | null;
  parent?: LinearIssueRefNode;
  children?: { nodes?: LinearIssueRefNode[] };
  relations?: {
    nodes?: Array<{ type?: string; relatedIssue?: LinearIssueRefNode }>;
  };
  inverseRelations?: {
    nodes?: Array<{ type?: string; issue?: LinearIssueRefNode }>;
  };
  comments?: {
    nodes?: Array<{
      id?: string;
      body?: string;
      url?: string;
      createdAt?: string;
      updatedAt?: string;
      user?: LinearUserNode;
    }>;
  };
  attachments?: {
    nodes?: Array<{ id?: string; title?: string; url?: string; subtitle?: string }>;
  };
};

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
}

export interface LinearCycle {
  id: string;
  name: string;
  number?: number;
  isActive: boolean;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  states: LinearWorkflowState[];
  activeCycle?: LinearCycle | null;
  cycles?: LinearCycle[];
}

export interface LinearIssueRef {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export interface LinearIssueRelation {
  /** Linear relation type from this issue's perspective (blocks, blockedBy, related, duplicate, duplicateOf). */
  type: string;
  issue: LinearIssueRef;
}

export interface LinearIssueComment {
  id: string;
  body: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  user?: { id: string; name: string };
}

export interface LinearIssueAttachment {
  id: string;
  title: string;
  url: string;
  subtitle?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string;
  priority?: number;
  estimate?: number;
  dueDate?: string;
  branchName?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  state?: LinearWorkflowState;
  assignee?: { id: string; name: string };
  creator?: { id: string; name: string };
  team?: { id: string; key: string; name: string; states: LinearWorkflowState[] };
  labels: string[];
  cycle?: { id?: string; name: string; number?: number; isActive: boolean } | null;
  project?: { id: string; name: string };
  parent?: LinearIssueRef;
  children: LinearIssueRef[];
  relations: LinearIssueRelation[];
  comments: LinearIssueComment[];
  attachments: LinearIssueAttachment[];
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

function cycleDisplayName(node: {
  name?: string;
  number?: number;
} | null | undefined): string {
  return String(node?.name ?? (node?.number != null ? `Cycle ${node.number}` : '')).trim();
}

function mapNamedCycle(
  node:
    | {
        id?: string;
        name?: string;
        number?: number;
        startsAt?: string;
        endsAt?: string;
        completedAt?: string | null;
      }
    | null
    | undefined,
): LinearCycle | null {
  if (!node?.id) return null;
  const name = cycleDisplayName(node);
  if (!name) return null;
  return {
    id: String(node.id),
    name,
    number: typeof node.number === 'number' ? node.number : undefined,
    isActive: linearCycleIsActive(node),
  };
}

function mapCycle(
  node: LinearIssueNode['cycle'],
): LinearIssue['cycle'] {
  if (!node?.name && node?.number == null) return null;
  const name = cycleDisplayName(node);
  if (!name) return null;
  return {
    ...(node.id ? { id: String(node.id) } : {}),
    name,
    number: typeof node.number === 'number' ? node.number : undefined,
    isActive: linearCycleIsActive(node),
  };
}

function mapUser(node?: LinearUserNode): { id: string; name: string } | undefined {
  if (!node?.id && !node?.name) return undefined;
  return {
    id: String(node.id ?? ''),
    name: String(node.name ?? ''),
  };
}

function mapIssueRef(node?: LinearIssueRefNode): LinearIssueRef | undefined {
  if (!node?.id && !node?.identifier) return undefined;
  return {
    id: String(node.id ?? node.identifier ?? ''),
    identifier: String(node.identifier ?? node.id ?? ''),
    title: String(node.title ?? ''),
    url: String(node.url ?? ''),
  };
}

/** Incoming inverseRelations use the other issue's type — flip to this issue's view. */
export function flipLinearRelationType(type: string): string {
  switch (type) {
    case 'blocks':
      return 'blockedBy';
    case 'blockedBy':
      return 'blocks';
    case 'duplicate':
      return 'duplicateOf';
    case 'duplicateOf':
      return 'duplicate';
    default:
      return type;
  }
}

function mapRelations(node: LinearIssueNode): LinearIssueRelation[] {
  const out: LinearIssueRelation[] = [];
  for (const rel of node.relations?.nodes ?? []) {
    const issue = mapIssueRef(rel.relatedIssue);
    if (!issue) continue;
    out.push({ type: String(rel.type ?? 'related'), issue });
  }
  for (const rel of node.inverseRelations?.nodes ?? []) {
    const issue = mapIssueRef(rel.issue);
    if (!issue) continue;
    out.push({ type: flipLinearRelationType(String(rel.type ?? 'related')), issue });
  }
  return out;
}

function mapComments(node: LinearIssueNode): LinearIssueComment[] {
  const out: LinearIssueComment[] = [];
  for (const comment of node.comments?.nodes ?? []) {
    const id = String(comment.id ?? '');
    const body = String(comment.body ?? '');
    if (!id && !body) continue;
    out.push({
      id,
      body,
      url: comment.url?.trim() || undefined,
      createdAt: comment.createdAt?.trim() || undefined,
      updatedAt: comment.updatedAt?.trim() || undefined,
      user: mapUser(comment.user),
    });
  }
  return out;
}

function mapAttachments(node: LinearIssueNode): LinearIssueAttachment[] {
  const out: LinearIssueAttachment[] = [];
  for (const attachment of node.attachments?.nodes ?? []) {
    const id = String(attachment.id ?? '');
    const url = String(attachment.url ?? '').trim();
    if (!id && !url) continue;
    out.push({
      id,
      title: String(attachment.title ?? ''),
      url,
      subtitle: attachment.subtitle?.trim() || undefined,
    });
  }
  return out;
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
    estimate: typeof node.estimate === 'number' ? node.estimate : undefined,
    dueDate: node.dueDate?.trim() || undefined,
    branchName: node.branchName?.trim() || undefined,
    createdAt: node.createdAt?.trim() || undefined,
    updatedAt: node.updatedAt?.trim() || undefined,
    completedAt: node.completedAt?.trim() || undefined,
    state: mapState(node.state),
    assignee: mapUser(node.assignee),
    creator: mapUser(node.creator),
    team: team?.id
      ? {
          id: String(team.id),
          key: String(team.key ?? ''),
          name: String(team.name ?? ''),
          states: (team.states?.nodes ?? []).flatMap((s) => {
            const state = mapState(s);
            return state ? [state] : [];
          }),
        }
      : undefined,
    labels: (node.labels?.nodes ?? [])
      .map((l) => l.name)
      .filter((n): n is string => Boolean(n)),
    cycle: mapCycle(node.cycle),
    project: node.project?.id
      ? { id: String(node.project.id), name: String(node.project.name ?? '') }
      : undefined,
    parent: mapIssueRef(node.parent),
    children: (node.children?.nodes ?? []).flatMap((child) => {
      const ref = mapIssueRef(child);
      return ref ? [ref] : [];
    }),
    relations: mapRelations(node),
    comments: mapComments(node),
    attachments: mapAttachments(node),
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
    ...(issue.createdAt ? { createdAt: issue.createdAt } : {}),
    ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
  };
}

function mapTeam(node: {
  id?: string;
  key?: string;
  name?: string;
  states?: { nodes?: Array<{ id?: string; name?: string; type?: string }> };
  activeCycle?: LinearIssueNode['cycle'];
  cycles?: { nodes?: Array<NonNullable<LinearIssueNode['cycle']>> };
}): LinearTeam {
  const cycles = (node.cycles?.nodes ?? []).flatMap((c) => {
    const cycle = mapNamedCycle(c);
    return cycle ? [cycle] : [];
  });
  return {
    id: String(node.id ?? ''),
    key: String(node.key ?? ''),
    name: String(node.name ?? ''),
    states: (node.states?.nodes ?? []).flatMap((s) => {
      const state = mapState(s);
      return state ? [state] : [];
    }),
    activeCycle: mapNamedCycle(node.activeCycle),
    ...(cycles.length ? { cycles } : {}),
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

export function resolveLinearCycle(
  team: Pick<LinearTeam, 'key' | 'activeCycle' | 'cycles'>,
  cycle: string | null,
): string | null {
  if (cycle == null) return null;
  const s = cycle.trim();
  if (!s || /^(none|clear|unschedule|null)$/i.test(s)) return null;
  if (/^(current|active|this)$/i.test(s)) {
    const active =
      team.activeCycle ?? team.cycles?.find((c) => c.isActive);
    if (!active?.id) {
      throw new Error(`Linear team ${team.key} has no active cycle`);
    }
    return active.id;
  }
  const lower = s.toLowerCase();
  const asNumber = Number.parseInt(s, 10);
  const cycles = team.cycles ?? [];
  const found =
    cycles.find((c) => c.id === s) ||
    cycles.find((c) => c.name.toLowerCase() === lower) ||
    (Number.isInteger(asNumber) ? cycles.find((c) => c.number === asNumber) : undefined);
  if (!found) {
    const available =
      cycles.map((c) => (c.number != null ? `${c.name} (${c.number})` : c.name)).join(', ') ||
      '(none)';
    throw new Error(`Linear cycle not found on ${team.key}: ${cycle}. Available: ${available}`);
  }
  return found.id;
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

/** `me`, `unassigned`, `all`, a Linear user id, or a display name. */
export type LinearAssigneeFilter = string;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assigneeFilterKey(assignee?: string | null): string {
  return (assignee ?? '').trim();
}

/**
 * Linear `IssueFilter` for open issues. Default assignee is `me` so existing
 * Home / Create-from callers stay assigned-to-you unless they ask otherwise.
 */
function applyLinearIssueQueryFilter(
  filter: Record<string, unknown>,
  query?: string | null,
): void {
  const term = query?.trim();
  if (!term) return;
  const or: Record<string, unknown>[] = [
    { title: { containsIgnoreCase: term } },
    { description: { containsIgnoreCase: term } },
  ];
  const identifierMatch = term.match(/^[A-Za-z][\w]*-(\d+)$/);
  const asNumber = identifierMatch
    ? Number(identifierMatch[1])
    : /^\d+$/.test(term)
      ? Number(term)
      : NaN;
  if (Number.isFinite(asNumber) && asNumber > 0) {
    or.push({ number: { eq: asNumber } });
  }
  filter.or = or;
}

export function buildLinearIssueFilter(input?: {
  assignee?: string | null;
  updatedSince?: string | null;
  query?: string | null;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    state: { type: { nin: ['completed', 'canceled'] } },
  };
  const since = input?.updatedSince?.trim();
  if (since) filter.updatedAt = { gte: since };
  applyLinearIssueQueryFilter(filter, input?.query);
  const raw = assigneeFilterKey(input?.assignee) || 'me';
  const key = raw.toLowerCase();
  if (key === 'all' || key === '*') return filter;
  if (key === 'unassigned' || key === 'none' || key === 'null') {
    filter.assignee = { null: true };
    return filter;
  }
  if (key === 'me' || key === '@me') {
    // Linear UserFilter.isMe is BooleanComparator, not a bare boolean.
    filter.assignee = { isMe: { eq: true } };
    return filter;
  }
  if (UUID_RE.test(raw)) {
    filter.assignee = { id: { eq: raw } };
    return filter;
  }
  filter.assignee = { name: { eqIgnoreCase: raw } };
  return filter;
}

type LinearListedPayload = {
  viewer?: {
    id?: string;
    name?: string;
    assignedIssues?: { nodes?: LinearIssueNode[] };
  };
  issues?: { nodes?: LinearIssueNode[] };
  searchIssues?: { nodes?: LinearIssueNode[] };
};

function isAssignedToMe(assignee: string): boolean {
  const key = assignee.toLowerCase();
  return key === 'me' || key === '@me';
}

function listedLinearIssues(
  json: LinearListedPayload,
  nodes: LinearIssueNode[] | undefined,
): LinearAssignedIssuesResult {
  return {
    viewer: {
      id: String(json.viewer?.id ?? ''),
      name: String(json.viewer?.name ?? ''),
    },
    issues: (nodes ?? []).map((node) => toIssueInfo(mapIssue(node))),
  };
}

/**
 * List or search open Linear issues. `assignee` is `me` (default when there is
 * no query), `unassigned`, `all`, a user id, or a display name. A query uses
 * Linear `searchIssues` so results are not limited to the current viewer.
 */
export async function listLinearIssuesFiltered(
  opts?: {
    limit?: number;
    apiKey?: string | null;
    assignee?: string | null;
    query?: string;
    updatedSince?: string | null;
  },
): Promise<LinearAssignedIssuesResult> {
  const first = Math.max(1, Math.min(250, opts?.limit ?? 200));
  const query = opts?.query?.trim() ?? '';
  const assignee = assigneeFilterKey(opts?.assignee) || (query ? 'all' : 'me');
  const filter = buildLinearIssueFilter({
    assignee,
    updatedSince: opts?.updatedSince,
  });
  if (query) {
    const json = await linearGraphql<LinearListedPayload>(
      SEARCH_ISSUES_QUERY,
      { term: query, first, filter },
      opts,
    );
    return listedLinearIssues(json, json.searchIssues?.nodes);
  }
  if (isAssignedToMe(assignee)) {
    const json = await linearGraphql<LinearListedPayload>(
      ASSIGNED_ISSUES_QUERY,
      { first, filter },
      opts,
    );
    return listedLinearIssues(json, json.viewer?.assignedIssues?.nodes);
  }
  const json = await linearGraphql<LinearListedPayload>(
    ISSUES_QUERY,
    { first, filter },
    opts,
  );
  return listedLinearIssues(json, json.issues?.nodes);
}

type LinearCommentSinceNode = {
  id?: string;
  body?: string;
  url?: string;
  createdAt?: string;
  user?: LinearUserNode;
  issue?: LinearIssueRefNode;
};

/**
 * Comments created at/after `since` on issues matching the same assignee / search
 * filter. One GraphQL query — do not get_issue each ticket to check for new comments.
 * Pass `issueIdentifiers` (search hits) to keep only those tickets; an empty
 * allowlist means no comments.
 */
export async function listLinearCommentsSince(opts: {
  since: string;
  assignee?: string | null;
  query?: string;
  issueIdentifiers?: string[];
  limit?: number;
  apiKey?: string | null;
}): Promise<IssueActivityComment[]> {
  const first = Math.max(1, Math.min(250, opts.limit ?? 200));
  const query = opts.query?.trim() ?? '';
  const restrictToIssues = opts.issueIdentifiers != null;
  const allowed = new Set(
    (opts.issueIdentifiers ?? []).map((id) => id.trim()).filter(Boolean),
  );
  if (restrictToIssues && allowed.size === 0) return [];
  const assignee = assigneeFilterKey(opts.assignee) || (query ? 'all' : 'me');
  const json = await linearGraphql<{
    comments?: { nodes?: LinearCommentSinceNode[] };
  }>(
    COMMENTS_SINCE_QUERY,
    {
      first,
      filter: {
        createdAt: { gte: opts.since },
        issue: buildLinearIssueFilter({ assignee, query: query || undefined }),
      },
    },
    opts,
  );
  const out: IssueActivityComment[] = [];
  for (const node of json.comments?.nodes ?? []) {
    const identifier = String(node.issue?.identifier ?? '').trim();
    if (restrictToIssues && !allowed.has(identifier)) continue;
    const body = previewIssueCommentBody(String(node.body ?? ''));
    if (!identifier && !body) continue;
    out.push({
      identifier: identifier || String(node.id ?? ''),
      ...(node.issue?.title ? { title: String(node.issue.title) } : {}),
      ...(node.user?.name ? { author: String(node.user.name) } : {}),
      ...(node.createdAt?.trim() ? { createdAt: node.createdAt.trim() } : {}),
      body,
      ...(node.url?.trim() ? { url: node.url.trim() } : {}),
    });
  }
  return out;
}

/**
 * List open issues assigned to the authenticated Linear user via GraphQL.
 * Uses Sideboard-stored OAuth token or API key (Settings → Issues → Linear), not agent MCP.
 */
export async function listLinearAssignedIssues(
  opts?: { limit?: number; apiKey?: string | null },
): Promise<LinearAssignedIssuesResult> {
  return listLinearIssuesFiltered({ ...opts, assignee: 'me' });
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
        activeCycle?: LinearIssueNode['cycle'];
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

export async function listLinearTeamCycles(
  teamId: string,
  opts?: { apiKey?: string | null },
): Promise<Pick<LinearTeam, 'id' | 'key' | 'activeCycle' | 'cycles'>> {
  const json = await linearGraphql<{
    team?: {
      id?: string;
      key?: string;
      activeCycle?: LinearIssueNode['cycle'];
      cycles?: { nodes?: Array<NonNullable<LinearIssueNode['cycle']>> };
    } | null;
  }>(TEAM_CYCLES_QUERY, { id: teamId }, opts);
  if (!json.team?.id) {
    throw new Error(`Linear team not found: ${teamId}`);
  }
  const mapped = mapTeam(json.team);
  return {
    id: mapped.id,
    key: mapped.key,
    activeCycle: mapped.activeCycle,
    cycles: mapped.cycles ?? [],
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
    parent?: string;
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
  const parentRef = input.parent?.trim();
  if (parentRef) {
    const parent = await getLinearIssue(parentRef, opts);
    mutationInput.parentId = parent.id;
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
    /** Cycle name, number, "current"/"active", or "none" to unschedule. */
    cycle?: string | null;
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
  const needsTeam = Boolean(input.state?.trim()) || input.cycle !== undefined;
  const existing = needsTeam ? await getLinearIssue(issueId, opts) : undefined;
  if (input.state?.trim()) {
    const { teams } = await listLinearTeams(opts);
    const teamRef = existing?.team?.key || existing?.team?.id;
    const team = teamRef ? resolveLinearTeam(teams, teamRef) : undefined;
    if (!team?.states.length) {
      throw new Error(`Linear issue ${existing?.identifier ?? issueId} has no workflow states to resolve "${input.state}"`);
    }
    mutationInput.stateId = resolveLinearState(team, input.state).id;
  }
  if (input.cycle !== undefined) {
    const teamId = existing?.team?.id;
    if (!teamId) {
      throw new Error(`Linear issue ${existing?.identifier ?? issueId} has no team to resolve a cycle`);
    }
    const cycles = await listLinearTeamCycles(teamId, opts);
    mutationInput.cycleId = resolveLinearCycle(
      { ...cycles, key: cycles.key || existing?.team?.key || teamId },
      input.cycle,
    );
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
    throw new Error('linear_update_issue needs at least one of title, description, state, assignee, priority, cycle');
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
