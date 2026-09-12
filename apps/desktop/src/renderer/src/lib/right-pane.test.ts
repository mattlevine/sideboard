import { describe, expect, it } from 'vitest';
import type { MessagePart } from '@sideboard-ai/core';
import {
  extractFilesPanes,
  extractSchemaFencePanes,
  extractSchemaPanes,
  findLiveTabReplaceIndex,
  isFilesPane,
  isSchemaPane,
  latestRightPaneContent,
  resourceHasContentStates,
  upsertRightPaneTab,
  type ChatArtifact,
  type RightPaneContent,
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

function logPane(overrides: Partial<ChatArtifact> & { id: string }): RightPaneContent {
  return {
    title: 'Mac pack',
    kind: 'log',
    language: 'log',
    content: 'line 1',
    source: 'tool',
    status: 'running',
    ...overrides,
  };
}

describe('upsertRightPaneTab', () => {
  const other: RightPaneContent = {
    kind: 'files',
    id: 'files-1',
    title: 'Files',
    datasource: 'memory',
    source: 'tool',
  };

  it('focuses a tab the first time it opens', () => {
    const first = logPane({ id: 'tool-job', content: '[1] start' });
    const opened = upsertRightPaneTab([other], first, {
      activate: false,
      activeId: other.id,
    });
    expect(opened.activeId).toBe('tool-job');
    expect(opened.tabs.map((t) => t.id)).toEqual(['files-1', 'tool-job']);
  });

  it('does not steal focus when a streaming log appends', () => {
    const log = logPane({ id: 'tool-job', content: '[1] start' });
    const next = logPane({ id: 'tool-job', content: '[2] more', phase: 'Signing' });
    const updated = upsertRightPaneTab([log, other], next, {
      activate: false,
      activeId: other.id,
    });
    expect(updated.activeId).toBe(other.id);
    expect(updated.tabs.find((t) => t.id === 'tool-job')?.content).toBe(
      '[1] start\n[2] more',
    );
  });

  it('stays on the log when the user has not switched away', () => {
    const log = logPane({ id: 'tool-job', content: '[1] start' });
    const next = logPane({ id: 'tool-job', content: '[2] more' });
    const updated = upsertRightPaneTab([log, other], next, {
      activate: false,
      activeId: log.id,
    });
    expect(updated.activeId).toBe('tool-job');
  });

  it('focuses the tab when the user opens it', () => {
    const log = logPane({ id: 'tool-job' });
    const opened = upsertRightPaneTab([log, other], log);
    expect(opened.activeId).toBe('tool-job');
  });

  it('keeps the user on another tab when a live id migrates after the turn', () => {
    const live = logPane({
      id: 'live-0',
      title: 'Spec',
      kind: 'markdown',
      language: 'markdown',
      content: '# Spec\n\nDone.',
      source: 'fence',
    });
    const persisted = { ...live, id: 'msg-3-0' };
    const migrated = upsertRightPaneTab([live, other], persisted, {
      activate: false,
      activeId: other.id,
    });
    expect(migrated.activeId).toBe(other.id);
    expect(migrated.tabs.some((t) => t.id === 'msg-3-0')).toBe(true);
    expect(migrated.tabs.some((t) => t.id === 'live-0')).toBe(false);
  });

  it('follows a live id migration when that tab is active', () => {
    const live = logPane({
      id: 'live-0',
      title: 'Spec',
      kind: 'markdown',
      language: 'markdown',
      content: '# Spec\n\nDone.',
      source: 'fence',
    });
    const persisted = { ...live, id: 'msg-3-0' };
    const migrated = upsertRightPaneTab([live], persisted, {
      activate: false,
      activeId: live.id,
    });
    expect(migrated.activeId).toBe('msg-3-0');
  });

  it('keeps the current tab when a live rewrite does not match sameRightPane', () => {
    const live = logPane({
      id: 'live-0',
      title: 'Spec',
      kind: 'markdown',
      language: 'markdown',
      content: '# Spec\n\nStreaming…',
      source: 'fence',
    });
    const persisted = logPane({
      id: 'msg-3-0',
      title: 'Spec',
      kind: 'markdown',
      language: 'markdown',
      content: '# Spec\n\nDone.',
      source: 'fence',
    });
    const migrated = upsertRightPaneTab([live, other], persisted, {
      activate: false,
      activeId: other.id,
      replaceId: live.id,
    });
    expect(migrated.activeId).toBe(other.id);
    expect(migrated.tabs.map((t) => t.id)).toEqual(['msg-3-0', other.id]);
    expect(migrated.tabs.find((t) => t.id === 'msg-3-0')?.content).toBe(
      '# Spec\n\nDone.',
    );
  });
});

describe('findLiveTabReplaceIndex', () => {
  it('rewrites the matching live document, not an earlier schema-live tab', () => {
    const schema: RightPaneContent = {
      kind: 'schema',
      id: 'schema-live-0',
      title: 'Posts',
      mode: 'table',
      datasource: 'inline',
      source: 'tool',
    };
    const liveDoc = logPane({
      id: 'live-1',
      title: 'Spec',
      kind: 'markdown',
      language: 'markdown',
      content: '# Spec\n\nDone.',
      source: 'fence',
    });
    const settled = { ...liveDoc, id: 'msg-3-0' };
    expect(findLiveTabReplaceIndex([schema, liveDoc], settled)).toBe(1);
  });

  it('returns -1 when no live tab of that kind exists', () => {
    const schema: RightPaneContent = {
      kind: 'schema',
      id: 'schema-live-0',
      title: 'Posts',
      mode: 'table',
      datasource: 'inline',
      source: 'tool',
    };
    const settled = logPane({
      id: 'msg-3-0',
      title: 'Spec',
      kind: 'markdown',
      language: 'markdown',
      content: '# Spec',
      source: 'fence',
    });
    expect(findLiveTabReplaceIndex([schema], settled)).toBe(-1);
  });
});

describe('latestRightPaneContent', () => {
  it('opens the log pane from wait_for_job without present_artifact', () => {
    const parts: MessagePart[] = [
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
          phase: 'vitest',
        }),
      },
    ];
    const latest = latestRightPaneContent('', parts);
    expect(latest?.kind).toBe('log');
    expect(latest?.id).toBe('tool-core-test');
    expect(latest && 'content' in latest ? latest.content : '').toBe('PASS 1');
  });

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
