import { latestPendingPlanQuestions } from '../plan/ask-user.js';
import { readPhoneThread } from './phone-chats.js';
import { emitControl, type RemoteOutbound } from './phone-live.js';

/** The opened snapshot is message text only. Resend choices without a second bubble. */
export function republishPendingAsk(
  opts: { onOutbound: (msg: RemoteOutbound) => void },
  chatId: string,
): void {
  const thread = readPhoneThread(chatId);
  if (!thread) return;
  const pending = latestPendingPlanQuestions({
    messages: thread.messages,
    agentBlock: thread.agentBlock,
    dismissedQuestionSignature: thread.dismissedQuestionSignature,
    status: thread.status,
  });
  if (!pending) return;
  emitControl(opts, {
    op: 'ask',
    chatId,
    text: '',
    questions: pending.questions.map((question) => ({
      question: question.question,
      options: question.options.map((option) =>
        option.description
          ? { label: option.label, description: option.description }
          : { label: option.label },
      ),
    })),
  });
}
