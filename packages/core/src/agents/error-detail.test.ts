import { describe, expect, it } from 'vitest';
import {
  extractJsonErrorMessage,
  fallbackTurnFailDetail,
  formatUnknownDetail,
  formatTurnExitError,
  humanizeAgentFailDetail,
  looksLikeAgentFailureMessage,
  looksLikeInvalidAgentSession,
  pushTurnStderr,
  summarizeTurnStderr,
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
    expect(looksLikeInvalidAgentSession('Credit balance is too low')).toBe(false);
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

  it('keeps exit code for opaque CLI failures', () => {
    expect(formatTurnExitError(2, 'segfault at 0x0')).toBe('exit 2: segfault at 0x0');
  });
});
