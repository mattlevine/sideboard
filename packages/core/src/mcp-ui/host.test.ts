import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
        {
          name: 'rate',
          description: 'Rate',
          inputSchema: { type: 'object' as const, properties: {} },
          _meta: { ui: { visibility: ['app'] } },
        },
        {
          name: 'secret',
          description: 'Model only',
          inputSchema: { type: 'object' as const, properties: {} },
          _meta: { ui: { visibility: ['model'] } },
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
    expect(await host.callTool('dice', 'rate', {})).toMatchObject({
      structuredContent: { echoed: 'rate' },
    });
    await expect(host.callTool('dice', 'secret', {})).rejects.toThrow(/not available to the app/);

    const proxied = await host.proxyEntries({ dice: { command: 'dice' } });
    expect(proxied.dice).toMatchObject({ type: 'http' });
    const url = String(proxied.dice?.url ?? '');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s\/dice$/);
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: (proxied.dice?.headers as Record<string, string>) ?? {} },
    });
    const client = new Client({ name: 'claude', version: '0.0.0' });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['roll', 'secret']);
      await expect(client.callTool({ name: 'rate', arguments: {} })).rejects.toThrow(
        /not available to the model/,
      );
    } finally {
      await client.close();
    }
  });
});
