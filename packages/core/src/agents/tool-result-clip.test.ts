import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_RESULT_STORE_MAX_CHARS } from './error-detail.js';
import {
  clipAgentEventForEmit,
  clipMcpToolResult,
  spillAndClipToolResult,
} from './tool-result-clip.js';

describe('spillAndClipToolResult', () => {
  it('leaves a small payload unchanged and does not write a spill file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-clip-small-'));
    expect(spillAndClipToolResult('{"ok":true}', { cwd })).toBe('{"ok":true}');
  });

  it('clips oversized JSON and spills the original to .context/cli/', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-clip-spill-'));
    const json = `[${Array.from({ length: 200 }, (_, i) => `{"i":${i},"m":"${'x'.repeat(80)}"}`).join(',')}]`;
    expect(json.length).toBeGreaterThan(TOOL_RESULT_STORE_MAX_CHARS);
    const out = spillAndClipToolResult(json, { cwd, prefix: 'mcp' });
    expect(out.length).toBeLessThan(json.length);
    expect(out).toMatch(/truncated \d+ chars/);
    expect(out).toMatch(/\.context\/cli\/mcp-/);
    expect(out).not.toMatch(/crashed mid-turn/i);
    const match = out.match(/Full output: (\S+\.txt)/);
    expect(match?.[1]).toBeTruthy();
    expect(readFileSync(match![1]!, 'utf8')).toBe(json);
  });

  it('does not spill a Cursor SDK source dump', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-clip-dump-'));
    const dump =
      'file:///Applications/Sideboard.app/Contents/Resources/cursor-runtime/node_modules/@cursor/sdk/dist/esm/index.js:1 importas e from"@bufbuild/protobuf";' +
      'x'.repeat(500);
    const out = spillAndClipToolResult(dump, { cwd });
    expect(out).toMatch(/huge tool result/i);
    expect(out).not.toMatch(/Full output:/);
  });
});

describe('clipMcpToolResult', () => {
  it('clips text blocks and preserves isError', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-mcp-clip-'));
    const text = 'n'.repeat(TOOL_RESULT_STORE_MAX_CHARS + 50);
    const clipped = clipMcpToolResult(
      { content: [{ type: 'text', text }], isError: true },
      cwd,
    );
    expect(clipped.isError).toBe(true);
    const block = clipped.content?.[0];
    expect(block?.text?.length).toBeLessThan(text.length);
    expect(block?.text).toMatch(/\.context\/cli\//);
  });
});

describe('clipAgentEventForEmit', () => {
  it('clips tool_result content', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-emit-clip-'));
    const content = 'y'.repeat(TOOL_RESULT_STORE_MAX_CHARS + 20);
    const out = clipAgentEventForEmit(
      { type: 'tool_result', id: 't1', content },
      cwd,
    ) as { content: string };
    expect(out.content.length).toBeLessThan(content.length);
  });

  it('replaces an SDK dump on stderr without spilling', () => {
    const dump =
      'file:///Applications/Sideboard.app/Contents/Resources/cursor-runtime/node_modules/@cursor/sdk/dist/esm/index.js:1 importas e from"@bufbuild/protobuf";' +
      'z'.repeat(200);
    const out = clipAgentEventForEmit({ type: 'stderr', data: dump }) as {
      data: string;
    };
    expect(out.data).toMatch(/huge tool result/i);
  });

  it('does not clip ordinary assistant stdout', () => {
    const data = 'hello '.repeat(2_000);
    expect(clipAgentEventForEmit({ type: 'stdout', data })).toEqual({
      type: 'stdout',
      data,
    });
  });
});

describe('spill directory', () => {
  it('creates .context/cli when missing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sb-cli-mkdir-'));
    mkdirSync(join(cwd, 'src'));
    const out = spillAndClipToolResult('k'.repeat(TOOL_RESULT_STORE_MAX_CHARS + 10), {
      cwd,
    });
    expect(out).toMatch(/\.context\/cli\//);
    writeFileSync(join(cwd, 'src', 'ok.txt'), 'ok');
  });
});
