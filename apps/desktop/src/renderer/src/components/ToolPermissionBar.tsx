import { useState } from 'react';

export type ToolPermissionPrompt = {
  id: string;
  title: string;
  detail: string;
  path?: string;
  allowSession: boolean;
  defaultToNo?: boolean;
};

/** Read a permission block even before the desktop has rebuilt core's type declarations. */
export function toolPermissionFromThread(thread: {
  agentBlock?: unknown;
}): ToolPermissionPrompt | null {
  const block = thread.agentBlock as
    | { source?: string; permission?: ToolPermissionPrompt }
    | null
    | undefined;
  const prompt = block?.source === 'permission' ? block.permission : undefined;
  if (!prompt?.id || !prompt.title) return null;
  return prompt;
}

/**
 * Allow / Deny for a tool the agent cannot run until the user decides.
 * The turn stays open; the click resolves Claude's permission callback.
 */
export function ToolPermissionBar({ prompt }: { prompt: ToolPermissionPrompt }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answer = (decision: 'allow' | 'deny' | 'allow_session') => {
    if (busy) return;
    setBusy(true);
    setError('');
    void window.sideboard
      .answerToolPermission(prompt.id, decision)
      .then((ok) => {
        if (!ok) setError('That request already finished.');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };
  const denyFirst = prompt.defaultToNo === true;
  const deny = (
    <button
      key="deny"
      type="button"
      className="plan-question-option"
      disabled={busy}
      onClick={() => answer('deny')}
    >
      Deny
    </button>
  );
  const allow = (
    <button
      key="allow"
      type="button"
      className="plan-question-option selected"
      disabled={busy}
      onClick={() => answer('allow')}
    >
      Allow
    </button>
  );
  return (
    <div className="plan-questions" role="group" aria-label="Permission">
      <div className="plan-questions-header">
        <div className="plan-questions-title-row">
          <span className="plan-questions-title">Permission</span>
          <span className="plan-questions-awaiting">Awaiting response</span>
        </div>
      </div>
      <div className="plan-question-card">
        <div className="plan-question-text">{prompt.title}</div>
        {prompt.detail ? <div className="plan-question-text">{prompt.detail}</div> : null}
        {prompt.path ? <div className="plan-question-text">{prompt.path}</div> : null}
        <div className="plan-question-options">
          {denyFirst ? deny : allow}
          {denyFirst ? allow : deny}
          {prompt.allowSession ? (
            <button
              type="button"
              className="plan-question-option"
              disabled={busy}
              onClick={() => answer('allow_session')}
            >
              Allow for this session
            </button>
          ) : null}
        </div>
        {error ? <div className="plan-question-text">{error}</div> : null}
      </div>
    </div>
  );
}
