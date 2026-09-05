import {
  isAbleTimeConnected,
  saveAbleTimeConnection,
} from '../store/app-settings.js';
import type { IssueInfo, ThreadAttachment } from '../types/thread.js';
import {
  callAbleTimeTool,
  normalizeAbleTimeHost,
  rewriteAbleTimeError,
} from './abletime-mcp.js';

const CLOSED_STATES = new Set([
  'done',
  'completed',
  'canceled',
  'cancelled',
  'archived',
  'closed',
]);

export interface AbleTimeComment {
  id?: string;
  body: string;
  url?: string;
  createdAt?: string;
  user?: string;
}

export interface AbleTimeTask {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string;
  state?: string;
  projectId?: string;
  categoryId?: string;
  assignee?: { id?: string; name: string };
  labels: string[];
  comments: AbleTimeComment[];
}

export interface AbleTimeProject {
  id: string;
  name: string;
  categories: Array<{ id: string; name: string }>;
}

export interface AbleTimeViewer {
  name?: string;
  id?: string;
}

export interface AbleTimeOrientation {
  viewer: AbleTimeViewer;
  projects: AbleTimeProject[];
  tasks: AbleTimeTask[];
  raw: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return '';
}

function firstRecord(record: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['data', 'tasks', 'projects', 'items', 'results', 'nodes']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function labelsOf(record: Record<string, unknown>): string[] {
  const raw = record.tags ?? record.labels ?? record.tag_names;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const rec = asRecord(item);
      return rec ? firstString(rec, ['name', 'title', 'label']) : '';
    })
    .filter(Boolean);
}

