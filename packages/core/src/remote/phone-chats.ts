import { randomUUID } from 'node:crypto';
import { classifyWorktreeListBadges, groupHomeBoardWorktrees, issueBlockedByIds, visibleAgentBlock } from '../board/home-board.js';
import { workspaceRowLabel, workspaceTagsFromGroup, worktreeAnchorLabel } from '../git/worktree-labels.js';
import type {
  AgentKind,
  Autonomy,
  Thread,
  ThreadAttachment,
  ThreadStatus,
} from '../types/thread.js';
import { isThinkingEffort, type ThinkingEffort } from '../types/thinking-effort.js';
import { latestPendingPlanQuestions } from '../plan/ask-user.js';
import { PLAN_FILE_REL } from '../plan/plan-present.js';
import type { RemoteAskQuestion } from './protocol.js';
import { loadAppSettings, resolveProjectReviewLabel } from '../store/app-settings.js';
import { isGlobalThread, listGlobalThreads } from '../store/global-workspace.js';
import { findThreadByRef, listThreads, readThread } from '../store/thread-store.js';
import { isRemovedWorkspace, listWorkspaces } from '../store/workspaces.js';
import { threadsSharingWorktree } from '../threads/chat-tabs.js';
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
import { phoneReviewPrFields, type PhoneReviewPr } from './phone-review-prs.js';
import { phoneViewerLogin } from './phone-viewer-login.js';
import { permissionViewFromBlock, type PhonePermissionView } from './phone-permission.js';
import { clip, listPhoneMessages, parsePhoneMcpUi, phoneVisibleText, type PhoneMcpAppsField, type PhoneMcpUiReply, type PhoneMcpUiRequest } from './phone-transcript.js';

/** Phone control rides in prompt text. The leading NUL keeps a person from typing it. */
export const PHONE_CONTROL_PREFIX = '\u0000sb.phone\n';

const PREVIEW_LIMIT = 90;

/** Same Approve message as the desktop composer with an empty notes field. */
export function phonePlanApproveText(): string {
  return `Implement the plan in ${PLAN_FILE_REL}.`;
}

/** Options the open chat and the Needs you list both send as a prompt. */
export function phoneAskQuestions(
  questions: Array<{ question: string; options: Array<{ label: string; description?: string }> }>,
): RemoteAskQuestion[] {
  return questions.map((question) => ({
    question: question.question,
    options: question.options.map((option) =>
      option.description
        ? { label: option.label, description: option.description }
        : { label: option.label },
    ),
  }));
}

export interface PhoneListAskQuestion extends RemoteAskQuestion {
  header?: string;
}

export interface PhoneListAsk {
  questions: PhoneListAskQuestion[];
}

export interface PhoneListPlan {
  /** Prompt text for Approve. The phone also turns plan mode off. */
  text: string;
}

export interface PhoneChatSummary {
  id: string;
  title: string;
  status: ThreadStatus;
  preview: string;
  updatedAt: string;
  agent: AgentKind;
  /** Gemini CLI or Copilot CLI when `agent` is `acp`. */
  acpHarness?: 'gemini' | 'copilot';
  /** Set when this chat has a pull request. The phone paints the desktop PR pill from these. */
  prUrl?: string;
  prNumber?: string;
  prStatus?: string;
  /** Set when this agent is waiting on a person (permission, ask, plan, or a reported block). */
  needsYou?: boolean;
  blockedReason?: string;
  /** ask_user choices. Present only when the row can answer without opening the chat. */
  ask?: PhoneListAsk;
  /** Allow / Deny payload. Same view the open chat's permission bar uses. */
  permission?: PhonePermissionView;
  /** Plan approval. Approve sends `text` and turns plan mode off. */
  plan?: PhoneListPlan;
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
  /** Set when `agent` is `acp`. */
  acpHarness?: 'gemini' | 'copilot' | null;
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

const AGENT_KINDS = new Set<AgentKind>(['claude', 'codex', 'opencode', 'brightsy', 'cursor', 'acp']);

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
  agent: string;
  acpHarness?: 'gemini' | 'copilot';
  workspace?: string;
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
  acpHarness?: 'gemini' | 'copilot' | null;
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
      /** Needs you opens an existing PR checkout instead of making a second one. */
      reuseExisting?: boolean;
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
  workspace?: string;
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
  /**
   * Open PRs waiting on this person's review (`list_prs` queue=mine).
   * Present after the first poll, including when the list is empty.
   */
  reviews?: PhoneReviewPr[];
  reviewsError?: string;
  reviewsReady?: boolean;
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
  if ('acpHarness' in value) {
    const harness = (value as { acpHarness?: unknown }).acpHarness;
    if (harness === null || harness === '') draft.acpHarness = null;
    else if (harness === 'gemini' || harness === 'copilot') draft.acpHarness = harness;
    else return 'invalid';
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
    const reuseExisting = (value as { reuseExisting?: unknown }).reuseExisting === true;
    return {
      op: 'create',
      where: 'project',
      repoPath,
      ...draft,
      ...(sourceType ? { sourceType } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(title ? { title } : {}),
      ...(cowboy ? { cowboy: true } : {}),
      ...(reuseExisting ? { reuseExisting: true } : {}),
    };
  }
  return 'invalid';
}

function listAsk(questions: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }> }>): PhoneListAsk {
  return {
    questions: phoneAskQuestions(questions).map((question, index) => ({
      ...question,
      ...(questions[index]?.header?.trim() ? { header: questions[index]!.header!.trim() } : {}),
    })),
  };
}

