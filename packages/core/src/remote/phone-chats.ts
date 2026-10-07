import { randomUUID } from 'node:crypto';
import { listModelsForAgent } from '../agents/list-models.js';
import { groupHomeBoardWorktrees } from '../board/home-board.js';
import { persistPendingFileAttachments } from '../composer/stage-files.js';
import { listBranches, listPrs } from '../git/worktree.js';
import { worktreeDisplayLabelForGroup } from '../git/worktree-labels.js';
import { listIssues } from '../integrations/issues.js';
import type {
  AgentKind,
  Autonomy,
  Thread,
  ThreadAttachment,
  ThreadStatus,
} from '../types/thread.js';
import { isThinkingEffort, type ThinkingEffort } from '../types/thinking-effort.js';
import type { RemoteAskQuestion } from './protocol.js';
import { resolveNewThreadOptions, resolveOrchestratorDefaults } from '../store/app-settings.js';
import { createGlobalChat, isGlobalThread, listGlobalThreads } from '../store/global-workspace.js';
import { listThreads, readThread, updateThread } from '../store/thread-store.js';
import { listWorkspaces } from '../store/workspaces.js';
import { createChatTab, threadsSharingWorktree } from '../threads/chat-tabs.js';
import { createThread } from '../threads/create.js';
import { startOrchestration } from '../orchestrator/orchestrator.js';

/**
 * Phone chat control rides inside the existing prompt/assistant text so it
 * works with the deployed relay, which only forwards those two shapes.
 * The leading NUL keeps a person from typing this by accident.
 */
export const PHONE_CONTROL_PREFIX = '\u0000sb.phone\n';

const PHONE_USER_PREFIX = 'Phone\n\n';
const TRANSCRIPT_LIMIT = 40;
const MESSAGE_LIMIT = 4_000;
const PREVIEW_LIMIT = 90;
/** One History page. The archive can be long; the phone asks for the next page. */
const HISTORY_PAGE_SIZE = 40;

export interface PhoneChatSummary {
  id: string;
  title: string;
  status: ThreadStatus;
  preview: string;
  updatedAt: string;
}

export interface PhoneChatMessage {
  role: 'user' | 'agent';
  text: string;
}

export type PhonePlace =
  | { kind: 'orchestration' }
  | { kind: 'project'; repoPath: string; worktree: string };

export interface PhoneOpened {
  chat: PhoneChatSummary;
  messages: PhoneChatMessage[];
  place?: PhonePlace;
  /** Composer chips for this chat: agent, effort, plan, and autonomy. */
  options?: PhoneComposerOptions;
}

/** Same knobs as the desktop composer and create modal. */
export interface PhoneComposerOptions {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  planMode: boolean;
  autonomy: Autonomy;
}

/** Photo, camera shot, or downloaded file. Bytes are base64. */
export interface PhoneFile {
  name: string;
  dataBase64: string;
}

/** Issue chip, same as desktop Link issue. */
export interface PhoneIssueLink {
  ref: string;
  title: string;
  url?: string;
}

export interface PhoneSourceRow {
  ref: string;
  title: string;
  url?: string;
}

export interface PhoneSources {
  prs: PhoneSourceRow[];
  branches: PhoneSourceRow[];
  issues: PhoneSourceRow[];
  warnings?: string[];
}

export interface PhoneModelRow {
  id: string;
  label: string;
}

const AGENT_KINDS = new Set<AgentKind>(['claude', 'codex', 'opencode', 'brightsy', 'cursor']);
const MAX_PHONE_FILES = 8;
const MAX_PHONE_FILE_CHARS = Math.ceil((8 * 1024 * 1024 * 4) / 3);
const MAX_PHONE_FILES_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3);
const MAX_DICTATION_CHARS = Math.ceil((12 * 1024 * 1024 * 4) / 3);

/** Archived chat as Settings → History shows it: where it lived, and which agent. */
export interface PhoneHistoryChat {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  where: string;
  agent: string;
}

export interface PhoneHistoryPage {
  chats: PhoneHistoryChat[];
  /** Matching archived chats, including ones not on this page. */
  total: number;
  /** Pass back as `after` to load the following page. */
  next?: string;
}

