import { describe, expect, it } from 'vitest';
import {
  extractArtifacts,
  extractFenceArtifacts,
  extractToolArtifacts,
  inferJobLogStatus,
  joinLogChunks,
  latestArtifact,
  mergeAppendableArtifact,
  settleLogStatusAfterStream,
} from './artifacts';
import type { MessagePart } from '@sideboard-ai/core';

describe('extractFenceArtifacts', () => {
  it('extracts HTML fences', () => {
    const text = 'Here you go:\n\n```html\n<!DOCTYPE html><html><body><h1>Hi</h1></body></html>\n```\n';
    const arts = extractFenceArtifacts(text);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe('html');
    expect(arts[0]!.title).toBe('HTML artifact');
    expect(arts[0]!.content).toContain('<h1>Hi</h1>');
  });

  it('uses <title> for HTML artifact title', () => {
    const text =
      '```html\n<html><head><title>Dashboard</title></head><body><p>x</p></body></html>\n```';
    expect(extractFenceArtifacts(text)[0]!.title).toBe('Dashboard');
  });

  it('extracts incomplete streaming HTML fences', () => {
    const text = '```html\n<!DOCTYPE html>\n<html><body><h1>Streaming';
    const arts = extractFenceArtifacts(text, 'live');
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('live-0');
    expect(arts[0]!.content).toContain('Streaming');
  });

  it('skips mermaid and tiny fences', () => {
    expect(extractFenceArtifacts('```mermaid\ngraph TD; A-->B\n```')).toHaveLength(0);
    expect(extractFenceArtifacts('```html\n<p>x</p>\n```')).toHaveLength(0);
  });

  it('extracts substantial TypeScript fences as code artifacts', () => {
    const src = `export function mcpJson(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}
${'// keep it over the promotion threshold\n'.repeat(8)}`;
    const arts = extractFenceArtifacts(`\`\`\`typescript\n${src}\n\`\`\``);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe('code');
    expect(arts[0]!.language).toBe('typescript');
  });

  it('sniffs TypeScript when the fence language is a generic label', () => {
    const src = `export function mcpJson(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}
${'// keep it over the promotion threshold\n'.repeat(8)}`;
    const arts = extractFenceArtifacts(`\`\`\`69\n${src}\n\`\`\``);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe('code');
    expect(arts[0]!.language).toBe('typescript');
  });

  it('extracts markdown documents', () => {
    const md = `# Spec\n\n${'Paragraph. '.repeat(20)}`;
    const text = `\`\`\`markdown\n${md}\n\`\`\``;
    const arts = extractFenceArtifacts(text);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe('markdown');
    expect(arts[0]!.title).toBe('Spec');
  });
});

describe('extractToolArtifacts', () => {
  it('reads create_artifact tool input', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'create_artifact',
        status: 'done',
        input: {
          artifact_id: 'a1',
          type: 'html',
          title: 'Landing',
          content: '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>',
        },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('tool-a1');
    expect(arts[0]!.title).toBe('Landing');
    expect(arts[0]!.kind).toBe('html');
  });

  it('reads artifact content from tool result JSON', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't2',
        name: 'update_artifact',
        status: 'done',
        input: { artifact_id: 'a2' },
        result: JSON.stringify({
          data: {
            artifact_id: 'a2',
            title: 'Updated',
            type: 'markdown',
            content: `# Updated\n\n${'More text. '.repeat(20)}`,
          },
        }),
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.title).toBe('Updated');
    expect(arts[0]!.kind).toBe('markdown');
  });
  it('treats present_artifact type=code as a code artifact', () => {
    const src = `export function mcpJson(payload: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
${'// padding so the fence minimum does not reject this\n'.repeat(6)}`;
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't-code',
        name: 'present_artifact',
        status: 'done',
        input: {
          artifact_id: 'c1',
          type: 'code',
          title: 'mcpJson',
          content: src,
        },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe('code');
    expect(arts[0]!.language).toBe('typescript');
  });

  it('reads present_artifact (incl. mcp__sideboard__ prefix)', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't3',
        name: 'mcp__sideboard__present_artifact',
        status: 'done',
        input: {
          artifact_id: 'p1',
          type: 'html',
          title: 'Preview',
          content: '<!DOCTYPE html><html><body><h1>Preview</h1></body></html>',
        },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('tool-p1');
    expect(arts[0]!.title).toBe('Preview');
    expect(arts[0]!.kind).toBe('html');
  });

  it('reads present_artifact content from input when the tool result is compact', () => {
    const html = '<!DOCTYPE html><html><body><h1>Compact</h1></body></html>';
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't-compact',
        name: 'mcp__sideboard__present_artifact',
        status: 'done',
        input: {
          artifact_id: 'c1',
          type: 'html',
          title: 'Compact',
          content: html,
        },
        result: JSON.stringify({
          ok: true,
          artifact_id: 'c1',
          title: 'Compact',
          type: 'html',
        }),
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.content).toContain('<h1>Compact</h1>');
  });

  it('reads Cursor nested mcp present_artifact args + result envelope', () => {
    const html = '<!DOCTYPE html><html><body><h1>Nested</h1></body></html>';
    const payload = JSON.stringify({
      ok: true,
      artifact_id: 'n1',
      title: 'Nested',
      type: 'html',
      content: html,
    });
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't4',
        name: 'mcp',
        status: 'done',
        input: {
          providerIdentifier: 'sideboard',
          toolName: 'present_artifact',
          args: { artifact_id: 'n1', type: 'html', title: 'Nested', content: html },
        },
        result: JSON.stringify({
          status: 'success',
          value: { content: [{ text: { text: payload } }], isError: false },
        }),
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('tool-n1');
    expect(arts[0]!.title).toBe('Nested');
    expect(arts[0]!.content).toBe(html);
  });
});

