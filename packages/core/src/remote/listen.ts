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
import {
  phoneImageDataUrl,
  phoneWorktreeRelative,
  type PhoneOpenFileRequest,
} from './phone-media.js';
import { type PhoneOpenArtifactRequest } from './phone-artifact.js';
import {
  archivePhoneChat,
  createPhoneChat,
  createPhoneOrchestration,
  createPhoneProjectWorktree,
  createPhoneWorktreeAgent,
  listPhoneHistory,
  listPhoneModels,
  listPhoneSidebar,
  openPhoneChat,
  phoneComposerOptions,
  phoneTurnAttachments,
  findPhoneChat,
  readPhoneThread,
  takePhoneControl,
  type PhoneControlRequest,
  type PhoneDraft,
  type PhoneOpened,
} from './phone-chats.js';
import { listPhoneSources } from './phone-sources.js';
import {
  REMOTE_STOPPED_REPLY,
  bumpChat,
  chatGeneration,
  deliverPhoneTurn,
  emitChatTurn,
  emitControl,
  enqueueChat,
  finishPhoneTurn,
  interruptChat,
  getPhoneOpenChat,
  phoneError,
  phoneTurnGen,
  setPhoneOpenChat,
  watchPhoneStream,
  type RemoteOutbound,
} from './phone-live.js';

export { REMOTE_STOPPED_REPLY };
export type { RemoteOutbound };

export function formatRemotePrompt(text: string): string {
  return `Phone\n\n${text.trim()}`;
}

export function isRemoteStopCommand(text: string): boolean {
  return text.trim().toLowerCase() === 'stop';
}

let handleChain: Promise<void> = Promise.resolve();
let inboundGeneration = 0;

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

function emitOpened(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  opened: PhoneOpened,
): void {
  setPhoneOpenChat(opened.chat.id);
  emitControl(opts, { op: 'opened', ...opened });
}

