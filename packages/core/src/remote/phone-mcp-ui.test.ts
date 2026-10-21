import { describe, expect, it } from 'vitest';
import { PHONE_CONTROL_PREFIX, takePhoneControl } from './phone-chats.js';
import { phoneMcpApps, phoneMcpToolPayload, phoneMcpToolPayloadFromMessages } from './phone-mcp-ui.js';
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

  it('does not reuse a later call of the same tool', () => {
    const later: MessagePart = { ...roll, id: 'toolu_2', input: { sides: 20 }, result: '{"n":1}' };
    expect(phoneMcpToolPayload([roll, later], 'mcp__dice__roll', 'missing')).toBeNull();
    expect(
      phoneMcpToolPayloadFromMessages(
        [
          { role: 'agent', parts: [roll] },
          { role: 'user' },
          { role: 'agent', parts: [later] },
        ],
        'mcp__dice__roll',
        'toolu_1',
      ),
    ).toEqual({ input: { sides: 6 }, resultText: '{"n":4}', isError: false });
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
    const context = takePhoneControl(
      PHONE_CONTROL_PREFIX +
        JSON.stringify({
          op: 'mcp-ui-context',
          chatId: 'c1',
          reqId: 'r3',
          text: 'MCP App context:\nscore 8',
        }),
    );
    expect(context).toMatchObject({ op: 'mcp-ui-context', text: 'MCP App context:\nscore 8' });
    const read = takePhoneControl(
      PHONE_CONTROL_PREFIX +
        JSON.stringify({
          op: 'mcp-ui-read',
          chatId: 'c1',
          reqId: 'r4',
          server: 'dice',
          uri: 'resource://dice/face.json',
        }),
    );
    expect(read).toMatchObject({ op: 'mcp-ui-read', uri: 'resource://dice/face.json' });
    expect(
      takePhoneControl(
        PHONE_CONTROL_PREFIX +
          JSON.stringify({
            op: 'mcp-ui-read',
            chatId: 'c1',
            reqId: 'r5',
            server: 'dice',
            uri: 'javascript:alert(1)',
          }),
      ),
    ).toBe('invalid');
  });
});