/** Fields shared by a prompt and by creating a chat that starts with a message. */
export interface PhoneDraft {
  agent?: AgentKind;
  model?: string | null;
  effort?: ThinkingEffort;
  fast?: boolean;
  planMode?: boolean;
  autonomy?: Autonomy;
  files?: PhoneFile[];
  links?: PhoneIssueLink[];
  prompt?: string;
}

export type PhoneControlRequest =
  | { op: 'list' }
  | { op: 'history'; query?: string; after?: string }
  | { op: 'sources'; repoPath: string; query?: string }
  | { op: 'models'; agent: AgentKind }
  | { op: 'dictate'; id: string; audioBase64: string }
  | ({ op: 'options'; chatId: string } & PhoneDraft)
  | ({ op: 'create'; where: 'orchestration'; goal?: string } & PhoneDraft)
  | ({ op: 'create'; where: 'worktree'; chatId: string } & PhoneDraft)
  | ({
      op: 'create';
      where: 'project';
      repoPath: string;
      sourceType?: 'branch' | 'pr' | 'ticket';
      sourceRef?: string;
      title?: string;
      cowboy?: boolean;
    } & PhoneDraft)
  | { op: 'open'; chatId: string }
  | { op: 'archive'; chatId: string }
  | { op: 'restore'; chatId: string }
  | ({ op: 'prompt'; chatId: string; text: string } & PhoneDraft)
  | { op: 'stop'; chatId: string };

export interface PhoneWorktree {
  label: string;
  chats: PhoneChatSummary[];
}

export interface PhoneProject {
  name: string;
  path: string;
  worktrees: PhoneWorktree[];
}

/** Desktop left sidebar: orchestration chats, then projects and their worktrees. */
export interface PhoneSidebar {
  orchestration: PhoneChatSummary[];
  projects: PhoneProject[];
}

export type PhoneControlReply =
  | ({ op: 'sidebar' } & PhoneSidebar)
  | {
      op: 'history';
      chats: PhoneHistoryChat[];
      total: number;
      next?: string;
      query?: string;
      after?: string;
    }
  | { op: 'restored'; chatId: string }
  | ({ op: 'opened' } & PhoneOpened)
  | ({ op: 'sources'; repoPath: string; query?: string } & PhoneSources)
  | { op: 'models'; agent: AgentKind; models: PhoneModelRow[] }
  | { op: 'dictated'; id: string; text: string }
  | ({ op: 'options'; chatId: string } & PhoneComposerOptions)
  | { op: 'assistant'; chatId: string; text: string }
  | { op: 'ask'; chatId: string; text: string; questions: RemoteAskQuestion[] }
  | { op: 'stopped'; chatId: string }
  | { op: 'error'; message: string; chatId?: string };

export function encodePhoneControl(payload: PhoneControlRequest | PhoneControlReply): string {
  return PHONE_CONTROL_PREFIX + JSON.stringify(payload);
}

/** Null when this is an ordinary prompt. `invalid` when the prefix is present but the body is not a command. */
export function takePhoneControl(text: string): PhoneControlRequest | 'invalid' | null {
  if (!text.startsWith(PHONE_CONTROL_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(PHONE_CONTROL_PREFIX.length));
  } catch {
    return 'invalid';
  }
  return parsePhoneControl(parsed);
}

