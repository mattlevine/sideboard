import { describe, expect, it } from 'vitest';
import {
  extractArtifacts,
  extractFenceArtifacts,
  extractToolArtifacts,
  latestArtifact,
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
