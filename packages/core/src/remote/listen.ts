import type { AgentKind, ThreadAttachment } from '../types/thread.js';
import { coerceOrchestratorAgent } from '../agents/orchestrator-capable.js';
import { stageBuffersAsAttachments } from '../composer/stage-files.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import { outboundReplyFromTurn } from '../orchestrator/outbound-turn-reply.js';
import { extractPendingPlanQuestions } from '../plan/ask-user.js';
import { resolveOrchestratorDefaults } from '../store/app-settings.js';
import {
  ensureRemoteCoordinator,
  findRemoteCoordinator,
} from '../store/global-workspace.js';
import { readThread } from '../store/thread-store.js';
import { resolveCreateFirstPrompt } from '../threads/implied-first-prompt.js';
import type { RemoteAskQuestion } from './protocol.js';
import {
  archivePhoneChat,
  createPhoneChat,
  createPhoneOrchestration,
  createPhoneProjectWorktree,
  createPhoneWorktreeAgent,
  encodePhoneControl,
  listPhoneHistory,
  listPhoneModels,
  listPhoneSidebar,
  listPhoneSources,
  openPhoneChat,
  phoneComposerOptions,
  phoneTurnAttachments,
  readPhoneThread,
  takePhoneControl,
  type PhoneControlReply,
  type PhoneControlRequest,
  type PhoneDraft,
} from './phone-chats.js';

export const REMOTE_STOPPED_REPLY = 'Sideboard stopped the in-progress turn.';

export function formatRemotePrompt(text: string): string {
  return `Phone\n\n${text.trim()}`;
}

export function isRemoteStopCommand(text: string): boolean {
  return text.trim().toLowerCase() === 'stop';
}

export type RemoteOutbound =
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: RemoteAskQuestion[] };

let handleChain: Promise<void> = Promise.resolve();
let inboundGeneration = 0;
const chatChains = new Map<string, Promise<void>>();
const chatGeneration = new Map<string, number>();