function parsePhoneControl(value: unknown): PhoneControlRequest | 'invalid' {
  if (!value || typeof value !== 'object') return 'invalid';
  const op = (value as { op?: unknown }).op;
  if (op === 'list') return { op: 'list' };
  if (op === 'history') {
    const query = textField(value, 'query');
    const after = textField(value, 'after');
    return { op: 'history', ...(query ? { query } : {}), ...(after ? { after } : {}) };
  }
  if (op === 'sources') {
    const repoPath = textField(value, 'repoPath');
    if (!repoPath || !isProjectPath(repoPath)) return 'invalid';
    const query = textField(value, 'query');
    return { op: 'sources', repoPath, ...(query ? { query } : {}) };
  }
  if (op === 'models') {
    const agent = agentField(value);
    if (!agent) return 'invalid';
    return { op: 'models', agent };
  }
  if (op === 'dictate') {
    const id = textField(value, 'id');
    const audioBase64 = base64Field(value, 'audioBase64');
    if (!id || !audioBase64 || audioBase64.length > MAX_DICTATION_CHARS) return 'invalid';
    return { op: 'dictate', id, audioBase64 };
  }
  if (op === 'create') return parsePhoneCreate(value);
  const chatId = typeof (value as { chatId?: unknown }).chatId === 'string'
    ? (value as { chatId: string }).chatId.trim()
    : '';
  if (!chatId) return 'invalid';
  if (op === 'open' || op === 'archive' || op === 'restore' || op === 'stop') return { op, chatId };
  const draft = parsePhoneDraft(value);
  if (draft === 'invalid') return 'invalid';
  if (op === 'options') return { op: 'options', chatId, ...draft };
  if (op === 'prompt') {
    const text = typeof (value as { text?: unknown }).text === 'string'
      ? (value as { text: string }).text.trim()
      : '';
    const hasPayload = Boolean(text || draft.files?.length || draft.links?.length);
    if (!hasPayload) return 'invalid';
    return { op: 'prompt', chatId, text, ...draft };
  }
  return 'invalid';
}

function textField(value: object, key: string): string {
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function agentField(value: object): AgentKind | undefined {
  const agent = textField(value, 'agent');
  if (!agent) return undefined;
  return AGENT_KINDS.has(agent as AgentKind) ? (agent as AgentKind) : undefined;
}

function base64Field(value: object, key: string): string {
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s/g, '');
}

function parsePhoneDraft(value: object): PhoneDraft | 'invalid' {
  const draft: PhoneDraft = {};
  if (textField(value, 'agent')) {
    const agent = agentField(value);
    if (!agent) return 'invalid';
    draft.agent = agent;
  }
  if ('model' in value) {
    const model = (value as { model?: unknown }).model;
    if (model === null || model === '') draft.model = null;
    else if (typeof model === 'string') draft.model = model.trim().slice(0, 200);
    else return 'invalid';
  }
  if ('effort' in value && (value as { effort?: unknown }).effort != null) {
    const effort = (value as { effort?: unknown }).effort;
    if (!isThinkingEffort(effort)) return 'invalid';
    draft.effort = effort;
  }
  if ('fast' in value) {
    const fast = (value as { fast?: unknown }).fast;
    if (typeof fast !== 'boolean') return 'invalid';
    draft.fast = fast;
  }
  if ('planMode' in value) {
    const planMode = (value as { planMode?: unknown }).planMode;
    if (typeof planMode !== 'boolean') return 'invalid';
    draft.planMode = planMode;
  }
  if ('autonomy' in value && (value as { autonomy?: unknown }).autonomy != null) {
    const autonomy = (value as { autonomy?: unknown }).autonomy;
    if (autonomy !== 'default' && autonomy !== 'full') return 'invalid';
    draft.autonomy = autonomy;
  }
  const files = parsePhoneFiles((value as { files?: unknown }).files);
  if (files === 'invalid') return 'invalid';
  if (files.length) draft.files = files;
  const links = parsePhoneLinks((value as { links?: unknown }).links);
  if (links === 'invalid') return 'invalid';
  if (links.length) draft.links = links;
  const prompt = textField(value, 'prompt');
  if (prompt) draft.prompt = prompt.slice(0, 20_000);
  return draft;
}

function parsePhoneFiles(value: unknown): PhoneFile[] | 'invalid' {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_PHONE_FILES) return 'invalid';
  const files: PhoneFile[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'invalid';
    const name = (textField(item, 'name').replace(/[/\\]/g, '_') || 'file').slice(0, 180);
    const dataBase64 = base64Field(item, 'dataBase64');
    if (!dataBase64 || !/^[A-Za-z0-9+/=]+$/.test(dataBase64)) return 'invalid';
    if (dataBase64.length > MAX_PHONE_FILE_CHARS) return 'invalid';
    total += dataBase64.length;
    if (total > MAX_PHONE_FILES_CHARS) return 'invalid';
    files.push({ name, dataBase64 });
  }
  return files;
}

