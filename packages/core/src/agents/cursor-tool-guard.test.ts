import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_RESULT_STORE_MAX_CHARS } from './error-detail.js';
import {
  CURSOR_TOOL_RECOVERY_HINT,
  boundedCursorToolResult,
  cursorRunErrorRecoveryPrompt,
  cursorToolErrorText,
  guardCursorCustomTool,
  shouldReturnRunErrorToAgent,
} from './cursor-tool-guard.js';

describe('guardCursorCustomTool', () => {
  it('returns a thrown error to the model instead of rejecting', async () => {
    const tool = guardCursorCustomTool({
      execute: () => {
        throw new Error('openrouter payload exceeded the turn limit');
      },
    });
    const out = await tool.execute({});
    expect(out).toMatchObject({ isError: true });
    const text =
      typeof out === 'object' && out && 'content' in out ? out.content[0]?.text : '';
    expect(text).toMatch(/^Error: openrouter payload exceeded the turn limit/);
    expect(text).toContain(CURSOR_TOOL_RECOVERY_HINT);
    expect(text).not.toMatch(/at execute/);
  });

  it('passes the tool context through so wait ids still attach', async () => {
    let seen: unknown;
    const tool = guardCursorCustomTool({
      execute: (_args, context) => {
        seen = context;
        return 'ok';
      },
    });
    await tool.execute({ path: 'a' }, { toolCallId: 'call-1' });
    expect(seen).toEqual({ toolCallId: 'call-1' });
  });

  it('clips an oversized string result before it reaches the SDK', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-cursor-guard-'));
    const huge = 'x'.repeat(TOOL_RESULT_STORE_MAX_CHARS + 50);
    const out = boundedCursorToolResult(huge, { cwd, name: 'read' });
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toMatch(/truncated/);
    expect(out).toMatch(/\.context\/cli\/read-/);
  });
});

describe('cursorToolErrorText', () => {
  it('replaces a minified crash dump with the short huge-result summary', () => {
    const dump =
      'file:///Applications/Sideboard.app/Contents/Resources/cursor-runtime/node_modules/@cursor/sdk/dist/esm/index.js:1 importas e from"@bufbuild/protobuf";' +
      'y'.repeat(400);
    const out = cursorToolErrorText(new Error(dump));
    expect(out).toMatch(/huge tool result/i);
    expect(out).not.toMatch(/importas/);
    expect(out).toContain(CURSOR_TOOL_RECOVERY_HINT);
  });
});

describe('shouldReturnRunErrorToAgent', () => {
  it('hands premature close and tool failures back', () => {
    expect(
      shouldReturnRunErrorToAgent('[unknown] Premature close — retry the turn'),
    ).toBe(true);
    expect(shouldReturnRunErrorToAgent('Tool execution failed: boom')).toBe(true);
  });

  it('does not hand auth or quota failures back', () => {
    expect(shouldReturnRunErrorToAgent('invalid API key')).toBe(false);
    expect(shouldReturnRunErrorToAgent('credit balance is too low')).toBe(false);
    expect(shouldReturnRunErrorToAgent('')).toBe(false);
  });
});

describe('cursorRunErrorRecoveryPrompt', () => {
  it('keeps the follow-up short and tells the agent to use a smaller read', () => {
    const prompt = cursorRunErrorRecoveryPrompt('z'.repeat(5_000));
    expect(prompt.length).toBeLessThan(1_000);
    expect(prompt).toMatch(/smaller request/);
    expect(prompt).toMatch(/offset and limit/);
    expect(prompt).toContain('z'.repeat(400));
    expect(prompt).not.toContain('z'.repeat(401));
  });
});
