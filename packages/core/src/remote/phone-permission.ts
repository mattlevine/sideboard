/**
 * Phone Allow / Deny for a tool the agent cannot run until someone decides.
 * The desktop composer uses the same queue. A phone tap resolves it too.
 */
import { readThread } from '../store/thread-store.js';
import { answerToolPermission } from '../agents/tool-permission.js';

/** Same leading NUL as PHONE_CONTROL_PREFIX. Kept local so this file does not load the chat list. */
const PHONE_CONTROL_PREFIX = '\u0000sb.phone\n';

type PermissionReply =
  | { op: 'error'; message: string; chatId?: string }
  | { op: 'permission'; chatId: string; prompt: PhonePermissionView | null };

export type PhonePermissionDecision = 'allow' | 'deny' | 'allow_session';

export type PhonePermissionView = {
  id: string;
  title: string;
  detail: string;
  path?: string;
  allowSession: boolean;
  defaultToNo?: boolean;
};

export type PhonePermissionRequest = {
  op: 'permission';
  chatId: string;
  id: string;
  decision: PhonePermissionDecision;
};

const DECISIONS = new Set<PhonePermissionDecision>(['allow', 'deny', 'allow_session']);

type PhonePermissionPush = (chatId: string, prompt: PhonePermissionView | null) => void;

let push: PhonePermissionPush | null = null;

/** Remote host installs this so an in-progress phone chat sees the prompt. */
export function setPhonePermissionPush(next: PhonePermissionPush | null): void {
  push = next;
}

export function notifyPhonePermission(chatId: string, prompt: PhonePermissionView | null): void {
  const id = chatId.trim();
  if (!id) return;
  push?.(id, prompt);
}

export function permissionViewFromBlock(block: {
  source?: string;
  permission?: PhonePermissionView;
} | null | undefined): PhonePermissionView | null {
  if (!block || block.source !== 'permission') return null;
  const prompt = block.permission;
  if (!prompt?.id || !prompt.title) return null;
  return {
    id: prompt.id,
    title: prompt.title,
    detail: typeof prompt.detail === 'string' ? prompt.detail : '',
    ...(prompt.path ? { path: prompt.path } : {}),
    allowSession: prompt.allowSession !== false,
    ...(prompt.defaultToNo ? { defaultToNo: true } : {}),
  };
}

/** Pending prompt stored on the chat, if the agent is still waiting. */
export function phonePermissionView(chatId: string): PhonePermissionView | null {
  return permissionViewFromBlock(readThread(chatId)?.agentBlock);
}

function textField(value: object, key: string): string {
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Null when this message is not a permission answer. `invalid` when it is, but incomplete. */
export function takePhonePermission(text: string): PhonePermissionRequest | 'invalid' | null {
  if (!text.startsWith(PHONE_CONTROL_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(PHONE_CONTROL_PREFIX.length));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if ((parsed as { op?: unknown }).op !== 'permission') return null;
  const chatId = textField(parsed, 'chatId');
  const id = textField(parsed, 'id');
  const decision = textField(parsed, 'decision');
  if (!chatId || !id || !DECISIONS.has(decision as PhonePermissionDecision)) return 'invalid';
  return { op: 'permission', chatId, id, decision: decision as PhonePermissionDecision };
}

/**
 * True when this inbound was a permission answer (including a bad one).
 * A successful tap does not emit: clearing the prompt tells the phone to hide the bar.
 */
export function dispatchPhonePermission(
  text: string,
  emit: (reply: PermissionReply) => void,
): boolean {
  const cmd = takePhonePermission(text);
  if (cmd == null) return false;
  if (cmd === 'invalid') {
    emit({ op: 'error', message: 'invalid phone command' });
    return true;
  }
  if (!answerToolPermission(cmd.id, cmd.decision)) {
    emit({ op: 'error', chatId: cmd.chatId, message: 'That request already finished.' });
    emit({ op: 'permission', chatId: cmd.chatId, prompt: phonePermissionView(cmd.chatId) });
  }
  return true;
}