function publishOpenedChat(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  chatId: string,
): void {
  const opened = openPhoneChat(chatId);
  if (!opened) {
    emitControl(opts, { op: 'error', message: 'That agent is not on this Mac.' });
    return;
  }
  emitOpened(opts, opened);
  if (opened.chat.status === 'running' || opened.chat.status === 'queued') {
    deliverPhoneTurn(opts, opened.chat.id);
  }
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
    onOpenWorktreeFile?: (request: PhoneOpenFileRequest) => void;
    onOpenArtifact?: (request: PhoneOpenArtifactRequest) => void;
  },
): void {
  const log = opts.onLog ?? (() => undefined);
  if (cmd.op === 'list') {
    // Back on Chats. A later desktop turn must not stream into the chat they left.
    setPhoneOpenChat(null);
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
      void (async () => {
        try {
          const opened = createPhoneWorktreeAgent(cmd.chatId, cmd);
          const prompt =
            cmd.prompt?.trim() ||
            (cmd.files?.length || cmd.links?.length ? 'See the attached files.' : '');
          if (prompt) {
            try {
              await getOrchestrator().send(opened.chat.id, formatRemotePrompt(prompt));
            } catch (err) {
              emitControl(opts, { op: 'error', chatId: opened.chat.id, message: phoneError(err) });
            }
          }
          const fresh = openPhoneChat(opened.chat.id) ?? opened;
          emitOpened(opts, fresh);
          if (prompt) deliverPhoneTurn(opts, fresh.chat.id);
        } catch (err) {
          emitControl(opts, { op: 'error', message: phoneError(err) });
        }
      })();
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
          emitOpened(opts, fresh);
          if (prompt) deliverPhoneTurn(opts, fresh.chat.id);
        })
        .catch((err: unknown) => {
          emitControl(opts, { op: 'error', message: phoneError(err) });
        });
      return;
    }
    const goal = cmd.goal?.trim() || cmd.prompt?.trim() || '';
    if (goal || cmd.files?.length || cmd.links?.length) {
      void createPhoneOrchestration({ ...cmd, goal })
        .then((opened) => {
          emitOpened(opts, opened);
          deliverPhoneTurn(opts, opened.chat.id);
        })
        .catch((err: unknown) => {
          emitControl(opts, { op: 'error', message: phoneError(err) });
        });
      return;
    }
    try {
      const agent = coerceOrchestratorAgent(
        cmd.agent ?? opts.agent ?? resolveOrchestratorDefaults().agent,
      );
      emitOpened(opts, createPhoneChat(agent));
    } catch (err) {
      emitControl(opts, { op: 'error', message: phoneError(err) });
    }
    return;
  }
  if (cmd.op === 'open') {
    const thread = findPhoneChat(cmd.chatId);
    if (!thread) {
      emitControl(opts, { op: 'error', message: 'That agent is not on this Mac.' });
      return;
    }
    if (thread.status === 'archived') {
      void getOrchestrator()
        .restore(thread.id)
        .then(() => {
          emitControl(opts, { op: 'sidebar', ...listPhoneSidebar() });
          publishOpenedChat(opts, thread.id);
        })
        .catch((err: unknown) => {
          emitControl(opts, { op: 'error', message: phoneError(err) });
        });
      return;
    }
    publishOpenedChat(opts, thread.id);
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
    if (getPhoneOpenChat() === thread.id) setPhoneOpenChat(null);
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
  if (cmd.op === 'media') {
    const thread = readPhoneThread(cmd.chatId);
    const dataUrl = thread ? phoneImageDataUrl(thread.worktreePath, cmd.path) : null;
    emitControl(opts, {
      op: 'media',
      chatId: cmd.chatId,
      path: cmd.path,
      ...(dataUrl ? { dataUrl } : {}),
    });
    return;
  }
  if (cmd.op === 'open-file') {
    const thread = readPhoneThread(cmd.chatId);
    const relative = thread ? phoneWorktreeRelative(thread.worktreePath, cmd.path) : null;
    if (!thread || !relative) {
      emitControl(opts, { op: 'error', chatId: cmd.chatId, message: 'That file is not in this worktree.' });
      return;
    }
    void getOrchestrator()
      .statPath(thread.id, relative)
      .then((kind) => {
        if (kind === 'missing') {
          emitControl(opts, { op: 'error', chatId: cmd.chatId, message: 'That file is not in this worktree.' });
          return;
        }
        opts.onOpenWorktreeFile?.({
          threadId: thread.id,
          path: relative,
          ...(kind === 'dir' ? { directory: true } : {}),
          ...(cmd.startLine != null ? { startLine: cmd.startLine } : {}),
          ...(cmd.endLine != null ? { endLine: cmd.endLine } : {}),
        });
      })
      .catch(() => {
        emitControl(opts, { op: 'error', chatId: cmd.chatId, message: 'That file is not in this worktree.' });
      });
    return;
  }
  if (cmd.op === 'open-artifact') {
    const thread = readPhoneThread(cmd.chatId);
    if (!thread) {
      emitControl(opts, { op: 'error', chatId: cmd.chatId, message: 'That agent is not on this Mac.' });
      return;
    }
    opts.onOpenArtifact?.({
      threadId: thread.id,
      title: cmd.title,
      ...(cmd.hint ? { hint: cmd.hint } : {}),
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
  phoneTurnGen.set(chatId, generation);
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
    const stopStream = watchPhoneStream(opts, chatId, thread.id, generation);
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
      await getOrchestrator().send(thread.id, formatted, { attachments: staged });
      await getOrchestrator().waitForTurn(thread.id, 14 * 60 * 1000);
    } catch (err) {
      if (chatGeneration.get(chatId) !== generation) return;
      const message = err instanceof Error ? err.message : String(err);
      emitControl(opts, { op: 'error', chatId, message: `Sideboard failed: ${message}` });
      return;
    } finally {
      stopStream();
      finishPhoneTurn(chatId, generation);
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
    onOpenWorktreeFile?: (request: PhoneOpenFileRequest) => void;
    onOpenArtifact?: (request: PhoneOpenArtifactRequest) => void;
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
