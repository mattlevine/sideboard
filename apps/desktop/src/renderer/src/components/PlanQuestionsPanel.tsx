import { useEffect, useMemo, useState } from 'react';
import {
  formatPlanQuestionAnswers,
  type PlanQuestionAnswer,
  type PendingPlanQuestions,
} from '@sideboard/plan-ask-user';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  pending: PendingPlanQuestions;
  busy?: boolean;
  onSubmit: (message: string) => void;
  onDismiss: () => void;
}

type DraftAnswer = {
  selected: Set<string>;
  otherChecked: boolean;
  otherText: string;
};

function emptyDraft(): DraftAnswer {
  return { selected: new Set(), otherChecked: false, otherText: '' };
}

function isAnswered(d: DraftAnswer | undefined): boolean {
  if (!d) return false;
  if (d.selected.size > 0) return true;
  if (d.otherChecked && d.otherText.trim()) return true;
  return false;
}

/** Conductor-style: one question at a time with pagination + numbered options + Other. */
export function PlanQuestionsPanel({
  pending,
  busy = false,
  onSubmit,
  onDismiss,
}: Props) {
  const questions = pending.questions;
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() =>
    questions.map(() => emptyDraft()),
  );

  useEffect(() => {
    setDrafts(questions.map(() => emptyDraft()));
    setPage(0);
  }, [pending.signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const qi = Math.min(page, Math.max(0, questions.length - 1));
  const question = questions[qi]!;
  const draft = drafts[qi] ?? emptyDraft();
  const multi = Boolean(question.multiSelect);

  const allAnswered = useMemo(
    () => questions.every((_, i) => isAnswered(drafts[i])),
    [drafts, questions],
  );
  const currentAnswered = isAnswered(draft);

  function patchDraft(index: number, fn: (d: DraftAnswer) => DraftAnswer) {
    setDrafts((prev) => {
      const next = prev.map((d) => ({
        ...d,
        selected: new Set(d.selected),
      }));
      next[index] = fn(next[index] ?? emptyDraft());
      return next;
    });
  }

  function toggleOption(label: string) {
    patchDraft(qi, (d) => {
      if (multi) {
        const selected = new Set(d.selected);
        if (selected.has(label)) selected.delete(label);
        else selected.add(label);
        return { ...d, selected };
      }
      return {
        ...d,
        selected: new Set([label]),
        otherChecked: false,
      };
    });
  }

  function toggleOther() {
    patchDraft(qi, (d) => {
      const on = !d.otherChecked;
      return {
        ...d,
        otherChecked: on,
        selected: on && !multi ? new Set() : d.selected,
      };
    });
  }

  function setOtherText(text: string) {
    patchDraft(qi, (d) => ({
      ...d,
      otherText: text,
      otherChecked: true,
      selected: multi ? d.selected : new Set(),
    }));
  }

  function submit() {
    if (!allAnswered || busy) return;
    const answers: PlanQuestionAnswer[] = questions.map((_, i) => {
      const d = drafts[i] ?? emptyDraft();
      return {
        questionIndex: i,
        selected: [...d.selected],
        other: d.otherChecked ? d.otherText.trim() || undefined : undefined,
      };
    });
    onSubmit(formatPlanQuestionAnswers(questions, answers));
  }

  function goNext() {
    if (qi < questions.length - 1) setPage(qi + 1);
  }

  function goPrev() {
    if (qi > 0) setPage(qi - 1);
  }

  // Number keys 1–9 pick options; 0 toggles Other; Enter submits or advances.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (qi < questions.length - 1 && currentAnswered) goNext();
          else if (allAnswered) submit();
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (qi < questions.length - 1 && currentAnswered) goNext();
        else if (allAnswered) submit();
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        toggleOther();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const opt = question.options[n - 1];
        if (opt) {
          e.preventDefault();
          toggleOption(opt.label);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers close over latest qi/drafts
  }, [qi, question, drafts, busy, allAnswered, currentAnswered, questions.length]);

  return (
    <div className="plan-questions" role="form" aria-label="User input">
      <div className="plan-questions-header">
        <div className="plan-questions-title-row">
          <span className="plan-questions-title">User input</span>
          <span className="plan-questions-awaiting">Awaiting response</span>
        </div>
        <button
          type="button"
          className="plan-questions-dismiss"
          title="Skip and use the normal message input"
          onClick={onDismiss}
        >
          ✕
        </button>
      </div>

      <div className="plan-question-card" key={`${pending.signature}-${qi}`}>
        <div className="plan-question-text">
          <MarkdownMessage text={question.question} className="md plan-question-md" />
        </div>
        <div
          className="plan-question-options"
          role={multi ? 'group' : 'radiogroup'}
        >
          {question.options.map((opt, oi) => {
            const selected = draft.selected.has(opt.label);
            const num = oi + 1;
            return (
              <button
                key={opt.label}
                type="button"
                className={`plan-question-option${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => toggleOption(opt.label)}
              >
                <span className="plan-question-option-num" aria-hidden>
                  {num}
                </span>
                <div className="plan-question-option-body">
                  <div className="plan-question-option-label">
                    <MarkdownMessage text={opt.label} className="md plan-question-md" />
                  </div>
                  {opt.description ? (
                    <div className="plan-question-option-desc">
                      <MarkdownMessage
                        text={opt.description}
                        className="md plan-question-md"
                      />
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            className={`plan-question-option other${draft.otherChecked ? ' selected' : ''}`}
            aria-pressed={draft.otherChecked}
            onClick={toggleOther}
          >
            <span className="plan-question-option-num" aria-hidden>
              0
            </span>
            <div className="plan-question-option-body">
              <div className="plan-question-option-label">Other…</div>
            </div>
          </button>
          {draft.otherChecked ? (
            <input
              className="plan-question-other-input"
              type="text"
              value={draft.otherText}
              placeholder="Type your answer…"
              autoFocus
              onChange={(e) => setOtherText(e.target.value)}
            />
          ) : null}
        </div>
      </div>

      <div className="plan-questions-footer">
        {questions.length > 1 ? (
          <div className="plan-questions-pager" aria-label="Question pages">
            <button
              type="button"
              className="plan-questions-page-btn"
              disabled={qi <= 0}
              onClick={goPrev}
              title="Previous question"
            >
              ‹
            </button>
            <div className="plan-questions-dots">
              {questions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`plan-questions-dot${i === qi ? ' active' : ''}${isAnswered(drafts[i]) ? ' answered' : ''}`}
                  aria-label={`Question ${i + 1}`}
                  aria-current={i === qi ? 'step' : undefined}
                  onClick={() => setPage(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className="plan-questions-page-btn"
              disabled={qi >= questions.length - 1}
              onClick={goNext}
              title="Next question"
            >
              ›
            </button>
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="plan-questions-send"
          disabled={!allAnswered || busy}
          title={
            allAnswered
              ? 'Send answers'
              : 'Answer every question to continue'
          }
          onClick={submit}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
