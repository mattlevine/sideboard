import { defaultAcpHarness } from '../agents/acp-harness.js';
import { listModelsForAgent } from '../agents/list-models.js';
import { persistPendingFileAttachments } from '../composer/stage-files.js';
import { startOrchestration } from '../orchestrator/orchestrator.js';
import { resolveNewThreadOptions, resolveOrchestratorDefaults } from '../store/app-settings.js';
import { createGlobalChat, isGlobalThread } from '../store/global-workspace.js';
import { readThread, updateThread } from '../store/thread-store.js';
import { createChatTab } from '../threads/chat-tabs.js';
import { createThread } from '../threads/create.js';
import type { AgentKind, Autonomy } from '../types/thread.js';
import type { ThinkingEffort } from '../types/thinking-effort.js';
import {
  assertKnownProject,
  openedFrom,
  phoneTurnAttachments,
  projectPlace,
  readPhoneThread,
  type PhoneDraft,
  type PhoneModelRow,
  type PhoneOpened,
} from './phone-chats.js';

function phoneAcpHarness(
  agent: AgentKind,
  raw: 'gemini' | 'copilot' | null | undefined,
): 'gemini' | 'copilot' | null {
  if (agent !== 'acp') return null;
  if (raw === 'gemini' || raw === 'copilot') return raw;
  return defaultAcpHarness();
}

function draftAgentOptions(draft: PhoneDraft | undefined, defaults: {
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  autonomy: Autonomy;
}) {
  const agent = draft?.agent ?? defaults.agent;
  return {
    agent,
    acpHarness: phoneAcpHarness(agent, draft?.acpHarness),
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
    ...(options.agent === 'acp' ? { acpHarness: options.acpHarness ?? undefined } : {}),
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
    ...(options.agent === 'acp' ? { acpHarness: options.acpHarness ?? undefined } : {}),
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
