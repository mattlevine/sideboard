import type { Dispatch, SetStateAction } from 'react';
import type { ComposerOptions, FileChip, LinkChip } from './chat-ui';
import { phoneSendExtras, type PhoneCodeSelection } from './phone-code-ref';
import type { PhoneChat } from './phone-chrome';
import type { PhonePermission, PhonePermissionDecision } from './phone-prompts';
import { pushBubble, settleBubbles, type OpenedBubble } from './transcript';

type SendTranscript = {
  bubbles: OpenedBubble[];
  questions: unknown;
  working: boolean;
  activity?: string;
};

const EMPTY: SendTranscript = { bubbles: [], questions: null, working: false };

type CodeRef = PhoneCodeSelection & { id: string };

/** Resume the Mac link, then send. Same path as a composer send. */
export function sendOrResume(
  payload: object,
  link: {
    attached: boolean;
    send: (payload: object) => void;
    scheduleResume: () => void;
    queue: (payload: object) => void;
    token: string | undefined;
  },
) {
  if (link.attached) {
    link.send(payload);
    return;
  }
  link.queue(payload);
  if (link.token) link.send({ type: 'resume', sessionToken: link.token });
  link.scheduleResume();
}

function clearListBlock(chatId: string, patchChat: (chatId: string, patch: Partial<PhoneChat>) => void) {
  patchChat(chatId, {
    needsYou: undefined,
    blockedReason: undefined,
    ask: undefined,
    permission: undefined,
    plan: undefined,
    status: 'running',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Composer send plus Needs you answers from the list. Lives outside App.tsx
 * so that screen can stay under the line cap.
 */
export function usePhoneOutbound<T extends SendTranscript>(input: {
  activeChatIdRef: { current: string | null };
  files: FileChip[];
  links: LinkChip[];
  codeRefs: CodeRef[];
  pinTranscriptRef: { current: boolean };
  setTranscripts: Dispatch<SetStateAction<Record<string, T>>>;
  setDraft: (value: string) => void;
  setFiles: Dispatch<SetStateAction<FileChip[]>>;
  setLinks: Dispatch<SetStateAction<LinkChip[]>>;
  setCodeRefs: Dispatch<SetStateAction<CodeRef[]>>;
  patchChat: (chatId: string, patch: Partial<PhoneChat>) => void;
  chatOptions: Record<string, ComposerOptions>;
  command: (payload: object) => object;
  attachedRef: { current: boolean };
  send: (payload: object) => void;
  scheduleResume: () => void;
  pendingSendRef: { current: object | null };
  token: () => string | undefined;
  setPermissionByChat: Dispatch<SetStateAction<Record<string, PhonePermission | null>>>;
}) {
  const deliver = (payload: object) => {
    sendOrResume(payload, {
      attached: input.attachedRef.current,
      send: input.send,
      scheduleResume: input.scheduleResume,
      queue: (body) => {
        input.pendingSendRef.current = body;
      },
      token: input.token(),
    });
  };

  const sendText = (text: string) => {
    const body = text.trim();
    const id = input.activeChatIdRef.current;
    const extras = phoneSendExtras(input.files, input.links, input.codeRefs);
    const stopping = body.toLowerCase() === 'stop';
    if ((!body && !extras.attached) || !id) return;
    const bubble = [body, ...extras.names].filter(Boolean).join('\n');
    if (!stopping) input.pinTranscriptRef.current = true;
    input.setTranscripts((prev) => {
      const current = prev[id] ?? (EMPTY as T);
      return {
        ...prev,
        [id]: stopping
          ? {
              ...current,
              bubbles: settleBubbles(current.bubbles),
              questions: null,
              working: false,
              activity: '',
            }
          : {
              bubbles: pushBubble(settleBubbles(current.bubbles), 'user', bubble),
              questions: null,
              working: true,
              activity: '',
            },
      } as Record<string, T>;
    });
    if (!stopping) {
      input.setDraft('');
      input.setFiles([]);
      input.setLinks([]);
      input.setCodeRefs([]);
      input.patchChat(id, { status: 'running', updatedAt: new Date().toISOString() });
    }
    const options = input.chatOptions[id];
    deliver(
      input.command(
        stopping
          ? { op: 'stop', chatId: id }
          : {
              op: 'prompt',
              chatId: id,
              text: body,
              ...extras.payload,
              ...(options ?? {}),
            },
      ),
    );
  };

  const answerFromList = (chatId: string, text: string, opts?: { planMode: false }) => {
    const body = text.trim();
    if (!chatId || !body) return;
    clearListBlock(chatId, input.patchChat);
    deliver(
      input.command({
        op: 'prompt',
        chatId,
        text: body,
        ...(opts?.planMode === false ? { planMode: false } : {}),
      }),
    );
  };

  const decideFromList = (chatId: string, id: string, decision: PhonePermissionDecision) => {
    if (!chatId || !id) return;
    clearListBlock(chatId, input.patchChat);
    input.setPermissionByChat((prev) => ({ ...prev, [chatId]: null }));
    deliver(input.command({ op: 'permission', chatId, id, decision }));
  };

  return { sendText, answerFromList, decideFromList };
}