describe('log artifacts', () => {
  it('appends later chunks with the same artifact_id', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'mcp__sideboard__present_artifact',
        status: 'done',
        input: {
          artifact_id: 'mac-release',
          type: 'log',
          title: 'Mac pack',
          content: '[1/2] Building',
          status: 'running',
          phase: 'Building',
        },
      },
      {
        type: 'tool',
        id: 't2',
        name: 'mcp__sideboard__present_artifact',
        status: 'done',
        input: {
          artifact_id: 'mac-release',
          type: 'log',
          title: 'Mac pack',
          content: '[2/2] Signing',
          status: 'running',
          phase: 'Signing',
        },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(2);
    const merged = latestArtifact('', parts);
    expect(merged?.kind).toBe('log');
    expect(merged?.content).toBe('[1/2] Building\n[2/2] Signing');
    expect(merged?.phase).toBe('Signing');
    expect(merged?.status).toBe('ok');
  });

  it('keeps working while a log tool is still streaming', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'present_artifact',
        status: 'done',
        input: {
          artifact_id: 'mac-release',
          type: 'log',
          title: 'Mac pack',
          content: '[1/2] Building',
          status: 'running',
        },
      },
      {
        type: 'tool',
        id: 't2',
        name: 'present_artifact',
        status: 'running',
        input: {
          artifact_id: 'mac-release',
          type: 'log',
          title: 'Mac pack',
          content: '[2/2] Signing',
          status: 'running',
        },
      },
    ];
    expect(latestArtifact('', parts)?.status).toBe('running');
  });

  it('accepts a short log chunk (under the html minimum)', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'present_artifact',
        status: 'done',
        input: {
          artifact_id: 'job',
          type: 'log',
          title: 'Job',
          content: 'ok',
          status: 'ok',
        },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.content).toBe('ok');
    expect(arts[0]!.status).toBe('ok');
  });

  it('does not duplicate when the next chunk is already the suffix', () => {
    expect(joinLogChunks('a\nb', 'b')).toBe('a\nb');
    const prev = {
      id: 'tool-j',
      title: 'Job',
      kind: 'log' as const,
      language: 'log',
      content: 'a\nb',
      source: 'tool' as const,
      status: 'running' as const,
    };
    const next = { ...prev, content: 'b', phase: 'Done', status: 'ok' as const };
    expect(mergeAppendableArtifact(prev, next).content).toBe('a\nb');
    expect(mergeAppendableArtifact(prev, next).status).toBe('ok');
  });

  it('keeps a custom present_artifact title when wait_for_job uses the job id', () => {
    const prev = {
      id: 'tool-core-test',
      title: 'Core tests',
      kind: 'log' as const,
      language: 'log',
      content: 'start',
      source: 'tool' as const,
      status: 'running' as const,
    };
    const next = {
      ...prev,
      title: 'core-test',
      content: 'start\nPASS',
      status: 'ok' as const,
    };
    expect(mergeAppendableArtifact(prev, next).title).toBe('Core tests');
    expect(mergeAppendableArtifact(prev, next).content).toBe('start\nPASS');
  });

  it('opens a log pane from wait_for_job results', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'w1',
        name: 'mcp__sideboard__wait_for_job',
        status: 'done',
        input: { id: 'core-test' },
        result: JSON.stringify({
          stillRunning: true,
          status: 'running',
          id: 'core-test',
          delta: 'PASS src/foo.test.ts',
          phase: 'vitest',
        }),
      },
      {
        type: 'tool',
        id: 'w2',
        name: 'wait_for_job',
        status: 'done',
        input: { id: 'core-test' },
        result: JSON.stringify({
          stillRunning: false,
          status: 'ok',
          id: 'core-test',
          delta: 'Test Files  1 passed',
          phase: 'done',
        }),
      },
    ];
    const merged = latestArtifact('', parts);
    expect(merged?.kind).toBe('log');
    expect(merged?.id).toBe('tool-core-test');
    expect(merged?.title).toBe('core-test');
    expect(merged?.content).toBe('PASS src/foo.test.ts\nTest Files  1 passed');
    expect(merged?.status).toBe('ok');
    expect(merged?.phase).toBe('done');
  });

  it('opens a running log as soon as wait_for_job starts', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'w0',
        name: 'wait_for_job',
        status: 'running',
        input: { id: 'mac-release' },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('tool-mac-release');
    expect(arts[0]!.kind).toBe('log');
    expect(arts[0]!.status).toBe('running');
    expect(arts[0]!.content).toBe('');
  });

  it('opens a log pane from stop_job', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 's1',
        name: 'stop_job',
        status: 'done',
        input: { id: 'hang', reason: 'no progress' },
        result: JSON.stringify({
          stopped: true,
          status: 'failed',
          id: 'hang',
          delta: '$ stop: no progress',
        }),
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.status).toBe('failed');
    expect(arts[0]!.content).toBe('$ stop: no progress');
  });

  it('opens a log pane from shell detached-job wait JSON', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'sh1',
        name: 'Shell',
        status: 'done',
        input: { command: 'node scripts/detached-job.cjs wait core-test' },
        result: JSON.stringify(
          {
            stillRunning: true,
            status: 'running',
            id: 'core-test',
            delta: 'ok\n',
            phase: 'ok',
          },
          null,
          2,
        ),
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('tool-core-test');
    expect(arts[0]!.content).toBe('ok\n');
    expect(arts[0]!.status).toBe('running');
  });

  it('parses job id from a detached-job start command before wait JSON exists', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'sh0',
        name: 'Bash',
        status: 'running',
        detail: 'node "/abs/detached-job.cjs" start fly-deploy -- fly deploy',
        input: { command: 'node "/abs/detached-job.cjs" start fly-deploy -- fly deploy' },
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.id).toBe('tool-fly-deploy');
    expect(arts[0]!.status).toBe('running');
  });

  it('marks the log done when wait finished without a status field', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'w1',
        name: 'wait_for_job',
        status: 'done',
        input: { id: 'gha-release' },
        result: JSON.stringify({
          stillRunning: false,
          ok: true,
          failed: false,
          id: 'gha-release',
          delta: '✓ desktop',
        }),
      },
    ];
    const arts = extractToolArtifacts(parts);
    expect(arts[0]!.status).toBe('ok');
    expect(arts[0]!.content).toBe('✓ desktop');
  });

  it('marks the log done when wait_for_job completed with no parseable result', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'w1',
        name: 'wait_for_job',
        status: 'done',
        input: { id: 'gha-release' },
      },
    ];
    expect(extractToolArtifacts(parts)[0]!.status).toBe('ok');
  });

  it('settles a leftover working pill after the stream unless the job is still running', () => {
    const running: MessagePart[] = [
      {
        type: 'tool',
        id: 'w1',
        name: 'wait_for_job',
        status: 'done',
        input: { id: 'core-test' },
        result: JSON.stringify({
          stillRunning: true,
          status: 'running',
          id: 'core-test',
          delta: 'PASS 1',
        }),
      },
    ];
    const art = {
      id: 'tool-core-test',
      title: 'core-test',
      kind: 'log' as const,
      language: 'log',
      content: 'PASS 1',
      source: 'tool' as const,
      status: 'running' as const,
    };
    expect(settleLogStatusAfterStream(art, running).status).toBe('running');
    expect(settleLogStatusAfterStream(art, []).status).toBe('ok');
    expect(
      settleLogStatusAfterStream(art, [
        {
          type: 'tool',
          id: 'p1',
          name: 'present_artifact',
          status: 'done',
          input: {
            artifact_id: 'core-test',
            type: 'log',
            content: 'PASS 1',
            status: 'running',
          },
        },
      ]).status,
    ).toBe('ok');
  });

  it('infers ok from stillRunning/ok even when status says running', () => {
    expect(
      inferJobLogStatus({ stillRunning: false, ok: true, status: 'running' }),
    ).toBe('ok');
  });

  it('does not treat an unrelated shell JSON dump as a job log', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'shx',
        name: 'Bash',
        status: 'done',
        input: { command: 'cat package.json' },
        result: JSON.stringify({ name: 'sideboard', version: '0.1.0' }),
      },
    ];
    expect(extractToolArtifacts(parts)).toHaveLength(0);
  });

  it('replace mode overwrites the buffer', () => {
    const prev = {
      id: 'tool-j',
      title: 'Job',
      kind: 'log' as const,
      language: 'log',
      content: 'old',
      source: 'tool' as const,
    };
    const next = { ...prev, content: 'new', mode: 'replace' as const };
    expect(mergeAppendableArtifact(prev, next).content).toBe('new');
  });
});

describe('extractArtifacts / latestArtifact', () => {
  it('prefers tool artifacts over duplicate fence content', () => {
    const html = '<!DOCTYPE html><html><body><h1>Same</h1></body></html>';
    const text = `\`\`\`html\n${html}\n\`\`\``;
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'create_artifact',
        status: 'done',
        input: { artifact_id: 'x', title: 'From tool', type: 'html', content: html },
      },
    ];
    const arts = extractArtifacts(text, parts);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.source).toBe('tool');
    expect(latestArtifact(text, parts)?.title).toBe('From tool');
  });
});
