import { describe, expect, it } from 'vitest';
import {
  extractJsonErrorMessage,
  fallbackTurnFailDetail,
  formatUnknownDetail,
  formatTurnExitError,
  humanizeAgentFailDetail,
  looksLikeAgentFailureMessage,
  looksLikeInvalidAgentSession,
  looksLikeRetryableRunnerCrash,
  shouldRetryFailedAgentTurn,
  pushTurnStderr,
  summarizeTurnStderr,
  turnFailChatText,
} from './error-detail.js';

describe('formatUnknownDetail', () => {
  it('reads RunError-shaped objects instead of [object Object]', () => {
    expect(formatUnknownDetail({ message: 'Model unavailable', code: 'model_not_found' })).toBe(
      'Model unavailable (model_not_found)',
    );
  });

  it('handles Error instances with optional code', () => {
    const err = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    expect(formatUnknownDetail(err)).toBe('boom (ECONNRESET)');
  });

  it('never returns [object Object]', () => {
    expect(formatUnknownDetail({})).not.toBe('[object Object]');
    expect(formatUnknownDetail({ nested: true })).toContain('nested');
  });
});

describe('extractJsonErrorMessage', () => {
  it('prefers message / nested error.message', () => {
    expect(extractJsonErrorMessage({ message: 'boom' })).toBe('boom');
    expect(extractJsonErrorMessage({ error: { message: 'nested' } })).toBe('nested');
    expect(extractJsonErrorMessage({ errors: [{ message: 'a' }, 'b'] })).toBe('a; b');
  });
});

describe('pushTurnStderr / summarizeTurnStderr', () => {
  it('skips Node.js version footers so lastError is useful', () => {
    const tail: string[] = [];
    pushTurnStderr(tail, 'Error: Cannot find module "@cursor/sdk"');
    pushTurnStderr(tail, '    at Module._resolveFilename (node:internal/modules/cjs/loader:1248:15)');
    pushTurnStderr(tail, 'Node.js v23.6.0');
    expect(summarizeTurnStderr(tail)).toContain('Cannot find module');
    expect(summarizeTurnStderr(tail)).not.toMatch(/Node\.js v23/);
  });

  it('prefers Cannot find package over ESM loader stack frames', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'execa' imported from /Apps/Sideboard.app/Contents/Resources/cursor-runtime/core-dist/chunk-LGXBYZZA.js",
    );
    pushTurnStderr(tail, 'at #cachedDefaultResolve (node:internal/modules/esm/loader:640:25)');
    pushTurnStderr(tail, 'at ModuleLoader.resolve (node:internal/modules/esm/loader:623:38)');
    pushTurnStderr(tail, "code: 'ERR_MODULE_NOT_FOUND'");
    expect(summarizeTurnStderr(tail)).toMatch(/Cannot find package 'execa'/);
    expect(summarizeTurnStderr(tail)).not.toMatch(/cachedDefaultResolve/);
  });

  it('keeps Cannot find package when the ESM stack fills the stderr tail', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'execa' imported from /Apps/Sideboard.app/Contents/Resources/cursor-runtime/core-dist/chunk-LGXBYZZA.js",
    );
    for (let i = 0; i < 20; i++) {
      pushTurnStderr(tail, `at ModuleLoader.resolve (node:internal/modules/esm/loader:${i}:38)`);
    }
    expect(summarizeTurnStderr(tail)).toMatch(/Cannot find package 'execa'/);
  });

  it('prefers Cannot find module over trailing stack frames', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      "Error: Cannot find module '/Apps/Sideboard.app/Contents/Resources/app.asar/…/cursor-runner.js'",
    );
    pushTurnStderr(tail, 'at wrapModuleLoad (node:internal/modules/cjs/loader:234:24)');
    pushTurnStderr(tail, 'at Function.executeUserEntryPoint [as runMain]');
    pushTurnStderr(tail, "code: 'MODULE_NOT_FOUND'");
    pushTurnStderr(tail, 'requireStack: []');
    expect(summarizeTurnStderr(tail)).toMatch(/Cannot find module.*cursor-runner/);
    expect(summarizeTurnStderr(tail)).not.toMatch(/wrapModuleLoad/);
  });

  it('keeps recent context from multiple stderr lines', () => {
    const tail: string[] = [];
    pushTurnStderr(tail, 'cursor-runner: empty stdin');
    pushTurnStderr(tail, 'Cursor startup failed: invalid API key');
    expect(summarizeTurnStderr(tail)).toContain('invalid API key');
  });
});

