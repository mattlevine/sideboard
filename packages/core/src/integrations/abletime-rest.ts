import { httpFetch } from '../http/fetch.js';
import { getAbleTimeAccessToken, getAbleTimeHost } from '../store/app-settings.js';
import {
  DEFAULT_ABLETIME_HOST,
  ableTimeCredentialKind,
  normalizeAbleTimeCredential,
  normalizeAbleTimeHost,
  rewriteAbleTimeError,
  type AbleTimeMcpToolName,
} from './abletime-mcp.js';

export const ABLETIME_REST_PREFIX = '/api/public/v2';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

type RestOpts = { token?: string | null; host?: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['data', 'tasks', 'projects', 'users', 'items', 'results']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

/** ProseMirror-style doc AbleTime REST expects for description / comments. */
export function ableTimeDocFromText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return { type: 'doc', content: [] };
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }],
  };
}

export function textFromAbleTimeDoc(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';
  if (typeof record.text === 'string' && record.text.trim()) return record.text.trim();
  const chunks: string[] = [];
  const walk = (node: unknown) => {
    const rec = asRecord(node);
    if (!rec) return;
    if (typeof rec.text === 'string' && rec.text) chunks.push(rec.text);
    if (Array.isArray(rec.content)) rec.content.forEach(walk);
  };
  walk(record);
  return chunks.join('').trim();
}

export function abletimeRestUrl(
  path: string,
  host?: string | null,
  query?: Record<string, string | undefined>,
): string {
  const base = `${normalizeAbleTimeHost(host)}${ABLETIME_REST_PREFIX}`;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url.href;
}

export function looksLikeAbleTimeUlid(id: string): boolean {
  return ULID_RE.test(id.trim());
}