/** Reason plus the payload a Needs you row can answer without `op: 'open'`. */
function needsYouFields(thread: Thread): Pick<PhoneChatSummary, 'needsYou' | 'blockedReason' | 'ask' | 'permission' | 'plan'> {
  const block = visibleAgentBlock(thread);
  if (!block) return {};
  const base = { needsYou: true as const, blockedReason: block.reason };
  if (block.source === 'permission') {
    const permission = permissionViewFromBlock(block);
    return permission ? { ...base, permission } : base;
  }
  if (block.source === 'plan') {
    return { ...base, plan: { text: phonePlanApproveText() } };
  }
  if (block.source === 'ask_user') {
    const pending = latestPendingPlanQuestions({
      messages: thread.messages,
      agentBlock: thread.agentBlock,
      dismissedQuestionSignature: thread.dismissedQuestionSignature,
      status: thread.status,
    });
    if (!pending?.questions.length) return base;
    return { ...base, ask: listAsk(pending.questions) };
  }
  return base;
}

function summarize(thread: Thread): PhoneChatSummary {
  const pr = phonePrPill(thread);
  return {
    id: thread.id,
    title: thread.title?.trim() || 'Untitled',
    status: thread.status,
    preview: previewOf(thread),
    updatedAt: thread.updatedAt,
    agent: thread.agent,
    ...(thread.agent === 'acp'
      ? { acpHarness: thread.acpHarness === 'copilot' ? 'copilot' as const : 'gemini' as const }
      : {}),
    ...(pr?.url ? { prUrl: pr.url } : {}),
    ...(pr?.number ? { prNumber: pr.number } : {}),
    ...(pr?.status ? { prStatus: pr.status } : {}),
    ...needsYouFields(thread),
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
          ...workspaceRowLabel(group),
          chats: group.map(summarize),
          ...(tags.length > 0 ? { tags } : {}),
          ...(blockedBy.length > 0 ? { blockedBy } : {}),
          ...(badge ? { badge: { id: badge.id, label: badge.label, title: badge.title, ...(badge.conflict ? { conflict: true } : {}) } } : {}),
        };
      }),
    }));
  return {
    orchestration: listPhoneChats(),
    projects,
    defaults: phoneAccountDefaults(),
    ...phoneReviewPrFields(),
  };
}

export { listPhoneHistory } from './phone-history.js';
export {
  archivePhoneChat,
  createPhoneChat,
  createPhoneOrchestration,
  createPhoneProjectWorktree,
  createPhoneWorktreeAgent,
  listPhoneModels,
} from './phone-create.js';
export type { PhoneProjectCreate } from './phone-create.js';

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
    ...(thread.agent === 'acp'
      ? { acpHarness: thread.acpHarness === 'copilot' ? 'copilot' as const : 'gemini' as const }
      : {}),
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

export function openedFrom(thread: Thread, place: PhonePlace): PhoneOpened {
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

export function projectPlace(thread: Thread): PhonePlace {
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
