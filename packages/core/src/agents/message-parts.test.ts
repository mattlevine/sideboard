import { describe, expect, it } from 'vitest';
import {
  applyAgentEvent,
  partsToAssistantText,
  stripBrightsyNdjsonNoise,
  toolDetail,
} from './message-parts.js';

describe('applyAgentEvent', () => {
  it('accumulates text, thinking, and tools', () => {
    let parts = applyAgentEvent([], { type: 'thinking', data: 'plan…' });
    parts = applyAgentEvent(parts, {
      type: 'tool_use',
      id: 't1',
      name: 'Bash',
      input: { command: 'git status' },
    });
    parts = applyAgentEvent(parts, { type: 'tool_result', id: 't1', content: 'clean' });
    parts = applyAgentEvent(parts, { type: 'stdout', data: 'Done.' });

    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ type: 'thinking', text: 'plan…' });
    expect(parts[1]).toMatchObject({
      type: 'tool',
      id: 't1',
      status: 'done',
      detail: 'git status',
    });
    expect(parts[2]).toMatchObject({ type: 'text', text: 'Done.' });
    expect(partsToAssistantText(parts)).toBe('Done.');
  });

  it('updates existing tool_use by id', () => {
    let parts = applyAgentEvent([], {
      type: 'tool_use',
      id: 'e1',
      name: 'Edit',
      input: {},
    });
    parts = applyAgentEvent(parts, {
      type: 'tool_use',
      id: 'e1',
      name: 'Edit',
      input: { file_path: 'apps/.env', old_string: 'a', new_string: 'b\nc' },
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: 'tool',
      filePath: 'apps/.env',
      additions: 2,
      deletions: 1,
    });
  });

  it('does not treat MCP JSON payloads as git diff stats', () => {
    let parts = applyAgentEvent([], {
      type: 'tool_use',
      id: 'm1',
      name: 'mcp__brightsy_brightsy-ai-examples__list_record_types',
      input: {},
    });
    parts = applyAgentEvent(parts, {
      type: 'tool_result',
      id: 'm1',
      content:
        '{"ok":true,"types":[{"slug":"task","phone":"+15551212","priority":-2}]}',
    });
    expect(parts[0]).toMatchObject({ type: 'tool', status: 'done' });
    expect(parts[0]).not.toHaveProperty('additions');
    expect(parts[0]).not.toHaveProperty('deletions');
  });

  it('still parses paired git-style +N -M stats from results', () => {
    let parts = applyAgentEvent([], {
      type: 'tool_use',
      id: 'e2',
      name: 'Bash',
      input: { command: 'git diff --stat' },
    });
    parts = applyAgentEvent(parts, {
      type: 'tool_result',
      id: 'e2',
      content: ' file.ts | 5 ++++-\n 1 file changed, +4 -1',
    });
    expect(parts[0]).toMatchObject({
      type: 'tool',
      additions: 4,
      deletions: 1,
    });
  });
});

describe('toolDetail', () => {
  it('prefers command for bash', () => {
    expect(toolDetail('Bash', { command: 'ls -la' })).toBe('ls -la');
  });
});

describe('stripBrightsyNdjsonNoise', () => {
  it('removes concatenated tool_use/tool_result prefixes from answer text', () => {
    const polluted =
      '{"type":"tool_use","id":"get_record_types_0","name":"get_record_types","input":{}}' +
      '{"type":"tool_result","id":"get_record_types_0","name":"get_record_types","content":"{\\"ok\\":true}"}' +
      'Here are your record types.';
    expect(stripBrightsyNdjsonNoise(polluted)).toBe('Here are your record types.');
  });
});
