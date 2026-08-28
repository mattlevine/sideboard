/**
 * Clarifying multiple-choice questions (AskUserQuestion / Sideboard ask_user).
 * For blocked concrete choices — not greetings or invented task menus.
 * Presented in the composer; answers come back on the next user turn.
 */

export interface PlanQuestionOption {
  label: string;
  description?: string;
}

export interface PlanQuestion {
  /** Full question text. */
  question: string;
  /** Short chip label (≤12 chars when from Claude). */
  header?: string;
  multiSelect?: boolean;
  options: PlanQuestionOption[];
}

export interface PendingPlanQuestions {
  /** Tool call / presentation id (dismiss + dedupe). */
  id: string;
  /**
   * Stable identity of the question set (labels + prompts). Survives live →
   * persist tool-id changes so the UI does not remount after an answer.
   */
  signature: string;
  questions: PlanQuestion[];
  /** Source tool name for debugging. */
  source: string;
}

/** Content key for dismiss / draft reset — not the ephemeral tool call id. */
export function planQuestionsSignature(questions: PlanQuestion[]): string {
  return questions
    .map((q) => {
      const opts = q.options.map((o) => o.label).join('\u001f');
      return `${q.question}\u001e${opts}`;
    })
    .join('\u001d');
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseOptions(raw: unknown): PlanQuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanQuestionOption[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ label: item.trim() });
      continue;
    }
    const o = asRecord(item);
    if (!o) continue;
    const label =
      typeof o.label === 'string'
        ? o.label.trim()
        : typeof o.text === 'string'
          ? o.text.trim()
          : typeof o.title === 'string'
            ? o.title.trim()
            : '';
    if (!label) continue;
    const description =
      typeof o.description === 'string' && o.description.trim()
        ? o.description.trim()
        : undefined;
    out.push({ label, description });
  }
  return out;
}

function parseOneQuestion(raw: unknown): PlanQuestion | null {
  const o = asRecord(raw);
  if (!o) return null;
  const question =
    typeof o.question === 'string'
      ? o.question.trim()
      : typeof o.text === 'string'
        ? o.text.trim()
        : typeof o.prompt === 'string'
          ? o.prompt.trim()
          : '';
  if (!question) return null;
  const options = parseOptions(o.options);
  if (options.length < 1) return null;
  const header =
    typeof o.header === 'string' && o.header.trim()
      ? o.header.trim()
      : undefined;
  const multiSelect = Boolean(o.multiSelect ?? o.multi_select);
  return { question, header, multiSelect, options };
}

/** Normalize AskUserQuestion / ask_user tool input into questions. */
export function parsePlanQuestionsInput(
  input: unknown,
): PlanQuestion[] {
  const root = asRecord(input);
  if (!root) return [];
  const list = Array.isArray(root.questions)
    ? root.questions
    : Array.isArray(root.question)
      ? root.question
      : root.question || root.prompt
        ? [root]
        : [];
  const out: PlanQuestion[] = [];
  for (const item of list) {
    const q = parseOneQuestion(item);
    if (q) out.push(q);
  }
  return out;
}

const ASK_USER_TOOL_RE =
  /^(AskUserQuestion|ask_user|mcp__sideboard__ask_user)$/i;

export function isAskUserToolName(name: string | undefined | null): boolean {
  if (!name) return false;
  const base = name.replace(/^mcp__sideboard__/i, '');
  return ASK_USER_TOOL_RE.test(name) || /^ask_user$/i.test(base);
}

export type ToolPartLike = {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  status?: string;
};

/** Newest ask-user tool part with parseable questions (live or persisted). */
export function extractPendingPlanQuestions(
  parts: ToolPartLike[] | undefined | null,
): PendingPlanQuestions | null {
  if (!parts?.length) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.type !== 'tool' || !isAskUserToolName(p.name)) continue;
    const questions = parsePlanQuestionsInput(p.input);
    if (!questions.length) continue;
    return {
      id: p.id || `ask-${i}`,
      signature: planQuestionsSignature(questions),
      questions,
      source: p.name || 'ask_user',
    };
  }
  return null;
}

/**
 * Questions still waiting on the user. After they reply (composer picker or
 * a normal chat message — persisted or in-flight), this is null so the panel
 * does not remount from the previous agent turn.
 */
export function latestPendingPlanQuestions(input: {
  messages: Array<{ role: string; parts?: ToolPartLike[] }>;
  liveParts?: ToolPartLike[] | null;
  /** Optimistic user send not yet in `messages`. */
  userReplied?: boolean;
}): PendingPlanQuestions | null {
  if (input.userReplied) return null;

  const fromLive = extractPendingPlanQuestions(input.liveParts);
  if (fromLive) return fromLive;

  const last = input.messages[input.messages.length - 1];
  if (last?.role === 'user') return null;
  if (last?.role === 'agent') return extractPendingPlanQuestions(last.parts);
  return null;
}

export interface PlanQuestionAnswer {
  questionIndex: number;
  /** Selected option labels (empty when only Other). */
  selected: string[];
  /** Free-text Other response. */
  other?: string;
}

export const PLAN_QUESTION_ANSWERS_PREFIX = 'Answers to your questions:';

/** True when a user message is the composer picker’s formatted answers. */
export function isPlanQuestionAnswersMessage(text: string): boolean {
  return text.startsWith(PLAN_QUESTION_ANSWERS_PREFIX);
}

/** Format answers as a concise user message for the agent. */
export function formatPlanQuestionAnswers(
  questions: PlanQuestion[],
  answers: PlanQuestionAnswer[],
): string {
  const lines: string[] = [PLAN_QUESTION_ANSWERS_PREFIX];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const a = answers.find((x) => x.questionIndex === i);
    const header = q.header ? `**${q.header}** — ` : '';
    const parts: string[] = [];
    if (a?.selected.length) parts.push(a.selected.join(', '));
    if (a?.other?.trim()) parts.push(a.other.trim());
    const body = parts.length ? parts.join(' · ') : '(no answer)';
    lines.push(`${i + 1}. ${header}${q.question}`);
    lines.push(`   → ${body}`);
  }
  return lines.join('\n');
}

/** Markdown brief of questions + option meanings for the chat transcript. */
export function formatPlanQuestionsForChat(questions: PlanQuestion[]): string {
  const lines: string[] = ['### Questions for you', ''];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const header = q.header ? `**${q.header}** — ` : '';
    lines.push(`${i + 1}. ${header}${q.question}`);
    for (let oi = 0; oi < q.options.length; oi++) {
      const opt = q.options[oi]!;
      const desc = opt.description?.trim();
      lines.push(
        desc
          ? `   - **${opt.label}** — ${desc}`
          : `   - **${opt.label}**`,
      );
    }
    lines.push('');
  }
  lines.push('_Answer in the composer below._');
  return lines.join('\n').trimEnd();
}
