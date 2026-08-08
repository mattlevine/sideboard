import { describe, expect, it } from 'vitest';
import type { MessagePart } from '@sideboard-ai/core';
import {
  extractFilesPanes,
  extractSchemaFencePanes,
  extractSchemaPanes,
  isFilesPane,
  isSchemaPane,
  latestRightPaneContent,
  resourceHasContentStates,
} from './right-pane';

describe('extractSchemaPanes', () => {
  it('parses present_schema tool with Brightsy resource_id', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't1',
        name: 'mcp__sideboard__present_schema',
        status: 'done',
        input: {
          title: 'Posts',
          mode: 'table',
          datasource: 'brightsy',
          resource_id: 'rt-123',
        },
        result: JSON.stringify({
          ok: true,
          pane_id: 'schema_abc',
          title: 'Posts',
          mode: 'table',
          datasource: 'brightsy',
          resource_id: 'rt-123',
        }),
      },
    ];
    const panes = extractSchemaPanes(parts);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.kind).toBe('schema');
    expect(panes[0]!.mode).toBe('table');
    expect(panes[0]!.datasource).toBe('brightsy');
    expect(panes[0]!.resourceId).toBe('rt-123');
    expect(panes[0]!.title).toBe('Posts');
  });

  it('parses inline resource + records', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't2',
        name: 'present_schema',
        status: 'done',
        input: {
          title: 'Demo',
          mode: 'table',
          datasource: 'inline',
          resource: {
            id: 'demo',
            title: 'Demo',
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', title: 'Title' },
              },
            },
            schemaUi: { 'ui:listFields': ['title'] },
          },
          records: [{ id: 'r1', data: { title: 'Hello' } }],
        },
      },
    ];
    const panes = extractSchemaPanes(parts);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.datasource).toBe('inline');
    expect(panes[0]!.resource?.schema.properties).toBeTruthy();
    expect(panes[0]!.records).toHaveLength(1);
  });

  it('opens form when record_id is present', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't3',
        name: 'present_schema',
        status: 'done',
        input: {
          title: 'Edit',
          mode: 'table',
          datasource: 'brightsy',
          resource_id: 'rt-1',
          record_id: 'rec-9',
        },
      },
    ];
    expect(extractSchemaPanes(parts)[0]!.mode).toBe('form');
    expect(extractSchemaPanes(parts)[0]!.recordId).toBe('rec-9');
  });
});

describe('extractSchemaFencePanes', () => {
  it('parses ```schema fences', () => {
    const text = [
      'Opening CMS:',
      '```schema',
      JSON.stringify({
        title: 'Inline posts',
        mode: 'form',
        datasource: 'inline',
        resource: {
          id: 'posts',
          schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
        record: { id: '1', data: { title: 'Hi' } },
      }),
      '```',
    ].join('\n');
    const panes = extractSchemaFencePanes(text);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.source).toBe('fence');
    expect(panes[0]!.mode).toBe('form');
    expect(isSchemaPane(panes[0]!)).toBe(true);
  });
});

describe('extractFilesPanes', () => {
  it('parses present_files tool', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'f1',
        name: 'mcp__sideboard__present_files',
        status: 'done',
        input: {
          title: 'Media',
          datasource: 'brightsy',
          path: 'public',
        },
      },
    ];
    const panes = extractFilesPanes(parts);
    expect(panes).toHaveLength(1);
    expect(isFilesPane(panes[0]!)).toBe(true);
    expect(panes[0]!.title).toBe('Media');
    expect(panes[0]!.path).toBe('public');
  });
});

describe('resourceHasContentStates', () => {
  it('is false for plain resources (save-only forms)', () => {
    expect(
      resourceHasContentStates({
        id: 'x',
        title: 'X',
        schema: { type: 'object', properties: {} },
      }),
    ).toBe(false);
  });

  it('is true when draft/published lifecycle is declared', () => {
    expect(
      resourceHasContentStates({
        id: 'x',
        title: 'X',
        schema: { type: 'object', properties: {} },
        contentStates: ['draft', 'published'],
      }),
    ).toBe(true);
  });

  it('reads ui:contentStates from schemaUi', () => {
    expect(
      resourceHasContentStates({
        id: 'x',
        title: 'X',
        schema: { type: 'object', properties: {} },
        schemaUi: { 'ui:contentStates': ['draft', 'published'] },
      }),
    ).toBe(true);
  });
});

describe('latestRightPaneContent', () => {
  it('prefers schema panes over HTML artifacts', () => {
    const text = '```html\n<!DOCTYPE html><html><body><h1>Page</h1></body></html>\n```';
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 't',
        name: 'present_schema',
        status: 'done',
        input: {
          title: 'CMS',
          datasource: 'brightsy',
          resource_id: 'rt',
        },
      },
    ];
    const latest = latestRightPaneContent(text, parts);
    expect(latest && isSchemaPane(latest)).toBe(true);
  });
});