function parsePhoneLinks(value: unknown): PhoneIssueLink[] | 'invalid' {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) return 'invalid';
  const links: PhoneIssueLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'invalid';
    const ref = textField(item, 'ref').slice(0, 80);
    if (!ref) return 'invalid';
    const title = (textField(item, 'title') || ref).slice(0, 200);
    const url = textField(item, 'url').slice(0, 500);
    links.push({ ref, title, ...(url ? { url } : {}) });
  }
  return links;
}

/** `{ op: 'create' }` stays an orchestration agent. Project rows name their target. */
function parsePhoneCreate(value: object): PhoneControlRequest | 'invalid' {
  const draft = parsePhoneDraft(value);
  if (draft === 'invalid') return 'invalid';
  const goal = textField(value, 'goal') || draft.prompt || '';
  const where = (value as { where?: unknown }).where;
  if (where == null || where === 'orchestration') {
    return {
      op: 'create',
      where: 'orchestration',
      ...draft,
      ...(goal ? { goal, prompt: goal } : {}),
    };
  }
  if (where === 'worktree') {
    const chatId = textField(value, 'chatId');
    if (!chatId) return 'invalid';
    return { op: 'create', where: 'worktree', chatId, ...draft };
  }
  if (where === 'project') {
    const repoPath = textField(value, 'repoPath');
    if (!repoPath || !isProjectPath(repoPath)) return 'invalid';
    const sourceRaw = textField(value, 'sourceType');
    let sourceType: 'branch' | 'pr' | 'ticket' | undefined;
    if (sourceRaw === 'branch' || sourceRaw === 'pr' || sourceRaw === 'ticket') sourceType = sourceRaw;
    else if (sourceRaw) return 'invalid';
    const sourceRef = textField(value, 'sourceRef');
    if ((sourceType === 'pr' || sourceType === 'ticket') && !sourceRef) return 'invalid';
    const title = textField(value, 'title').slice(0, 200);
    const cowboy = (value as { cowboy?: unknown }).cowboy === true;
    return {
      op: 'create',
      where: 'project',
      repoPath,
      ...draft,
      ...(sourceType ? { sourceType } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(title ? { title } : {}),
      ...(cowboy ? { cowboy: true } : {}),
    };
  }
  return 'invalid';
}

export function phoneVisibleText(role: 'user' | 'agent', text: string): string {
  const trimmed = text.trim();
  if (role === 'user' && trimmed.startsWith(PHONE_USER_PREFIX)) {
    return trimmed.slice(PHONE_USER_PREFIX.length).trim();
  }
  return trimmed;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function summarize(thread: Thread): PhoneChatSummary {
  return {
    id: thread.id,
    title: thread.title?.trim() || 'Untitled',
    status: thread.status,
    preview: previewOf(thread),
    updatedAt: thread.updatedAt,
  };
}

function previewOf(thread: Thread): string {
  const messages = listPhoneMessages(thread);
  const last = messages[messages.length - 1];
  if (!last) return '';
  return clip(last.text.replace(/\s+/g, ' ').trim(), PREVIEW_LIMIT);
}

export function listPhoneMessages(thread: Thread): PhoneChatMessage[] {
  const out: PhoneChatMessage[] = [];
  for (const message of thread.messages) {
    if (message.role !== 'user' && message.role !== 'agent') continue;
    const names = (message.attachments ?? []).map((item) => item.name.trim()).filter(Boolean);
    const text = clip(
      [phoneVisibleText(message.role, message.text), names.length ? names.join(', ') : '']
        .filter(Boolean)
        .join('\n'),
      MESSAGE_LIMIT,
    );
    if (!text) continue;
    out.push({ role: message.role, text });
  }
  return out.slice(-TRANSCRIPT_LIMIT);
}

function repoName(repoPath: string): string {
  const parts = repoPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || repoPath;
}

function isProjectPath(path: string): boolean {
  if (!path || path === '/' || path === '.') return false;
  return !isGlobalThread({ repoPath: path });
}

/** Global orchestration chats, newest activity first. */
export function listPhoneChats(): PhoneChatSummary[] {
  return listGlobalThreads()
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map(summarize);
}

/** Same two sections as the desktop sidebar. */
export function listPhoneSidebar(): PhoneSidebar {
  const threads = listThreads();
  const byRepo = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (!isProjectPath(thread.repoPath)) continue;
    const list = byRepo.get(thread.repoPath) ?? [];
    list.push(thread);
    byRepo.set(thread.repoPath, list);
  }
  for (const workspace of listWorkspaces()) {
    if (!isProjectPath(workspace.path) || byRepo.has(workspace.path)) continue;
    byRepo.set(workspace.path, []);
  }
  const projects = [...byRepo.entries()]
    .sort(([a], [b]) => repoName(a).localeCompare(repoName(b)))
    .map(([path, repoThreads]) => ({
      name: repoName(path),
      path,
      worktrees: groupHomeBoardWorktrees(repoThreads).map((group) => ({
        label: worktreeDisplayLabelForGroup(group),
        chats: group.map(summarize),
      })),
    }));
  return { orchestration: listPhoneChats(), projects };
}

function historyStamp(thread: Thread): string {
  return thread.archivedAt || thread.updatedAt;
}

function historyCursor(chat: PhoneHistoryChat): string {
  return `${chat.updatedAt}\t${chat.id}`;
}

function historyQueryMatch(chat: PhoneHistoryChat, query: string): boolean {
  if (!query) return true;
  return `${chat.title} ${chat.where} ${chat.agent} ${chat.preview}`.toLowerCase().includes(query);
}

/** Settings → History: one page of archived chats, newest first. */
export function listPhoneHistory(opts?: { query?: string; after?: string }): PhoneHistoryPage {
  const query = opts?.query?.trim().toLowerCase() ?? '';
  const after = opts?.after?.trim() ?? '';
  const all = listThreads({ includeArchived: true })
    .filter((thread) => thread.status === 'archived')
    .filter((thread) => isGlobalThread(thread) || isProjectPath(thread.repoPath))
    .sort((a, b) => (historyStamp(a) < historyStamp(b) ? 1 : historyStamp(a) > historyStamp(b) ? -1 : 0))
    .map((thread) => ({
      id: thread.id,
      title: thread.title?.trim() || 'Untitled',
      preview: previewOf(thread),
      updatedAt: historyStamp(thread),
      where: isGlobalThread(thread) ? 'Orchestration' : repoName(thread.repoPath),
      agent: thread.agent,
    }))
    .filter((chat) => historyQueryMatch(chat, query));
  let start = 0;
  if (after) {
    const index = all.findIndex((chat) => historyCursor(chat) === after);
    start = index >= 0 ? index + 1 : all.length;
  }
  const chats = all.slice(start, start + HISTORY_PAGE_SIZE);
  const last = chats.at(-1);
  const more = start + chats.length < all.length;
  return {
    chats,
    total: all.length,
    ...(more && last ? { next: historyCursor(last) } : {}),
  };
}

export function readPhoneThread(chatId: string): Thread | null {
  const id = chatId.trim();
  if (!id) return null;
  const thread = readThread(id);
  if (!thread || thread.status === 'archived') return null;
  if (isGlobalThread(thread)) return thread;
  if (!isProjectPath(thread.repoPath)) return null;
  return thread;
}

export function phoneComposerOptions(thread: Thread): PhoneComposerOptions {
  return {
    agent: thread.agent,
    model: thread.model ?? null,
    effort: thread.effort,
    fast: Boolean(thread.fast),
    planMode: Boolean(thread.planMode),
    autonomy: thread.autonomy ?? 'default',
  };
}

export function phoneTurnAttachments(draft: {
  files?: PhoneFile[];
  links?: PhoneIssueLink[];
}): ThreadAttachment[] {
  const links = (draft.links ?? []).map((link) => ({
    id: randomUUID(),
    name: link.ref,
    kind: 'issue' as const,
    content: [`Linked issue: ${link.ref} — ${link.title}`, link.url ? `URL: ${link.url}` : null]
      .filter(Boolean)
      .join('\n'),
  }));
  const files = (draft.files ?? []).map((file) => ({
    id: randomUUID(),
    name: file.name,
    kind: 'file' as const,
    previewDataUrl: `data:application/octet-stream;base64,${file.dataBase64}`,
    content: `File attached: ${file.name}`,
  }));
  return [...links, ...files];
}

function openedFrom(thread: Thread, place: PhonePlace): PhoneOpened {
  const fresh = readThread(thread.id) ?? thread;
  return {
    chat: summarize(fresh),
    messages: listPhoneMessages(fresh),
    place,
    options: phoneComposerOptions(fresh),
  };
}

export function openPhoneChat(chatId: string): PhoneOpened | null {
  const thread = readPhoneThread(chatId);
  if (!thread) return null;
  const place: PhonePlace = isGlobalThread(thread)
    ? { kind: 'orchestration' }
    : projectPlace(thread);
  return openedFrom(thread, place);
}

function sameRepoPath(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

function projectPlace(thread: Thread): PhonePlace {
  const group = threadsSharingWorktree(thread.worktreePath);
  return {
    kind: 'project',
    repoPath: thread.repoPath,
    worktree: worktreeDisplayLabelForGroup(group.length > 0 ? group : [thread]),
  };
}

function assertKnownProject(repoPath: string): string {
  const path = repoPath.trim();
  if (!isProjectPath(path)) throw new Error('Pick a project on this Mac.');
  const known =
    listWorkspaces().some((workspace) => sameRepoPath(workspace.path, path)) ||
    listThreads().some(
      (thread) => thread.status !== 'archived' && sameRepoPath(thread.repoPath, path),
    );
  if (!known) throw new Error('That project is not on this Mac.');
  return path;
}

function draftAgentOptions(draft: PhoneDraft | undefined, defaults: {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
}) {
  return {
    agent: draft?.agent ?? defaults.agent,
    model: draft && 'model' in draft ? (draft.model ?? null) : defaults.model,
    effort: draft?.effort ?? defaults.effort,
    fast: draft?.fast ?? defaults.fast,
    planMode: Boolean(draft?.planMode),
    autonomy: draft?.autonomy,
  };
}

export function createPhoneChat(agent?: AgentKind): PhoneOpened {
  const defaults = resolveOrchestratorDefaults();
  const thread = createGlobalChat({
    agent: agent ?? defaults.agent,
    model: defaults.model,
    effort: defaults.effort,
    fast: defaults.fast,
  });
  return openedFrom(thread, { kind: 'orchestration' });
}

/** Orchestration chat with a goal, the same fields as the desktop create modal. */
export async function createPhoneOrchestration(draft?: PhoneDraft & { goal?: string }): Promise<PhoneOpened> {
  const goal = (draft?.goal ?? draft?.prompt ?? '').trim();
  const attachments = phoneTurnAttachments(draft ?? {});
  if (!goal && attachments.length === 0) return createPhoneChat(draft?.agent);
  const defaults = resolveOrchestratorDefaults();
  const options = draftAgentOptions(draft, defaults);
  const thread = await startOrchestration({
    goal: goal || 'See the attached files.',
    agent: options.agent,
    model: options.model,
    effort: options.effort,
    fast: options.fast,
    planMode: options.planMode,
    autonomy: options.autonomy,
    attachments,
  });
  return openedFrom(thread, { kind: 'orchestration' });
}

/** Sibling agent on an existing project worktree. Same as the desktop worktree +. */
export function createPhoneWorktreeAgent(fromChatId: string, draft?: PhoneDraft): PhoneOpened {
  const source = readPhoneThread(fromChatId);
  if (!source || isGlobalThread(source)) throw new Error('That worktree is not on this Mac.');
  const defaults = resolveNewThreadOptions();
  const options = draftAgentOptions(draft, defaults);
  const attachments = persistPendingFileAttachments(
    source.worktreePath,
    phoneTurnAttachments(draft ?? {}),
  );
  const thread = createChatTab({
    fromThreadId: source.id,
    agent: options.agent,
    model: options.model,
    effort: options.effort,
    fast: options.fast,
    autonomy: options.autonomy,
    attachments,
  });
  if (draft?.planMode !== undefined) updateThread(thread.id, { planMode: draft.planMode });
  return openedFrom(thread, projectPlace(readThread(thread.id) ?? thread));
}

export interface PhoneProjectCreate extends PhoneDraft {
  repoPath: string;
  sourceType?: 'branch' | 'pr' | 'ticket';
  sourceRef?: string;
  title?: string;
  cowboy?: boolean;
}

/** New worktree in a registered project, from a branch, PR, issue, or the default branch. */
export async function createPhoneProjectWorktree(
  repoPathOrInput: string | PhoneProjectCreate,
): Promise<PhoneOpened> {
  const input: PhoneProjectCreate =
    typeof repoPathOrInput === 'string' ? { repoPath: repoPathOrInput } : repoPathOrInput;
  const path = assertKnownProject(input.repoPath);
  const defaults = resolveNewThreadOptions();
  const options = draftAgentOptions(input, defaults);
  const thread = await createThread({
    sourceType: input.sourceType ?? 'branch',
    sourceRef: input.sourceRef || 'default',
    repoPath: path,
    title: input.title,
    cowboy: input.cowboy,
    agent: options.agent,
    model: options.model,
    effort: options.effort,
    fast: options.fast,
    planMode: options.planMode,
    autonomy: options.autonomy,
    attachments: phoneTurnAttachments(input),
    prompt: input.prompt,
  });
  return openedFrom(thread, projectPlace(thread));
}

function sourceWarning(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message ? `${label}: ${message}` : `${label} failed.`;
}

/** PRs, branches, and issues for the create-worktree picker. */
export async function listPhoneSources(repoPath: string, query?: string): Promise<PhoneSources> {
  const path = assertKnownProject(repoPath);
  const q = query?.trim() ?? '';
  const warnings: string[] = [];
  const [prs, branches, issues] = await Promise.all([
    listPrs(path, { state: 'open', limit: 40, ...(q ? { query: q } : {}) }).catch((err: unknown) => {
      warnings.push(sourceWarning('Pull requests', err));
      return [];
    }),
    listBranches(path).catch((err: unknown) => {
      warnings.push(sourceWarning('Branches', err));
      return [];
    }),
    listIssues(path, { limit: 40, ...(q ? { query: q } : {}) }).catch((err: unknown) => {
      warnings.push(sourceWarning('Issues', err));
      return { issues: [] };
    }),
  ]);
  const needle = q.toLowerCase();
  const branchRows = branches
    .filter((branch) => !needle || branch.name.toLowerCase().includes(needle))
    .slice(0, 50)
    .map((branch) => ({
      ref: branch.name,
      title: branch.current ? `${branch.name} (current)` : branch.name,
    }));
  return {
    prs: prs.slice(0, 40).map((pr) => ({
      ref: String(pr.number),
      title: clip(pr.title || `PR #${pr.number}`, 140),
      ...(pr.url ? { url: pr.url } : {}),
    })),
    branches: branchRows,
    issues: (issues.issues ?? []).slice(0, 40).map((issue) => ({
      ref: issue.identifier,
      title: clip(issue.title || issue.identifier, 140),
      ...(issue.url ? { url: issue.url } : {}),
    })),
    ...(warnings.length ? { warnings } : {}),
  };
}

/** Model list for the agent picker. Claude is the built-in catalog; others ask the CLI. */
export async function listPhoneModels(agent: AgentKind): Promise<PhoneModelRow[]> {
  const catalogs = await listModelsForAgent(agent);
  return (catalogs[0]?.models ?? []).slice(0, 40).map((model) => ({
    id: model.id,
    label: model.displayName || model.id,
  }));
}

export function archivePhoneChat(chatId: string): boolean {
  const thread = readPhoneThread(chatId);
  if (!thread) return false;
  updateThread(thread.id, { status: 'archived' });
  return true;
}
