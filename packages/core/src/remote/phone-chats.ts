import { randomUUID } from 'node:crypto';
import { listModelsForAgent } from '../agents/list-models.js';
import { classifyWorktreeListBadges, groupHomeBoardWorktrees, issueBlockedByIds, visibleAgentBlock } from '../board/home-board.js';
import { persistPendingFileAttachments } from '../composer/stage-files.js';
import { workspaceTagsFromGroup, worktreeAnchorLabel } from '../git/worktree-labels.js';
import type {
  AgentKind,
  Autonomy,
  Thread,
  ThreadAttachment,
  ThreadStatus,
} from '../types/thread.js';
import { isThinkingEffort, type ThinkingEffort } from '../types/thinking-effort.js';
import type { RemoteAskQuestion } from './protocol.js';
import {
  loadAppSettings,
  resolveNewThreadOptions,
  resolveOrchestratorDefaults,
  resolveProjectReviewLabel,
} from '../store/app-settings.js';
import { createGlobalChat, isGlobalThread, listGlobalThreads } from '../store/global-workspace.js';
import { findThreadByRef, listThreads, readThread, updateThread } from '../store/thread-store.js';
import { isRemovedWorkspace, listWorkspaces } from '../store/workspaces.js';
import { createChatTab, threadsSharingWorktree } from '../threads/chat-tabs.js';
import { createThread } from '../threads/create.js';
import { startOrchestration } from '../orchestrator/orchestrator.js';
import { parseOpenArtifact, type PhoneOpenArtifact, type PhoneShownReply } from './phone-artifact.js';
import {
  PHONE_HEADER_GIT_ACTIONS,
  type PhoneHeader,
  type PhoneHeaderGitAction,
} from './phone-header.js';
import { parsePhoneCodeRefs, type PhoneCodeRef } from './phone-code-refs.js';
import {
  parsePhonePane,
  phoneChangeScope,
  phoneCommitSha,
  type PhoneChangeScope,
  type PhonePaneReply,
  type PhonePaneRequest,
} from './phone-panes.js';
import { phoneAccountDefaults, type PhoneAccountDefaults } from './phone-defaults.js';
import { phonePrPill } from './phone-header.js';
import { phoneViewerLogin } from './phone-viewer-login.js';
import type { PhonePermissionView } from './phone-permission.js';
import { clip, listPhoneMessages, parsePhoneMcpUi, phoneVisibleText, type PhoneMcpAppsField, type PhoneMcpUiReply, type PhoneMcpUiRequest } from './phone-transcript.js';

/** Phone control rides in prompt text. The leading NUL keeps a person from typing it. */
export const PHONE_CONTROL_PREFIX = '\u0000sb.phone\n';

const PREVIEW_LIMIT = 90;

export interface PhoneChatSummary {
  id: string;
  title: string;
  status: ThreadStatus;
  preview: string;
  updatedAt: string;
  agent: AgentKind;
  /** Set when this chat has a pull request. The phone paints the desktop PR pill from these. */
  prUrl?: string;
  prNumber?: string;
  prStatus?: string;
  /** Set when this agent is waiting on a person (permission, ask, or a reported block). */
  needsYou?: boolean;
  blockedReason?: string;
}

export interface PhoneChatMessage extends PhoneMcpAppsField {
  role: 'user' | 'agent';
  text: string;
  /** Set on the in-progress answer while a turn is still running. */
  streaming?: boolean;
}

export { clip, phoneVisibleText };

export type PhonePlace =
  | { kind: 'orchestration' }
  | { kind: 'project'; repoPath: string; worktree: string };

