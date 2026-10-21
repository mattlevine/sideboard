import { describe, expect, it } from 'vitest';
import { guestBridgeEffects, toolInputNotification, toolResultNotification } from './bridge.js';

describe('guestBridgeEffects', () => {
  it('answers ui/initialize and marks the app ready', () => {
    const init = guestBridgeEffects(
      { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} },
      { theme: 'dark' },
    );
    expect(init).toHaveLength(1);
    expect(init[0]).toMatchObject({
      type: 'reply',
      message: {
        id: 1,
        result: {
          protocolVersion: '2026-01-26',
          hostContext: { theme: 'dark' },
          hostInfo: { name: 'sideboard' },
        },
      },
    });
    expect(guestBridgeEffects({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, {})).toEqual([
      { type: 'ready' },
    ]);
  });

  it('forwards tool calls, links, chat, and size', () => {
    expect(
      guestBridgeEffects(
        {
          jsonrpc: '2.0',
          id: 'c1',
          method: 'tools/call',
          params: { name: 'roll', arguments: { sides: 6 } },
        },
        {},
      ),
    ).toEqual([{ type: 'call-tool', name: 'roll', args: { sides: 6 }, id: 'c1' }]);
    expect(
      guestBridgeEffects(
        { jsonrpc: '2.0', id: 2, method: 'ui/open-link', params: { url: 'javascript:alert(1)' } },
        {},
      )[0],
    ).toMatchObject({ type: 'reply' });
    expect(
      guestBridgeEffects(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'ui/message',
          params: { role: 'user', content: { type: 'text', text: 'again' } },
        },
        {},
      ),
    ).toEqual([{ type: 'chat', text: 'again', id: 3 }]);
    expect(
      guestBridgeEffects(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'ui/update-model-context',
          params: { content: [{ type: 'text', text: 'score 8' }] },
        },
        {},
      ),
    ).toEqual([{ type: 'update-context', text: 'MCP App context:\nscore 8', id: 4 }]);
    expect(
      guestBridgeEffects(
        { jsonrpc: '2.0', id: 5, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } },
        {},
      ),
    ).toMatchObject([{ type: 'reply', message: { result: { mode: 'inline' } } }]);
    expect(
      guestBridgeEffects(
        { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 320 } },
        {},
      ),
    ).toEqual([{ type: 'resize', height: 320 }]);
  });

  it('accepts legacy MCP-UI postMessage actions', () => {
    expect(
      guestBridgeEffects(
        { type: 'tool', messageId: 'm1', payload: { toolName: 'roll', params: { sides: 20 } } },
        {},
      ),
    ).toEqual([
      { type: 'legacy-call-tool', name: 'roll', args: { sides: 20 }, messageId: 'm1' },
    ]);
  });
});

describe('tool notifications', () => {
  it('sends input before result in the MCP Apps shape', () => {
    expect(toolInputNotification({ sides: 6 }).params).toEqual({ arguments: { sides: 6 } });
    expect(toolResultNotification({ content: [], structuredContent: { n: 1 } }).method).toBe(
      'ui/notifications/tool-result',
    );
  });
});