async function abletimeRestRequest(
  path: string,
  opts: RestOpts & {
    method?: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const raw = opts.token ?? getAbleTimeAccessToken();
  const token = normalizeAbleTimeCredential(raw ?? '');
  if (!token) {
    throw new Error('AbleTime is not connected — paste an API key or personal access token in Account settings');
  }
  const host = opts.host ?? (opts.token ? DEFAULT_ABLETIME_HOST : getAbleTimeHost());
  const url = abletimeRestUrl(path, host, opts.query);
  const method = (opts.method ?? 'GET').toUpperCase();
  const res = await httpFetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(
      rewriteAbleTimeError(
        `AbleTime API error ${res.status}${text ? `: ${text.slice(0, 240)}` : ''}`,
      ),
    );
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`AbleTime API returned a non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function restPages(
  path: string,
  opts: RestOpts & { query?: Record<string, string | undefined> },
  maxPages = 20,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const raw = await abletimeRestRequest(path, {
      ...opts,
      query: { ...opts.query, ...(cursor ? { cursor } : {}) },
    });
    items.push(...asList(raw));
    const page = asRecord(asRecord(raw)?.page);
    const next = page ? asString(page.nextCursor) : '';
    if (!next) break;
    cursor = next;
  }
  return items;
}

function userDisplayName(raw: unknown): { id?: string; name: string } | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = asString(rec.userId) || asString(rec.id);
  const name =
    [asString(rec.firstName), asString(rec.lastName)].filter(Boolean).join(' ') ||
    asString(rec.username) ||
    asString(rec.email) ||
    asString(rec.name);
  if (!name) return null;
  return { id: id || undefined, name };
}

function restTaskToRaw(
  raw: unknown,
  users: Map<string, { id?: string; name: string }>,
): Record<string, unknown> | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = asString(rec.timeflowTaskId) || asString(rec.taskId) || asString(rec.id);
  const identifier = asString(rec.taskRef) || asString(rec.reference) || id;
  const title = asString(rec.title);
  if (!id && !identifier && !title) return null;
  const assigned = asString(rec.assignedUserId);
  const assignee = assigned ? users.get(assigned) : undefined;
  const comments = asList(rec.comments).map((item) => {
    const comment = asRecord(item) ?? {};
    const user = userDisplayName(comment);
    return {
      id: asString(comment.commentId) || asString(comment.id),
      body:
        textFromAbleTimeDoc(comment.content) ||
        asString(comment.contentSanitized) ||
        asString(comment.body),
      createdAt: asString(comment.createdAt) || asString(comment.lastUpdate),
      user: user?.name || asString(comment.username),
    };
  });
  return {
    id,
    taskId: id,
    timeflowTaskId: id,
    reference: identifier,
    taskRef: identifier,
    title: title || identifier,
    state: asString(rec.taskState) || asString(rec.state),
    description: textFromAbleTimeDoc(rec.description) || asString(rec.descriptionSanitized),
    projectId: asString(rec.projectId),
    categoryId: asString(rec.projectCategoryId) || asString(rec.categoryId),
    parentId: asString(rec.parentTaskId) || asString(rec.parentId),
    tags: rec.tags,
    comments,
    createdAt: asString(rec.dateCreated) || asString(rec.createdAt),
    updatedAt: asString(rec.lastUpdate) || asString(rec.updatedAt),
    ...(assignee ? { assignee } : {}),
  };
}

function restProjectToRaw(raw: unknown): Record<string, unknown> | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = asString(rec.projectId) || asString(rec.id);
  const name = asString(rec.projectName) || asString(rec.name);
  if (!id && !name) return null;
  const categories = asList(rec.categories).map((item) => {
    const cat = asRecord(item) ?? {};
    return {
      id: asString(cat.projectCategoryId) || asString(cat.categoryId) || asString(cat.id),
      name: asString(cat.categoryName) || asString(cat.name),
    };
  });
  return { id, name, projectId: id, projectName: name, categories };
}

async function listUsers(opts: RestOpts): Promise<Map<string, { id?: string; name: string }>> {
  const users = new Map<string, { id?: string; name: string }>();
  for (const item of await restPages('/users', opts).catch(() => [])) {
    const user = userDisplayName(item);
    const rec = asRecord(item);
    const id = user?.id || (rec ? asString(rec.userId) : '');
    if (user && id) users.set(id, user);
  }
  return users;
}

async function listProjectsRaw(opts: RestOpts): Promise<Record<string, unknown>[]> {
  const items = await restPages('/projects', { ...opts, query: { expand: 'categories' } });
  return items
    .map(restProjectToRaw)
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

async function listTasksRaw(
  opts: RestOpts & { projectId?: string; query?: string },
): Promise<Record<string, unknown>[]> {
  const [users, items] = await Promise.all([
    listUsers(opts),
    restPages('/tasks', {
      ...opts,
      query: {
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      },
    }),
  ]);
  let tasks = items
    .map((item) => restTaskToRaw(item, users))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const needle = opts.query?.trim().toLowerCase();
  if (needle) {
    tasks = tasks.filter((task) => {
      const hay = [task.title, task.reference, task.taskRef, task.id]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      const tags = Array.isArray(task.tags) ? task.tags.join(' ').toLowerCase() : '';
      return hay.includes(needle) || tags.includes(needle);
    });
  }
  return tasks;
}

async function resolveTaskId(id: string, opts: RestOpts): Promise<string> {
  const wanted = id.trim();
  if (!wanted) throw new Error('AbleTime task id is required');
  if (looksLikeAbleTimeUlid(wanted)) return wanted;
  const tasks = await listTasksRaw(opts);
  const match = tasks.find((task) => {
    const ref = String(task.reference ?? task.taskRef ?? '').toLowerCase();
    const taskId = String(task.id ?? '').toLowerCase();
    return ref === wanted.toLowerCase() || taskId === wanted.toLowerCase();
  });
  if (!match?.id) throw new Error(`AbleTime task not found: ${id}`);
  return String(match.id);
}

async function getTaskRaw(id: string, opts: RestOpts): Promise<Record<string, unknown>> {
  const taskId = await resolveTaskId(id, opts);
  const [users, raw] = await Promise.all([
    listUsers(opts),
    abletimeRestRequest(`/tasks/${encodeURIComponent(taskId)}`, {
      ...opts,
      query: { expand: 'comments' },
    }),
  ]);
  const task = restTaskToRaw(raw, users);
  if (!task) throw new Error(`AbleTime task not found: ${id}`);
  return task;
}

function firstStringArg(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(args[key]);
    if (value) return value;
  }
  return '';
}

function isNoneToken(value: string): boolean {
  return value.trim().toLowerCase() === 'none';
}

function findRestProject(
  projects: Record<string, unknown>[],
  projectId: string,
): Record<string, unknown> | null {
  const wanted = projectId.trim().toLowerCase();
  return (
    projects.find(
      (item) =>
        asString(item.id).toLowerCase() === wanted ||
        asString(item.name).toLowerCase() === wanted,
    ) ?? null
  );
}

async function resolveRestParentTaskId(
  parent: string,
  opts: RestOpts,
): Promise<string | null> {
  if (isNoneToken(parent)) return null;
  return resolveTaskId(parent, opts);
}

/**
 * Organization API keys (`atk_…`) and JWT access tokens authenticate REST.
 * Hosted MCP accepts `apt_…` and browser-OAuth `acn_…`. Returns payloads the
 * existing AbleTime mappers already understand.
 */
export async function callAbleTimeRestTool<T = unknown>(
  name: AbleTimeMcpToolName,
  args: Record<string, unknown> = {},
  opts?: RestOpts,
): Promise<T> {
  const token = normalizeAbleTimeCredential(opts?.token ?? getAbleTimeAccessToken() ?? '');
  if (!token) {
    throw new Error('AbleTime is not connected — paste an API key or connect via browser');
  }
  if (ableTimeCredentialKind(token) === 'pat') {
    throw new Error('AbleTime REST transport is for organization keys and OAuth tokens, not apt_…');
  }
  const requestOpts: RestOpts = { ...opts, token };

  switch (name) {
    case 'orientation': {
      const [users, projects, tasks] = await Promise.all([
        listUsers(requestOpts),
        listProjectsRaw(requestOpts),
        listTasksRaw(requestOpts),
      ]);
      const viewer =
        [...users.values()].find((user) => user.name) ??
        [...users.values()][0] ??
        { name: 'AbleTime' };
      return { viewer, projects, tasks } as T;
    }
    case 'list_projects':
      return { data: await listProjectsRaw(requestOpts) } as T;
    case 'list_users':
      return { data: [...(await listUsers(requestOpts)).values()] } as T;
    case 'list_tasks':
      return {
        data: await listTasksRaw({
          ...requestOpts,
          projectId: firstStringArg(args, ['project_id', 'projectId', 'project']),
        }),
      } as T;
    case 'search_tasks':
      return {
        data: await listTasksRaw({
          ...requestOpts,
          query: firstStringArg(args, ['query', 'q']),
        }),
      } as T;
    case 'get_task':
      return (await getTaskRaw(firstStringArg(args, ['id', 'task_id', 'task']), requestOpts)) as T;
    case 'create_task': {
      const title = firstStringArg(args, ['title']);
      if (!title) throw new Error('AbleTime task title is required');
      const projectId = firstStringArg(args, ['project_id', 'projectId', 'project']);
      if (!projectId) throw new Error('AbleTime project is required');
      const projects = await listProjectsRaw(requestOpts);
      const project = findRestProject(projects, projectId) ?? projects[0];
      if (!project) throw new Error('AbleTime has no projects to create a task in');
      const categories = asList(project.categories);
      const wantedCategory = firstStringArg(args, ['category_id', 'categoryId', 'category']);
      const category =
        categories
          .map((item) => asRecord(item))
          .find((item) => {
            if (!item || !wantedCategory) return false;
            return (
              asString(item.id).toLowerCase() === wantedCategory.toLowerCase() ||
              asString(item.name).toLowerCase() === wantedCategory.toLowerCase()
            );
          }) ?? asRecord(categories[0]);
      const parentArg = firstStringArg(args, ['parent', 'parent_id', 'parentId', 'related_task_id']);
      const parentTaskId = parentArg
        ? await resolveRestParentTaskId(parentArg, requestOpts)
        : undefined;
      const created = await abletimeRestRequest('/tasks', {
        ...requestOpts,
        method: 'POST',
        body: {
          projectId: asString(project.id),
          projectCategoryId: category ? asString(category.id) : undefined,
          title,
          ...(parentTaskId ? { parentTaskId } : {}),
        },
      });
      const state = firstStringArg(args, ['state']);
      const createdId = asString(asRecord(created)?.timeflowTaskId);
      const description = asString(args.description);
      if (createdId && description) {
        await abletimeRestRequest(`/tasks/${encodeURIComponent(createdId)}`, {
          ...requestOpts,
          method: 'PATCH',
          body: { description: ableTimeDocFromText(description) },
        }).catch(() => undefined);
      }
      if (createdId && state && state !== 'todo') {
        await abletimeRestRequest(`/tasks/${encodeURIComponent(createdId)}/state`, {
          ...requestOpts,
          method: 'POST',
          body: { taskState: state },
        }).catch(() => undefined);
      }
      return (createdId ? await getTaskRaw(createdId, requestOpts) : restTaskToRaw(created, await listUsers(requestOpts))) as T;
    }
    case 'update_task': {
      const id = await resolveTaskId(firstStringArg(args, ['id', 'task_id', 'task']), requestOpts);
      const patch: Record<string, unknown> = {};
      const title = firstStringArg(args, ['title']);
      if (title) patch.title = title;
      if (args.description !== undefined) {
        patch.description =
          args.description == null || args.description === ''
            ? null
            : ableTimeDocFromText(String(args.description));
      }
      if (args.tags !== undefined || args.labels !== undefined) {
        patch.tags = args.tags ?? args.labels ?? args.tag_names;
      }
      const projectArg = firstStringArg(args, ['project', 'project_id', 'projectId']);
      if (projectArg) {
        if (isNoneToken(projectArg)) {
          throw new Error('AbleTime tasks stay in a project — pass a project name or id');
        }
        const projects = await listProjectsRaw(requestOpts);
        const project = findRestProject(projects, projectArg);
        const nextProjectId = project ? asString(project.id) : '';
        if (!nextProjectId) throw new Error(`AbleTime project not found: ${projectArg}`);
        patch.projectId = nextProjectId;
      }
      const parentArg = firstStringArg(args, ['parent', 'parent_id', 'parentId', 'related_task_id']);
      if (parentArg) {
        patch.parentTaskId = await resolveRestParentTaskId(parentArg, requestOpts);
      }
      if (Object.keys(patch).length > 0) {
        await abletimeRestRequest(`/tasks/${encodeURIComponent(id)}`, {
          ...requestOpts,
          method: 'PATCH',
          body: patch,
        });
      }
      return (await getTaskRaw(id, requestOpts)) as T;
    }
    case 'set_task_state': {
      const id = await resolveTaskId(firstStringArg(args, ['id', 'task_id', 'task']), requestOpts);
      const state = firstStringArg(args, ['state', 'taskState']);
      if (!state) throw new Error('AbleTime task state is required');
      await abletimeRestRequest(`/tasks/${encodeURIComponent(id)}/state`, {
        ...requestOpts,
        method: 'POST',
        body: { taskState: state },
      });
      return (await getTaskRaw(id, requestOpts)) as T;
    }
    case 'create_comment': {
      const id = await resolveTaskId(firstStringArg(args, ['id', 'task_id', 'task']), requestOpts);
      const body = firstStringArg(args, ['body', 'comment', 'text']);
      if (!body) throw new Error('AbleTime comment body is required');
      const created = await abletimeRestRequest(`/tasks/${encodeURIComponent(id)}/comments`, {
        ...requestOpts,
        method: 'POST',
        body: { content: ableTimeDocFromText(body) },
      });
      const rec = asRecord(created) ?? {};
      return {
        id: asString(rec.commentId) || undefined,
        body: textFromAbleTimeDoc(rec.content) || body,
      } as T;
    }
    case 'set_task_dependency':
      throw new Error(
        'AbleTime organization API keys cannot set task dependencies on REST yet — use a personal access token (apt_…) for MCP project-management tools.',
      );
    default:
      throw new Error(`AbleTime organization API keys do not support ${name} on REST`);
  }
}
