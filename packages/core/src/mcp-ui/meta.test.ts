import { describe, expect, it } from 'vitest';
import {
  agentTextToCallToolResult,
  cspFromMeta,
  embeddedMcpUiFromText,
  htmlFromResourceContent,
  matchClaudeMcpTool,
  mcpUiContentSecurityPolicy,
  mcpUiFrameId,
  parseMcpServerLaunch,
  uiResourceUriFromMeta,
} from './meta.js';

describe('matchClaudeMcpTool', () => {
  it('uses the longest server name', () => {
    expect(matchClaudeMcpTool('mcp__dice__roll', ['dice'])).toEqual({
      server: 'dice',
      tool: 'roll',
    });
    expect(matchClaudeMcpTool('mcp__foo_bar__show_widget', ['foo', 'foo_bar'])).toEqual({
      server: 'foo_bar',
      tool: 'show_widget',
    });
    expect(matchClaudeMcpTool('mcp__sideboard__ask_user', ['gmail'])).toBeNull();
  });
});

describe('ui resource meta', () => {
  it('reads resourceUri and the deprecated flat key', () => {
    expect(uiResourceUriFromMeta({ ui: { resourceUri: 'ui://dice/app.html' } })).toBe(
      'ui://dice/app.html',
    );
    expect(uiResourceUriFromMeta({ 'ui/resourceUri': 'ui://legacy/app.html' })).toBe(
      'ui://legacy/app.html',
    );
    expect(uiResourceUriFromMeta({ ui: { resourceUri: 'https://evil.example' } })).toBeNull();
  });

  it('keeps only http(s) CSP origins', () => {
    expect(
      cspFromMeta({
        ui: { csp: { connectDomains: ['https://api.example/v1', 'javascript:alert(1)'] } },
      }),
    ).toEqual({ connectDomains: ['https://api.example'] });
    expect(mcpUiContentSecurityPolicy({ connectDomains: ['https://api.example'] })).toContain(
      "connect-src 'self' https://api.example",
    );
  });
});

describe('html resources', () => {
  it('decodes a ui:// html resource and ignores other schemes', () => {
    expect(
      htmlFromResourceContent({
        uri: 'ui://dice/app.html',
        mimeType: 'text/html;profile=mcp-app',
        text: '<p>roll</p>',
      }),
    ).toMatchObject({ html: '<p>roll</p>' });
    expect(
      htmlFromResourceContent({
        uri: 'file:///tmp/x.html',
        mimeType: 'text/html',
        text: '<p>no</p>',
      }),
    ).toBeNull();
  });

  it('finds an embedded resource in a tool result string', () => {
    const found = embeddedMcpUiFromText(
      JSON.stringify({
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'ui://dice/app.html',
              mimeType: 'text/html',
              text: '<b>6</b>',
              _meta: { ui: { csp: { resourceDomains: ['https://cdn.example'] } } },
            },
          },
        ],
      }),
    );
    expect(found?.html).toBe('<b>6</b>');
    expect(found?.csp?.resourceDomains).toEqual(['https://cdn.example']);
  });

  it('turns Claude text into a tool result the app can read', () => {
    expect(agentTextToCallToolResult('{"total":12}', false).structuredContent).toEqual({
      total: 12,
    });
    expect(agentTextToCallToolResult('plain', true).isError).toBe(true);
  });
});

describe('mcpUiFrameId', () => {
  it('is a stable hostname-safe id', () => {
    expect(mcpUiFrameId('toolu_01ABC')).toMatch(/^mcpui-[a-f0-9]{8}$/);
    expect(mcpUiFrameId('toolu_01ABC')).toBe(mcpUiFrameId('toolu_01ABC'));
  });
});

describe('parseMcpServerLaunch', () => {
  it('accepts stdio and https and rejects other urls', () => {
    expect(parseMcpServerLaunch({ command: 'npx', args: ['-y', 'dice'] })).toMatchObject({
      kind: 'stdio',
      command: 'npx',
    });
    expect(parseMcpServerLaunch({ type: 'sse', url: 'https://example.com/sse' })?.kind).toBe('sse');
    expect(parseMcpServerLaunch({ url: 'file:///tmp/mcp' })).toBeNull();
  });
});
