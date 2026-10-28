/**
 * Keep Cursor tool failures inside the turn.
 *
 * A thrown custom tool, an oversized result, or an SDK run error used to kill
 * the process. The model then never saw the failure and could not switch to a
 * smaller read. These helpers return a short error string instead.
 */
import {
  formatUnknownDetail,
  HUGE_TOOL_RESULT_SUMMARY,
  looksLikeHugeToolResultDump,
} from './error-detail.js';
import { looksLikeCursorStreamCutOff } from './cursor-stream-cutoff.js';
import { spillAndClipToolResult } from './tool-result-clip.js';

export const CURSOR_TOOL_RECOVERY_HINT =
  'Continue with a smaller request. If you were reading a large file or API payload, pass offset and limit or write the output to .context/cli/ and read a slice. Do not retry the same call.';

/** One-line tool failure plus the recovery hint. Never includes a stack or a dump. */
export function cursorToolErrorText(err: unknown): string {
  const raw = formatUnknownDetail(err).replace(/\s+/g, ' ').trim();
  const message = looksLikeHugeToolResultDump(raw)
    ? HUGE_TOOL_RESULT_SUMMARY
    : (raw || 'unknown tool error').slice(0, 500);
  return `Error: ${message}\n${CURSOR_TOOL_RECOVERY_HINT}`;
}

/** SDK custom-tool error result. `isError` lets the model see the failure. */
export type CursorToolErrorResult = {
  isError: true;
  content: [{ type: 'text'; text: string }];
};

export function cursorToolErrorResult(err: unknown): CursorToolErrorResult {
  return {
    isError: true,
    content: [{ type: 'text', text: cursorToolErrorText(err) }],
  };
}

/** String the SDK can put on the tool result without blowing the protobuf turn. */
export function boundedCursorToolResult(
  result: unknown,
  opts?: { cwd?: string; name?: string },
): string {
  const prefix = opts?.name ?? 'cursor-tool';
  if (typeof result === 'string') {
    return spillAndClipToolResult(result, { cwd: opts?.cwd, prefix });
  }
  if (result == null) {
    return cursorToolErrorText(new Error('tool returned no result'));
  }
  let json: string;
  try {
    json = JSON.stringify(result);
  } catch (err) {
    return cursorToolErrorText(err);
  }
  return spillAndClipToolResult(json, { cwd: opts?.cwd, prefix });
}

type AnyCustomTool = {
  execute: (...args: never[]) => unknown;
};

export type GuardedCursorToolExecute = (
  args: Record<string, unknown>,
  context?: { toolCallId?: string },
) => Promise<string | CursorToolErrorResult>;

/**
 * Wrap a Cursor custom tool so execute() cannot throw into the SDK and cannot
 * return a payload large enough to crash the turn. Throws become `isError`
 * results the model can read and work around.
 */
export function guardCursorCustomTool<T extends AnyCustomTool>(
  tool: T,
  opts?: { cwd?: string; name?: string },
): Omit<T, 'execute'> & { execute: GuardedCursorToolExecute } {
  const execute = tool.execute.bind(tool) as (
    args: Record<string, unknown>,
    context?: { toolCallId?: string },
  ) => unknown;
  return {
    ...tool,
    execute: async (args, context) => {
      try {
        const result = await execute(args, context);
        return boundedCursorToolResult(result, opts);
      } catch (err) {
        return cursorToolErrorResult(err);
      }
    },
  };
}

const NON_RECOVERABLE_RUN_ERROR =
  /invalid (?:user )?api key|not logged in|not authenticated|unauthorized|credit balance|out of credits|insufficient.?quota|usage limit|you've hit your|too many requests|rate.?limit/;

/**
 * True when a finished Cursor run failed in a way the same agent can work
 * around (tool throw, oversized result, dropped stream). Auth and quota
 * failures are not — another prompt will fail the same way.
 */
const RECOVERABLE_RUN_ERROR =
  /premature close|tool execution failed|stream (?:idle|cut ?off|closed)|custom tool|result too (?:large|long)|max(?:imum)? (?:tool )?result/;

export function shouldReturnRunErrorToAgent(detail: string): boolean {
  const text = detail.trim();
  if (!text) return false;
  if (looksLikeHugeToolResultDump(text) || looksLikeCursorStreamCutOff(text)) return true;
  const head = text.slice(0, 2_000).toLowerCase();
  if (NON_RECOVERABLE_RUN_ERROR.test(head)) return false;
  return RECOVERABLE_RUN_ERROR.test(head);
}

/** Follow-up prompt so the same Cursor agent sees the failure and can continue. */
export function cursorRunErrorRecoveryPrompt(detail: string): string {
  const summary = looksLikeHugeToolResultDump(detail)
    ? HUGE_TOOL_RESULT_SUMMARY
    : detail.replace(/\s+/g, ' ').trim().slice(0, 400);
  return [
    'A tool call failed before its result reached you. The session is still open.',
    `Error: ${summary || 'unknown'}`,
    CURSOR_TOOL_RECOVERY_HINT,
  ].join('\n');
}