export interface PhoneOpened {
  chat: PhoneChatSummary;
  messages: PhoneChatMessage[];
  place?: PhonePlace;
  /** Composer chips for this chat: agent, effort, plan, and autonomy. */
  options?: PhoneComposerOptions;
  permission?: PhonePermissionView | null;
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

/** Archived chat as Settings → History shows it: where it lived, which agent, and the checkout name. */
export interface PhoneHistoryChat {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  where: string;
  agent: string; workspace?: string;
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
  refs?: PhoneCodeRef[];
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
  | { op: 'stop'; chatId: string }
  | { op: 'review'; chatId: string }
  | { op: 'header'; chatId: string }
  | { op: 'git'; chatId: string; action: PhoneHeaderGitAction }
  | PhonePaneRequest
  | { op: 'open-file'; chatId: string; path: string; startLine?: number; endLine?: number; view?: 'diff'; scope?: PhoneChangeScope; commitSha?: string }
  | PhoneOpenArtifact
  | { op: 'media'; chatId: string; path: string } | PhoneMcpUiRequest;

export interface PhoneWorktreeBadge {
  id: 'new' | 'draft' | 'pending' | 'review' | 'approved' | 'merged';
  label: string;
  title: string;
  /** Red dot: merge conflicts, failing checks, or changes requested. */
  conflict?: boolean;
}

export interface PhoneWorktree {
  label: string;
  chats: PhoneChatSummary[];
  tags?: string[]; // shared labels; omitted when the workspace has none
  badge?: PhoneWorktreeBadge;
  blockedBy?: string[]; // source-ticket blockers; omitted when the ticket is clear
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
  /** Account settings for a new orchestration chat and a new worktree agent. */
  defaults?: PhoneAccountDefaults;
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
  | { op: 'assistant'; chatId: string; text: string; apps?: Array<{ id: string; tool: string }> } | PhoneMcpUiReply
  | { op: 'stream'; chatId: string; text: string; activity: string }
  | { op: 'ask'; chatId: string; text: string; questions: RemoteAskQuestion[] }
  | { op: 'permission'; chatId: string; prompt: PhonePermissionView | null }
  | { op: 'stopped'; chatId: string }
  | { op: 'media'; chatId: string; path: string; dataUrl?: string }
  | PhoneShownReply
  | PhonePaneReply
  | ({ op: 'header'; chatId: string } & PhoneHeader)
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
  if (op === 'open' || op === 'archive' || op === 'restore' || op === 'stop' || op === 'review' || op === 'header') {
    return { op, chatId };
  }
  if (op === 'git') {
    const action = textField(value, 'action');
    if (!PHONE_HEADER_GIT_ACTIONS.includes(action as PhoneHeaderGitAction)) return 'invalid';
    return { op: 'git', chatId, action: action as PhoneHeaderGitAction };
  }
  if (op === 'pane') return parsePhonePane(value, chatId);
  if (op === 'open-artifact') return parseOpenArtifact(value, chatId); if (op === 'mcp-ui' || op === 'mcp-ui-call' || op === 'mcp-ui-read' || op === 'mcp-ui-context') return parsePhoneMcpUi(value, op, chatId);
  if (op === 'open-file' || op === 'media') {
    const path = textField(value, 'path');
    if (!path || path.length > 2000) return 'invalid';
    if (op === 'media') return { op, chatId, path };
    const startLine = lineField(value, 'startLine');
    const endLine = lineField(value, 'endLine');
    const view = textField(value, 'view') === 'diff' ? 'diff' : undefined;
    const scope = phoneChangeScope((value as { scope?: unknown }).scope);
    const commitSha = phoneCommitSha((value as { commitSha?: unknown }).commitSha);
    return {
      op,
      chatId,
      path,
      ...(startLine != null ? { startLine } : {}),
      ...(endLine != null ? { endLine } : {}),
      ...(view ? { view } : {}),
      ...(view && scope ? { scope } : {}),
      ...(view && scope === 'commits' && commitSha ? { commitSha } : {}),
    };
  }
  const draft = parsePhoneDraft(value);
  if (draft === 'invalid') return 'invalid';
  if (op === 'options') return { op: 'options', chatId, ...draft };
  if (op === 'prompt') {
    const text = typeof (value as { text?: unknown }).text === 'string'
      ? (value as { text: string }).text.trim()
      : '';
    const hasPayload = Boolean(text || draft.files?.length || draft.links?.length || draft.refs?.length);
    if (!hasPayload) return 'invalid';
    return { op: 'prompt', chatId, text, ...draft };
  }
  return 'invalid';
}

function textField(value: object, key: string): string {
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function lineField(value: object, key: string): number | undefined {
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 1_000_000) return undefined;
  return raw;
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
  const refs = parsePhoneCodeRefs((value as { refs?: unknown }).refs);
  if (refs === 'invalid') return 'invalid';
  if (refs.length) draft.refs = refs;
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

function summarize(thread: Thread): PhoneChatSummary {
  const pr = phonePrPill(thread);
  const block = visibleAgentBlock(thread);
  return {
    id: thread.id,
    title: thread.title?.trim() || 'Untitled',
    status: thread.status,
    preview: previewOf(thread),
    updatedAt: thread.updatedAt,
    agent: thread.agent,
    ...(pr?.url ? { prUrl: pr.url } : {}),
    ...(pr?.number ? { prNumber: pr.number } : {}),
    ...(pr?.status ? { prStatus: pr.status } : {}),
    ...(block ? { needsYou: true as const, blockedReason: block.reason } : {}),
  };
}

function previewOf(thread: Thread): string {
  const last = listPhoneMessages(thread).at(-1);
  return last ? clip(last.text.replace(/\s+/g, ' ').trim(), PREVIEW_LIMIT) : '';
}

function repoName(repoPath: string): string {
  return repoPath.replace(/\/$/, '').split('/').pop() || repoPath;
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
export function listPhoneSidebar(viewerLogin = phoneViewerLogin()): PhoneSidebar {
  const settings = loadAppSettings();
  const threads = listThreads();
  const byRepo = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (!isProjectPath(thread.repoPath) || isRemovedWorkspace(thread.repoPath)) continue;
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
      worktrees: groupHomeBoardWorktrees(repoThreads).map((group) => {
        const tags = workspaceTagsFromGroup(group);
        const badge = classifyWorktreeListBadges(group, viewerLogin, resolveProjectReviewLabel(settings, path))[0];
        const blockedBy = issueBlockedByIds(group);
        return {
          label: worktreeAnchorLabel(group).title,
          chats: group.map(summarize),
          ...(tags.length > 0 ? { tags } : {}),
          ...(blockedBy.length > 0 ? { blockedBy } : {}),
          ...(badge ? { badge: { id: badge.id, label: badge.label, title: badge.title, ...(badge.conflict ? { conflict: true } : {}) } } : {}),
        };
      }),
    }));
  return { orchestration: listPhoneChats(), projects, defaults: phoneAccountDefaults() };
}

export { listPhoneHistory } from './phone-history.js';

function matchPhoneThread(chatId: string): Thread | null {
  const id = chatId.trim();
  if (!id) return null;
  const exact = readThread(id);
  if (exact) return exact;
  const match = findThreadByRef(id);
  if (!match) return null;
  if (match.id !== id && !match.id.startsWith(id)) return null;
  return match;
}

function visiblePhoneThread(thread: Thread): boolean {
  return isGlobalThread(thread) || isProjectPath(thread.repoPath);
}

/** Full id or `sideboard://chat/` prefix, including archived chats. */
export function findPhoneChat(chatId: string): Thread | null {
  const thread = matchPhoneThread(chatId);
  return thread && visiblePhoneThread(thread) ? thread : null;
}

export function readPhoneThread(chatId: string): Thread | null {
  const thread = findPhoneChat(chatId);
  return thread && thread.status !== 'archived' ? thread : null;
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
    worktree: worktreeAnchorLabel(group.length > 0 ? group : [thread]).title,
  };
}

export function assertKnownProject(repoPath: string): string {
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
  autonomy: Autonomy;
}) {
  return {
    agent: draft?.agent ?? defaults.agent,
    model: draft && 'model' in draft ? (draft.model ?? null) : defaults.model,
    effort: draft?.effort ?? defaults.effort,
    fast: draft?.fast ?? defaults.fast,
    planMode: Boolean(draft?.planMode),
    autonomy: draft?.autonomy ?? defaults.autonomy,
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
    reuseExisting: false,
  });
  return openedFrom(thread, projectPlace(thread));
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
