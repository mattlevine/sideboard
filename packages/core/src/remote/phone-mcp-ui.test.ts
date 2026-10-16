import { describe, expect, it } from 'vitest';
import { PHONE_CONTROL_PREFIX, takePhoneControl } from './phone-chats.js';
import { phoneMcpApps, phoneMcpToolPayload } from './phone-mcp-ui.js';
import type { MessagePart } from '../types/thread.js';

const roll: MessagePart = {
  type: 'tool',
  id: 'toolu_1',
  name: 'mcp__dice__roll',
  status: 'done',
  input: { sides: 6 },
  result: '{"n":4}',
};

describe('phoneMcpApps', () => {
  it('keeps finished Claude MCP tools and skips Sideboard tools', () => {
    const parts: MessagePart[] = [
      roll,
      { type: 'tool', id: 's', name: 'mcp__sideboard__ask_user', status: 'done' },
      { type: 'tool', id: 'run', name: 'mcp__dice__roll', status: 'running' },
    ];
    expect(phoneMcpApps('claude', parts)).toEqual([{ id: 'toolu_1', tool: 'mcp__dice__roll' }]);
    expect(phoneMcpApps('cursor', parts)).toEqual([]);
  });

  it('reads the matching tool result for the phone frame', () => {
    expect(phoneMcpToolPayload([roll], 'mcp__dice__roll', 'toolu_1')).toEqual({
      input: { sides: 6 },
      resultText: '{"n":4}',
      isError: false,
    });
  });
});

describe('phone mcp-ui control', () => {
  it('parses a lookup and a tool call', () => {
    const lookup = takePhoneControl(
      PHONE_CONTROL_PREFIX +
        JSON.stringify({ op: 'mcp-ui', chatId: 'c1', tool: 'mcp__dice__roll', callId: 'toolu_1', reqId: 'r1' }),
    );
    expect(lookup).toMatchObject({ op: 'mcp-ui', tool: 'mcp__dice__roll', reqId: 'r1' });
    const call = takePhoneControl(
      PHONE_CONTROL_PREFIX +
        JSON.stringify({
          op: 'mcp-ui-call',
          chatId: 'c1',
          reqId: 'r2',
          server: 'dice',
          tool: 'roll',
          args: { sides: 20 },
        }),
    );
    expect(call).toMatchObject({ op: 'mcp-ui-call', server: 'dice', args: { sides: 20 } });
  });
});