function commentsOf(record: Record<string, unknown>): AbleTimeComment[] {
  const raw = record.comments ?? record.notes ?? record.discussion;
  const out: AbleTimeComment[] = [];
  for (const item of asList(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const body = firstString(rec, ['body', 'text', 'comment', 'content', 'message']);
    if (!body) continue;
    const user =
      firstString(asRecord(rec.user) ?? asRecord(rec.author), ['name', 'display_name']) ||
      firstString(rec, ['user_name', 'author']);
    const comment: AbleTimeComment = { body };
    const id = firstString(rec, ['id', 'comment_id']);
    if (id) comment.id = id;
    const url = firstString(rec, ['url', 'permalink']);
    if (url) comment.url = url;
    const createdAt = firstString(rec, ['created_at', 'createdAt', 'created']);
    if (createdAt) comment.createdAt = createdAt;
    if (user) comment.user = user;
    out.push(comment);
  }
  return out;
}

function assigneeOf(record: Record<string, unknown>): AbleTimeTask['assignee'] {
  const nested = firstRecord(record, ['assignee', 'assigned_to', 'user', 'owner']);
  const name =
    firstString(nested, ['name', 'display_name', 'full_name', 'email']) ||
    firstString(record, ['assignee_name', 'assigneeName']);
  if (!name) return undefined;
  const id = firstString(nested, ['id', 'user_id']);
  return { id: id || undefined, name };
}

export function taskUrl(task: Pick<AbleTimeTask, 'id' | 'identifier'>, host?: string | null): string {
  const base = normalizeAbleTimeHost(host);
  const slug = encodeURIComponent(task.identifier || task.id);
  return `${base}/tasks/${slug}`;
}

export function mapAbleTimeTask(raw: unknown, host?: string | null): AbleTimeTask | null {
  const record = asRecord(raw);
  if (!record) return null;
  const nested = firstRecord(record, ['task', 'data']) ?? record;
  const id = firstString(nested, ['id', 'task_id', 'taskId']);
  const identifier =
    firstString(nested, ['reference', 'ref', 'identifier', 'key', 'code', 'number']) || id;
  const title = firstString(nested, ['title', 'name']);
  if (!id && !identifier && !title) return null;
  const resolvedId = id || identifier;
  const resolvedIdentifier = identifier || id;
  const url =
    firstString(nested, ['url', 'permalink', 'html_url']) ||
    taskUrl({ id: resolvedId, identifier: resolvedIdentifier }, host);
  return {
    id: resolvedId,
    identifier: resolvedIdentifier,
    title: title || resolvedIdentifier,
    url,
    description: firstString(nested, ['description', 'body', 'details']) || undefined,
    state: firstString(nested, ['state', 'board_state', 'boardState', 'status']) || undefined,
    projectId: firstString(nested, ['project_id', 'projectId']) || firstString(asRecord(nested.project), ['id']) || undefined,
    categoryId:
      firstString(nested, ['category_id', 'categoryId']) ||
      firstString(asRecord(nested.category), ['id']) ||
      undefined,
    assignee: assigneeOf(nested),
    labels: labelsOf(nested),
    comments: commentsOf(nested),
  };
}

export function toAbleTimeIssueInfo(task: AbleTimeTask): IssueInfo {
  return {
    id: task.id || task.identifier,
    identifier: task.identifier,
    title: task.title,
    url: task.url,
    labels: task.labels,
    provider: 'abletime',
    assignee: task.assignee?.name,
    assignees: task.assignee?.name ? [task.assignee.name] : undefined,
  };
}

export function issueAttachmentForAbleTimeTask(task: AbleTimeTask): ThreadAttachment {
  return {
    id: `abletime-${task.id || task.identifier}`,
    name: task.identifier || task.title,
    kind: 'issue',
    content: [
      `Linked issue: ${task.identifier} — ${task.title}`,
      task.url ? `URL: ${task.url}` : null,
      task.labels.length ? `Labels: ${task.labels.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function mapProject(raw: unknown): AbleTimeProject | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = firstString(record, ['id', 'project_id']);
  const name = firstString(record, ['name', 'title']);
  if (!id && !name) return null;
  const categories = asList(record.categories ?? record.category)
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const categoryId = firstString(rec, ['id', 'category_id']);
      const categoryName = firstString(rec, ['name', 'title']);
      if (!categoryId && !categoryName) return null;
      return { id: categoryId || categoryName, name: categoryName || categoryId };
    })
    .filter((item): item is { id: string; name: string } => Boolean(item));
  return { id: id || name, name: name || id, categories };
}

function isOpenTask(task: AbleTimeTask): boolean {
  const state = (task.state ?? '').toLowerCase();
  return !state || !CLOSED_STATES.has(state);
}

export async function getAbleTimeOrientation(opts?: {
  token?: string | null;
  host?: string | null;
}): Promise<AbleTimeOrientation> {
  const raw = await callAbleTimeTool('orientation', {}, opts);
  const record = asRecord(raw);
  const viewerRec =
    firstRecord(record, ['viewer', 'user', 'actor', 'me', 'person']) ?? record;
  const viewer: AbleTimeViewer = {
    id: firstString(viewerRec, ['id', 'user_id']) || undefined,
    name:
      firstString(viewerRec, ['name', 'display_name', 'full_name']) ||
      firstString(record, ['name']) ||
      undefined,
  };
  const projects = asList(
    record?.projects ?? record?.current_projects ?? record?.currentProjects,
  )
    .map(mapProject)
    .filter((item): item is AbleTimeProject => Boolean(item));
  const tasks = asList(record?.tasks ?? record?.active_tasks ?? record?.activeTasks)
    .map((item) => mapAbleTimeTask(item, opts?.host))
    .filter((item): item is AbleTimeTask => Boolean(item));
  return { viewer, projects, tasks, raw };
}

export async function listAbleTimeProjects(opts?: {
  token?: string | null;
  host?: string | null;
}): Promise<AbleTimeProject[]> {
  const raw = await callAbleTimeTool('list_projects', { include_categories: true }, opts);
  return asList(raw)
    .map(mapProject)
    .filter((item): item is AbleTimeProject => Boolean(item));
}

export async function listAbleTimeTasks(opts?: {
  token?: string | null;
  host?: string | null;
  projectId?: string;
  query?: string;
  includeClosed?: boolean;
}): Promise<AbleTimeTask[]> {
  const args: Record<string, unknown> = {};
  if (opts?.projectId) {
    args.project_id = opts.projectId;
    args.project = opts.projectId;
  }
  if (opts?.query) args.query = opts.query;
  const raw = await callAbleTimeTool('list_tasks', args, opts);
  const tasks = asList(raw)
    .map((item) => mapAbleTimeTask(item, opts?.host))
    .filter((item): item is AbleTimeTask => Boolean(item));
  return opts?.includeClosed ? tasks : tasks.filter(isOpenTask);
}

export async function searchAbleTimeTasks(
  query: string,
  opts?: { token?: string | null; host?: string | null },
): Promise<AbleTimeTask[]> {
  const q = query.trim();
  if (!q) return [];
  const raw = await callAbleTimeTool('search_tasks', { query: q, q }, opts);
  return asList(raw)
    .map((item) => mapAbleTimeTask(item, opts?.host))
    .filter((item): item is AbleTimeTask => Boolean(item))
    .filter(isOpenTask);
}

export async function getAbleTimeTask(
  id: string,
  opts?: { token?: string | null; host?: string | null },
): Promise<AbleTimeTask> {
  const raw = await callAbleTimeTool('get_task', { id, task_id: id }, opts);
  const task = mapAbleTimeTask(raw, opts?.host);
  if (!task) throw new Error(`AbleTime task not found: ${id}`);
  return task;
}

export async function createAbleTimeTask(
  input: {
    title: string;
    description?: string;
    projectId?: string;
    categoryId?: string;
    state?: 'backlog' | 'todo';
    parent?: string;
  },
  opts?: { token?: string | null; host?: string | null },
): Promise<AbleTimeTask> {
  const title = input.title.trim();
  if (!title) throw new Error('AbleTime task title is required');
  const project = await resolveAbleTimeProject(input.projectId, opts);
  const category = resolveAbleTimeCategory(project, input.categoryId);
  const parent = input.parent?.trim();
  const descriptionParts = [
    parent ? `Spin-off of ${parent}.` : null,
    input.description?.trim() || null,
  ].filter(Boolean);
  const raw = await callAbleTimeTool(
    'create_task',
    {
      title,
      description: descriptionParts.join('\n\n') || undefined,
      state: input.state ?? 'todo',
      project: project.id,
      project_id: project.id,
      category: category?.id,
      category_id: category?.id,
      parent,
      parent_id: parent,
      related_task_id: parent,
    },
    opts,
  );
  const task = mapAbleTimeTask(raw, opts?.host);
  if (!task) throw new Error('AbleTime create_task returned no task');
  return task;
}

export async function commentAbleTimeTask(
  input: { id: string; body: string },
  opts?: { token?: string | null; host?: string | null },
): Promise<{ id?: string; body: string }> {
  const id = input.id.trim();
  const body = input.body.trim();
  if (!id) throw new Error('AbleTime task id is required');
  if (!body) throw new Error('AbleTime comment body is required');
  const raw = await callAbleTimeTool(
    'create_comment',
    { id, task_id: id, task: id, body, comment: body, text: body },
    opts,
  );
  const rec = asRecord(raw);
  return {
    id: rec ? firstString(rec, ['id', 'comment_id']) || undefined : undefined,
    body: rec ? firstString(rec, ['body', 'text', 'comment']) || body : body,
  };
}

export async function updateAbleTimeTask(
  input: { id: string; title?: string; description?: string; state?: string },
  opts?: { token?: string | null; host?: string | null },
): Promise<AbleTimeTask> {
  const id = input.id.trim();
  if (!id) throw new Error('AbleTime task id is required');
  const title = input.title?.trim();
  const description = input.description;
  const state = input.state?.trim();
  if (!title && description === undefined && !state) {
    throw new Error('abletime_update_task needs at least one of title, description, state');
  }
  if (state) {
    await callAbleTimeTool(
      'set_task_state',
      { id, task_id: id, task: id, state },
      opts,
    ).catch(async () => {
      await callAbleTimeTool(
        'update_task',
        { id, task_id: id, title, description, state },
        opts,
      );
    });
  }
  if (title || description !== undefined) {
    await callAbleTimeTool(
      'update_task',
      {
        id,
        task_id: id,
        ...(title ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
      },
      opts,
    );
  }
  return getAbleTimeTask(id, opts);
}

async function resolveAbleTimeProject(
  projectId?: string,
  opts?: { token?: string | null; host?: string | null },
): Promise<AbleTimeProject> {
  const wanted = projectId?.trim().toLowerCase();
  const fromOrientation = (await getAbleTimeOrientation(opts).catch(() => null))?.projects ?? [];
  const listed = fromOrientation.length > 0 ? fromOrientation : await listAbleTimeProjects(opts);
  if (listed.length === 0) {
    throw new Error(
      rewriteAbleTimeError(
        'AbleTime has no projects to create a task in — create a project in AbleTime first.',
      ),
    );
  }
  if (!wanted) return listed[0]!;
  const found = listed.find(
    (project) =>
      project.id.toLowerCase() === wanted || project.name.toLowerCase() === wanted,
  );
  if (!found) {
    const names = listed.map((project) => project.name).join(', ') || '(none)';
    throw new Error(`AbleTime project not found: ${projectId}. Known: ${names}`);
  }
  return found;
}

function resolveAbleTimeCategory(
  project: AbleTimeProject,
  categoryId?: string,
): { id: string; name: string } | undefined {
  if (project.categories.length === 0) return undefined;
  const wanted = categoryId?.trim().toLowerCase();
  if (!wanted) return project.categories[0];
  return (
    project.categories.find(
      (category) =>
        category.id.toLowerCase() === wanted || category.name.toLowerCase() === wanted,
    ) ?? project.categories[0]
  );
}

function titlesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Find an open AbleTime task for this work, or create one to track against.
 * Matches identifier or exact title before creating.
 */
export async function ensureAbleTimeTask(
  input: {
    title: string;
    description?: string;
    projectId?: string;
    categoryId?: string;
  },
  opts?: { token?: string | null; host?: string | null },
): Promise<AbleTimeTask & { created: boolean }> {
  const title = input.title.trim();
  if (!title) throw new Error('AbleTime task title is required');

  const searched = await searchAbleTimeTasks(title, opts).catch(() => []);
  const exact =
    searched.find((task) => titlesMatch(task.identifier, title)) ||
    searched.find((task) => titlesMatch(task.title, title));
  if (exact) return { ...exact, created: false };

  const created = await createAbleTimeTask(
    {
      title,
      description: input.description,
      projectId: input.projectId,
      categoryId: input.categoryId,
      state: 'todo',
    },
    opts,
  );
  return { ...created, created: true };
}

export type AbleTimeAssignedIssuesResult = {
  viewer: AbleTimeViewer;
  issues: IssueInfo[];
};

export async function listAbleTimeAssignedIssues(opts?: {
  token?: string | null;
  host?: string | null;
}): Promise<AbleTimeAssignedIssuesResult> {
  if (!opts?.token && !isAbleTimeConnected()) {
    throw new Error('AbleTime is not connected — paste a personal access token in Account settings');
  }
  const [orientation, listed] = await Promise.all([
    getAbleTimeOrientation(opts).catch(() => null),
    listAbleTimeTasks(opts),
  ]);
  const issues = listed.map(toAbleTimeIssueInfo);
  return {
    viewer: orientation?.viewer ?? {},
    issues,
  };
}

export async function verifyAbleTimeConnection(input: {
  token: string;
  host?: string | null;
}): Promise<AbleTimeViewer> {
  const token = input.token.trim();
  if (!token) throw new Error('AbleTime personal access token is required');
  const host = input.host?.trim() || undefined;
  const orientation = await getAbleTimeOrientation({ token, host });
  saveAbleTimeConnection({
    accessToken: token,
    host,
    viewerName: orientation.viewer.name,
  });
  return orientation.viewer;
}