describe('humanizeAgentFailDetail / formatTurnExitError', () => {
  it('adds a credits hint without dropping the original message', () => {
    expect(humanizeAgentFailDetail('Credit balance is too low')).toMatch(/add credits/i);
    expect(humanizeAgentFailDetail('Credit balance is too low')).toContain(
      'Credit balance is too low',
    );
  });

  it('hints auth / API key failures', () => {
    expect(humanizeAgentFailDetail('Invalid User API Key')).toMatch(/Settings/i);
  });

  it('hints rate limits and model issues', () => {
    expect(humanizeAgentFailDetail('429 Too Many Requests')).toMatch(/retry/i);
    expect(humanizeAgentFailDetail('model gpt-x not found')).toMatch(/pick another model/i);
  });

  it('detects invalid resume / missing session failures', () => {
    expect(looksLikeInvalidAgentSession('Session not found')).toBe(true);
    expect(looksLikeInvalidAgentSession('No conversation found with session ID: abc')).toBe(
      true,
    );
    expect(looksLikeInvalidAgentSession('failed to load session')).toBe(true);
    expect(
      looksLikeInvalidAgentSession(
        'Cursor startup failed: Corrupt local agent checkpoint: missing root blob abc for agent agent-1',
      ),
    ).toBe(true);
    expect(
      looksLikeInvalidAgentSession('Agent agent-1ff554d1-14d1-42ff-9034-b9d2fe69e5f2 not found'),
    ).toBe(true);
    expect(looksLikeInvalidAgentSession('Credit balance is too low')).toBe(false);
    expect(looksLikeInvalidAgentSession('model gpt-x not found')).toBe(false);
  });

  it('retries native Node/Cursor runner crashes once', () => {
    expect(
      looksLikeRetryableRunnerCrash(
        '30: 0x107aca130 uv_run [/opt/homebrew/Cellar/libuv/1.49.2/lib/libuv.1.dylib]',
      ),
    ).toBe(true);
    expect(
      looksLikeRetryableRunnerCrash(
        'Cursor runner crashed in Node (Homebrew Node + shared libuv). Install Node 22 LTS (`brew install node@22`) and retry.',
      ),
    ).toBe(true);
    expect(looksLikeRetryableRunnerCrash('')).toBe(true);
    expect(looksLikeRetryableRunnerCrash('Credit balance is too low')).toBe(false);
    expect(looksLikeRetryableRunnerCrash("Cannot find package 'execa'")).toBe(false);
    expect(
      shouldRetryFailedAgentTurn('Session not found', { hasSession: true }),
    ).toBe(true);
    expect(
      shouldRetryFailedAgentTurn('Session not found', { hasSession: false }),
    ).toBe(false);
  });

  it('surfaces opaque exits with a generic hint', () => {
    expect(formatTurnExitError(1, '')).toMatch(/without details/i);
  });

  it('keeps arbitrary CLI errors intact', () => {
    expect(formatTurnExitError(1, 'API Error: 500 Internal server error')).toBe(
      'exit 1: API Error: 500 Internal server error',
    );
  });

  it('skips Reconnecting noise in the stderr tail', () => {
    const tail: string[] = [];
    pushTurnStderr(tail, 'Reconnecting...');
    pushTurnStderr(tail, 'Invalid User API Key');
    expect(summarizeTurnStderr(tail)).toBe('Invalid User API Key');
  });

  it('prefers Cursor startup failed over trailing minified dumps', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      'Cursor startup failed: Corrupt local agent checkpoint: missing root blob abc for agent agent-1',
    );
    pushTurnStderr(
      tail,
      `ce.now();yield Promise.all([(0,D.ly)(r.apiKey)]);const C="rg",M=process.env.CURSOR_RIPGREP_PATH;${'x'.repeat(200)}`,
    );
    expect(summarizeTurnStderr(tail)).toMatch(/Corrupt local agent checkpoint/);
    expect(summarizeTurnStderr(tail)).not.toMatch(/CURSOR_RIPGREP_PATH/);
  });

  it('summarizes nested Electron crash stacks instead of dyld frames', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      '32: 0x10985baac v8::ValueSerializer::Delegate::HasCustomHostObject(v8::Isolate*) [/Applications/Sideboard.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework]',
    );
    pushTurnStderr(
      tail,
      '33: 0x1098574f4 ElectronInitializeICUandStartNode [/Applications/Sideboard.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework]',
    );
    expect(summarizeTurnStderr(tail)).toMatch(/nested Chromium/i);
  });

  it('summarizes Homebrew Node + shared libuv stacks instead of hex frames', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      '30: 0x107aca130 uv_run [/opt/homebrew/Cellar/libuv/1.49.2/lib/libuv.1.dylib]',
    );
    pushTurnStderr(
      tail,
      '31: 0x10436a48c node::SpinEventLoopInternal(node::Environment*) [/opt/homebrew/Cellar/node/23.6.0/bin/node]',
    );
    const summary = summarizeTurnStderr(tail);
    expect(summary).toMatch(/Homebrew Node \+ shared libuv/i);
    expect(summary).toMatch(/brew install node@22/);
    expect(summary).not.toMatch(/0x107aca130/);
    expect(formatTurnExitError(1, summary)).toMatch(/brew install node@22/);
  });

  it('does not surface a minified Cursor local-agent dump as lastError', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      `ce.now();yield Promise.all([(0,D.ly)(r.apiKey),(0,D.mU)(r.apiKey)]),u=performance.now()-e}const k=r.workingDirectory||process.cwd();const C="rg",M=process.env.CURSOR_RIPGREP_PATH;${'x'.repeat(80)}`,
    );
    expect(summarizeTurnStderr(tail)).toMatch(/truncated crash dump/i);
  });

  it('summarizes Cursor findFilesWithRipgrep / resource_exhausted instead of asar stacks', () => {
    const tail: string[] = [];
    pushTurnStderr(
      tail,
      'at file:///Applications/Sideboard.app/Contents/Resources/app.asar/node_modules/@cursor/sdk/dist/esm/357.js:1:487342 at AsyncGenerator.next (<anonymous>) at async Ie.findFilesWithRipgrep (file:///Applications/Sideboard.app/Contents/Resources/app.asar/node_modules/@cursor/sdk/dist/esm/357.js:1:494988) [resource_exhausted] Error Cursor run failed (run-80eeb45d-de78-48',
    );
    const summary = summarizeTurnStderr(tail);
    expect(summary).toMatch(/ripgrep \/ resource_exhausted/i);
    expect(summary).not.toMatch(/app\.asar/);
    expect(formatTurnExitError(2, summary)).toMatch(/ripgrep \/ resource_exhausted/i);
    expect(formatTurnExitError(2, summary)).not.toMatch(/^exit 2:/);
  });

  it('recovers session-limit text when stderr is empty', () => {
    const msg =
      "You've hit your session limit · resets 7:10pm (America/Los_Angeles)";
    expect(looksLikeAgentFailureMessage(msg)).toBe(true);
    expect(fallbackTurnFailDetail(msg)).toBe(msg);
    // User-facing limit copy — no "exit 1:" prefix.
    expect(formatTurnExitError(1, fallbackTurnFailDetail(msg))).toBe(msg);
  });

  it('treats a bare exit code on stderr as empty detail', () => {
    expect(formatTurnExitError(1, 'exit 1')).toMatch(/without details/i);
  });

  it('puts runner crashes into chat text when the agent said nothing', () => {
    const detail =
      'Cursor runner crashed in Node (Homebrew Node + shared libuv). Install Node 22 LTS (`brew install node@22`) and retry.';
    expect(turnFailChatText({ exitCode: 1, assistantText: '', detail })).toBe(detail);
    expect(
      turnFailChatText({
        exitCode: 1,
        assistantText: 'already wrote a review',
        detail,
      }),
    ).toBe('already wrote a review');
    expect(turnFailChatText({ exitCode: 0, assistantText: '', detail })).toBe('');
  });

  it('keeps exit code for opaque CLI failures', () => {
    expect(formatTurnExitError(2, 'segfault at 0x0')).toBe('exit 2: segfault at 0x0');
  });
});