function enqueue(fn: () => Promise<void>): void {
  const run = handleChain.then(fn, fn);
  handleChain = run.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Kill an in-flight phone turn before the handle queue runs.
 * `stop` inside the queue cannot unblock the previous `waitForTurn`.
 */
export function interruptRemoteCoordinator(
  deviceId: string,
  log: (line: string) => void = () => undefined,
): boolean {
  try {
    const live = findRemoteCoordinator(deviceId);
    if (!live) return false;
    const fresh = readThread(live.id) ?? live;
    if (fresh.status !== 'running' && fresh.status !== 'queued') return false;
    getOrchestrator().stop(fresh.id, { clearQueue: true });
    log(`interrupt phone → coordinator ${fresh.id.slice(0, 8)} (${fresh.status})`);
    return true;
  } catch (err) {
    log(`interrupt: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Phone text → Global orchestrator on this Mac → reply or ask_user buttons.
 * Same turn loop as Slack Listen, without Slack.
 */
function bumpChat(chatId: string): number {
  const next = (chatGeneration.get(chatId) ?? 0) + 1;
  chatGeneration.set(chatId, next);
  return next;
}

function enqueueChat(chatId: string, fn: () => Promise<void>): void {
  const prev = chatChains.get(chatId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chatChains.set(
    chatId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
}

function emitControl(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  reply: PhoneControlReply,
): void {
  opts.onOutbound({ type: 'assistant', text: encodePhoneControl(reply) });
}

function interruptChat(chatId: string, log: (line: string) => void): boolean {
  try {
    const thread = readPhoneThread(chatId);
    if (!thread) return false;
    if (thread.status !== 'running' && thread.status !== 'queued') return false;
    getOrchestrator().stop(thread.id, { clearQueue: true });
    log(`interrupt phone → chat ${thread.id.slice(0, 8)} (${thread.status})`);
    return true;
  } catch (err) {
    log(`interrupt chat: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function emitChatTurn(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  chatId: string,
  threadId: string,
): void {
  const thread = readThread(threadId);
  if (!thread) {
    emitControl(opts, { op: 'error', chatId, message: 'That agent is not on this Mac.' });
    return;
  }
  if (thread.status === 'stopped') {
    emitControl(opts, { op: 'stopped', chatId });
    return;
  }
  const result = getOrchestrator().getTurnResult(thread.id);
  const pending = extractPendingPlanQuestions(
    [...thread.messages].reverse().find((m) => m.role === 'agent')?.parts,
  );
  if (result.taskState === 'input-required' && pending) {
    emitControl(opts, {
      op: 'ask',
      chatId,
      text: result.text.trim(),
      questions: pending.questions.map((q) => ({
        question: q.question,
        options: q.options.map((o) =>
          o.description ? { label: o.label, description: o.description } : { label: o.label },
        ),
      })),
    });
    return;
  }
  const reply = outboundReplyFromTurn(result, {
    inputRequired: 'Sideboard is waiting for an answer.',
    canceled: REMOTE_STOPPED_REPLY,
    completedEmpty: () => '',
    failed: (detail) =>
      detail ? `Sideboard failed: ${detail}` : 'Sideboard failed before producing a result.',
  });
  emitControl(opts, { op: 'assistant', chatId, text: reply.trim() });
}

/**
 * List, create, open, archive, and restore chats.
 * Runs outside the single-coordinator queue so one agent does not block the list.
 */
function phoneError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyPhoneOptions(chatId: string, draft: PhoneDraft): void {
  const patch: PhoneDraft = {};
  if (draft.agent) patch.agent = draft.agent;
  if ('model' in draft) patch.model = draft.model ?? null;
  if (draft.effort) patch.effort = draft.effort;
  if (draft.fast !== undefined) patch.fast = draft.fast;
  if (draft.planMode !== undefined) patch.planMode = draft.planMode;
  if (draft.autonomy) patch.autonomy = draft.autonomy;
  if (Object.keys(patch).length === 0) return;
  getOrchestrator().setThreadOptions(chatId, patch);
}

function stagePhoneTurnFiles(worktreePath: string, draft: PhoneDraft): ThreadAttachment[] {
  const links = phoneTurnAttachments({ links: draft.links });
  const files = stageBuffersAsAttachments(
    worktreePath,
    (draft.files ?? []).map((file) => ({ name: file.name, dataBase64: file.dataBase64 })),
  );
  return [...links, ...files];
}

function handlePhoneControl(
  cmd: PhoneControlRequest,
  opts: {
    agent?: AgentKind;
    onOutbound: (msg: RemoteOutbound) => void;
    onLog?: (line: string) => void;
    transcribeWav?: (wavBase64: string) => Promise<string>;
  },
): void {
  const log = opts.onLog ?? (() => undefined);
  if (cmd.op === 'list') {
    emitControl(opts, { op: 'sidebar', ...listPhoneSidebar() });
    return;
  }
  if (cmd.op === 'history') {
    const page = listPhoneHistory({ query: cmd.query, after: cmd.after });
    emitControl(opts, {
      op: 'history',
      chats: page.chats,
      total: page.total,
      ...(page.next ? { next: page.next } : {}),
      ...(cmd.query ? { query: cmd.query } : {}),
      ...(cmd.after ? { after: cmd.after } : {}),
    });
    return;
  }
  if (cmd.op === 'sources') {
    const repoPath = cmd.repoPath;
    const query = cmd.query;
    void listPhoneSources(repoPath, query)
      .then((page) =>
        emitControl(opts, {
          op: 'sources',
          repoPath,
          ...(query ? { query } : {}),
          ...page,
        }),
      )
      .catch((err: unknown) => {
        emitControl(opts, { op: 'error', message: phoneError(err) });
      });
    return;
  }
  if (cmd.op === 'models') {
    const agent = cmd.agent;
    void listPhoneModels(agent)
      .then((models) => emitControl(opts, { op: 'models', agent, models }))
      .catch((err: unknown) => {
        emitControl(opts, { op: 'error', message: phoneError(err) });
      });
    return;
  }
  if (cmd.op === 'dictate') {
    const id = cmd.id;
    const transcribe = opts.transcribeWav;
    if (!transcribe) {
      emitControl(opts, { op: 'error', message: 'Speech is not available on this Mac.' });
      return;
    }
    void transcribe(cmd.audioBase64)
      .then((text) => emitControl(opts, { op: 'dictated', id, text: text.trim() }))
      .catch((err: unknown) => {
        emitControl(opts, { op: 'error', message: phoneError(err) });
      });
    return;
  }
  if (cmd.op === 'options') {
    const thread = readPhoneThread(cmd.chatId);
    if (!thread) {
      emitControl(opts, { op: 'error', chatId: cmd.chatId, message: 'That agent is not on this Mac.' });
      return;
    }
    try {
      applyPhoneOptions(thread.id, cmd);
      const fresh = readPhoneThread(thread.id) ?? thread;
      emitControl(opts, { op: 'options', chatId: fresh.id, ...phoneComposerOptions(fresh) });
    } catch (err) {
      emitControl(opts, { op: 'error', chatId: cmd.chatId, message: phoneError(err) });
    }
    return;
  }
  if (cmd.op === 'create') {
    if (cmd.where === 'worktree') {
      try {
        const opened = createPhoneWorktreeAgent(cmd.chatId, cmd);
        const prompt =
          cmd.prompt?.trim() ||
          (cmd.files?.length || cmd.links?.length ? 'See the attached files.' : '');
        if (prompt) {
          void getOrchestrator()
            .send(opened.chat.id, formatRemotePrompt(prompt))
            .catch((err: unknown) => {
              emitControl(opts, { op: 'error', chatId: opened.chat.id, message: phoneError(err) });
            });
        }
        emitControl(opts, { op: 'opened', ...opened });
      } catch (err) {
        emitControl(opts, { op: 'error', message: phoneError(err) });
      }
      return;
    }
    if (cmd.where === 'project') {
      void createPhoneProjectWorktree(cmd)
        .then(async (opened) => {
          const prompt =
            resolveCreateFirstPrompt({
              sourceType: cmd.sourceType ?? 'branch',
              prompt: cmd.prompt,
            }) || (cmd.files?.length || cmd.links?.length ? 'See the attached files.' : '');
          if (prompt) {
            try {
              await getOrchestrator().send(opened.chat.id, formatRemotePrompt(prompt));
            } catch (err) {
              emitControl(opts, { op: 'error', chatId: opened.chat.id, message: phoneError(err) });
            }
          }
          const fresh = openPhoneChat(opened.chat.id) ?? opened;
          emitControl(opts, { op: 'opened', ...fresh });
        })
        .catch((err: unknown) => {
          emitControl(opts, { op: 'error', message: phoneError(err) });
        });
      return;
    }
    const goal = cmd.goal?.trim() || cmd.prompt?.trim() || '';
    if (goal || cmd.files?.length || cmd.links?.length) {
      void createPhoneOrchestration({ ...cmd, goal })
        .then((opened) => emitControl(opts, { op: 'opened', ...opened }))
        .catch((err: unknown) => {
          emitControl(opts, { op: 'error', message: phoneError(err) });
        });
      return;
    }
    try {
      const agent = coerceOrchestratorAgent(
        cmd.agent ?? opts.agent ?? resolveOrchestratorDefaults().agent,
      );
      emitControl(opts, { op: 'opened', ...createPhoneChat(agent) });
    } catch (err) {
      emitControl(opts, { op: 'error', message: phoneError(err) });
    }
    return;
  }
  if (cmd.op === 'open') {
    const opened = openPhoneChat(cmd.chatId);
    if (!opened) {
      emitControl(opts, { op: 'error', message: 'That agent is not on this Mac.' });
      return;
    }
    emitControl(opts, { op: 'opened', ...opened });
    return;
  }
  if (cmd.op === 'archive') {
    const thread = readPhoneThread(cmd.chatId);
    if (!thread) {
      emitControl(opts, { op: 'error', message: 'That agent is not on this Mac.' });
      return;
    }
    bumpChat(thread.id);
    interruptChat(thread.id, log);
    archivePhoneChat(thread.id);
    emitControl(opts, { op: 'sidebar', ...listPhoneSidebar() });
    return;
  }
  if (cmd.op === 'restore') {
    const chatId = cmd.chatId;
    void getOrchestrator()
      .restore(chatId)
      .then(() => {
        emitControl(opts, { op: 'sidebar', ...listPhoneSidebar() });
        emitControl(opts, { op: 'restored', chatId });
      })
      .catch((err: unknown) => {
        emitControl(opts, {
          op: 'error',
          chatId,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  if (cmd.op === 'stop') {
    if (!readPhoneThread(cmd.chatId)) {
      emitControl(opts, { op: 'error', chatId: cmd.chatId, message: 'That agent is not on this Mac.' });
      return;
    }
    bumpChat(cmd.chatId);
    interruptChat(cmd.chatId, log);
    emitControl(opts, { op: 'stopped', chatId: cmd.chatId });
    return;
  }

  const chatId = cmd.chatId;
  const generation = bumpChat(chatId);
  interruptChat(chatId, log);
  enqueueChat(chatId, async () => {
    if (chatGeneration.get(chatId) !== generation) return;
    const thread = readPhoneThread(chatId);
    if (!thread) {
      emitControl(opts, { op: 'error', chatId, message: 'That agent is not on this Mac.' });
      return;
    }
    if (thread.status === 'running' || thread.status === 'queued') {
      try {
        getOrchestrator().stop(thread.id, { clearQueue: true });
      } catch {
        // the next send still replaces the turn
      }
    }
    if (chatGeneration.get(chatId) !== generation) return;
    try {
      try {
        applyPhoneOptions(thread.id, cmd);
      } catch (err) {
        emitControl(opts, { op: 'error', chatId, message: phoneError(err) });
      }
      const live = readPhoneThread(thread.id) ?? thread;
      const staged = stagePhoneTurnFiles(live.worktreePath, cmd);
      const text = cmd.text.trim() || (staged.length ? 'See the attached files.' : '');
      const formatted = formatRemotePrompt(text);
      if (staged.length) {
        await getOrchestrator().send(thread.id, formatted, { attachments: staged });
      } else {
        await getOrchestrator().send(thread.id, formatted);
      }
      await getOrchestrator().waitForTurn(thread.id, 14 * 60 * 1000);
    } catch (err) {
      if (chatGeneration.get(chatId) !== generation) return;
      const message = err instanceof Error ? err.message : String(err);
      emitControl(opts, { op: 'error', chatId, message: `Sideboard failed: ${message}` });
      return;
    }
    if (chatGeneration.get(chatId) !== generation) return;
    emitChatTurn(opts, chatId, thread.id);
  });
}

export function handleRemoteInbound(
  text: string,
  opts: {
    deviceId: string;
    agent?: AgentKind;
    onOutbound: (msg: RemoteOutbound) => void;
    onLog?: (line: string) => void;
    transcribeWav?: (wavBase64: string) => Promise<string>;
  },
): void {
  const log = opts.onLog ?? (() => undefined);
  const body = text.trim();
  const control = takePhoneControl(body);
  if (control) {
    if (control === 'invalid') {
      emitControl(opts, { op: 'error', message: 'invalid phone command' });
      return;
    }
    handlePhoneControl(control, opts);
    return;
  }
  const generation = ++inboundGeneration;
  if (body) interruptRemoteCoordinator(opts.deviceId, log);
  enqueue(async () => {
    if (generation !== inboundGeneration) return;
    const agent = coerceOrchestratorAgent(opts.agent ?? resolveOrchestratorDefaults().agent);
    if (!body) return;
    if (isRemoteStopCommand(body)) {
      if (generation !== inboundGeneration) return;
      opts.onOutbound({ type: 'assistant', text: REMOTE_STOPPED_REPLY });
      return;
    }

    let thread = ensureRemoteCoordinator(opts.deviceId, agent);
    const fresh = readThread(thread.id) ?? thread;
    if (fresh.status === 'running' || fresh.status === 'queued') {
      try {
        getOrchestrator().stop(fresh.id, { clearQueue: true });
      } catch {
        // the next send still replaces the turn
      }
    }
    if (generation !== inboundGeneration) return;
    const orch = getOrchestrator();
    try {
      await orch.send(thread.id, formatRemotePrompt(body));
      await orch.waitForTurn(thread.id, 14 * 60 * 1000);
    } catch (err) {
      if (generation !== inboundGeneration) return;
      const message = err instanceof Error ? err.message : String(err);
      opts.onOutbound({ type: 'assistant', text: `Sideboard failed: ${message}` });
      return;
    }
    if (generation !== inboundGeneration) return;
    thread = readThread(thread.id) ?? thread;
    if (thread.status === 'stopped') return;
    const result = orch.getTurnResult(thread.id);
    const pending = extractPendingPlanQuestions(
      [...thread.messages].reverse().find((m) => m.role === 'agent')?.parts,
    );
    if (result.taskState === 'input-required' && pending) {
      opts.onOutbound({
        type: 'ask_user',
        text: result.text.trim(),
        questions: pending.questions.map((q) => ({
          question: q.question,
          options: q.options.map((o) =>
            o.description ? { label: o.label, description: o.description } : { label: o.label },
          ),
        })),
      });
      return;
    }
    const reply = outboundReplyFromTurn(result, {
      inputRequired: 'Sideboard is waiting for an answer.',
      canceled: REMOTE_STOPPED_REPLY,
      completedEmpty: () => '',
      failed: (detail) =>
        detail ? `Sideboard failed: ${detail}` : 'Sideboard failed before producing a result.',
    });
    if (reply.trim()) opts.onOutbound({ type: 'assistant', text: reply.trim() });
  });
}
