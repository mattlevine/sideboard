import { getOrchestrator } from '../orchestrator/orchestrator.js';
import type { PhoneControlReply, PhoneControlRequest } from './phone-chats.js';
import { readPhoneThread } from './phone-chats.js';
import { readPhoneHeader } from './phone-header.js';
import { readPhonePane } from './phone-panes.js';

type WorkspaceCmd = Extract<PhoneControlRequest, { op: 'pane' | 'header' | 'git' | 'review' }>;

/** Files, Changes, Checks, the git header, and the header's git actions. */
export function dispatchPhoneWorkspace(
  cmd: WorkspaceCmd,
  emit: (reply: PhoneControlReply) => void,
  publishOpened: (chatId: string) => void,
): void {
  if (cmd.op === 'pane') {
    const thread = readPhoneThread(cmd.chatId);
    if (!thread) {
      emit({ op: 'error', chatId: cmd.chatId, message: 'That agent is not on this Mac.' });
      return;
    }
    void readPhonePane(thread, cmd.pane, cmd.scope, cmd.query, cmd.commitSha).then((body) => {
      emit({
        op: 'pane',
        chatId: cmd.chatId,
        pane: cmd.pane,
        rows: body.rows,
        ...(body.note ? { note: body.note } : {}),
        ...(cmd.pane === 'files' ? { query: cmd.query ?? '' } : {}),
        ...(cmd.pane === 'changes'
          ? {
              scope: body.scope,
              commitSha: body.commitSha ?? null,
              hasLastTurnBase: body.hasLastTurnBase,
              commits: body.commits ?? [],
              ...(body.scopeStats ? { scopeStats: body.scopeStats } : {}),
            }
          : {}),
      });
    });
    return;
  }
  if (cmd.op === 'header') {
    const thread = readPhoneThread(cmd.chatId);
    if (!thread) {
      emit({ op: 'error', chatId: cmd.chatId, message: 'That agent is not on this Mac.' });
      return;
    }
    void readPhoneHeader(thread).then((header) => {
      emit({ op: 'header', chatId: cmd.chatId, ...header });
    });
    return;
  }
  if (cmd.op === 'git') {
    void getOrchestrator()
      .askGit(cmd.chatId, cmd.action)
      .then((tab) => publishOpened(tab.id))
      .catch((err: unknown) => {
        emit({
          op: 'error',
          chatId: cmd.chatId,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  void getOrchestrator()
    .requestReview(cmd.chatId)
    .then((tab) => publishOpened(tab.id))
    .catch((err: unknown) => {
      emit({
        op: 'error',
        chatId: cmd.chatId,
        message: err instanceof Error ? err.message : String(err),
      });
    });
}
