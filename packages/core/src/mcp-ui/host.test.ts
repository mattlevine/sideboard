import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { McpUiHost } from './host.js';
import { openMcpUiSessionFromTransport } from './session.js';

describe('McpUiHost', () => {
  const hosts: McpUiHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.closeAll()));
  });

  it('loads the ui:// resource linked from the Claude tool name', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'dice', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'roll',
          description: 'Roll dice',
          inputSchema: { type: 'object' as const, properties: {} },
          _meta: { ui: { resourceUri: 'ui://dice/app.html' } },
        },
      ],
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async () => ({
      contents: [
        {
          uri: 'ui://dice/app.html',
          mimeType: 'text/html;profile=mcp-app',
          text: '<p>dice</p>',
          _meta: { ui: { csp: { connectDomains: ['https://dice.example'] } } },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      structuredContent: { echoed: request.params.name },
    }));
    await server.connect(serverTransport);

    const host = new McpUiHost({
      entries: () => ({
        dice: { command: 'dice' },
        sideboard: { command: 'sideboard' },
      }),
      openSession: () => openMcpUiSessionFromTransport(clientTransport),
    });
    hosts.push(host);

    const view = await host.viewForClaudeTool('mcp__dice__roll');
    expect(view).toMatchObject({
      server: 'dice',
      tool: 'roll',
      uri: 'ui://dice/app.html',
      html: '<p>dice</p>',
    });
    expect(view?.csp).toContain('https://dice.example');
    expect(await host.viewForClaudeTool('mcp__sideboard__ask_user')).toBeNull();

    const called = await host.callTool('dice', 'roll', { sides: 6 });
    expect(called).toMatchObject({ structuredContent: { echoed: 'roll' } });
  });
});
