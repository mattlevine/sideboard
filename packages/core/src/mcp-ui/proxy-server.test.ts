import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpUiProxyServer } from './proxy-server.js';
import { openMcpUiSessionFromTransport } from './session.js';

describe('mcp-ui proxy', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it('hides app-only tools from the model and still lists model tools', async () => {
    const [upstreamClient, upstreamServer] = InMemoryTransport.createLinkedPair();
    const [proxyClient, proxyServer] = InMemoryTransport.createLinkedPair();
    const origin = new Server(
      { name: 'scholar', version: '0.0.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    origin.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'show_card',
          description: 'Show the card',
          inputSchema: { type: 'object' as const, properties: {} },
          _meta: { ui: { resourceUri: 'ui://card', visibility: ['model', 'app'] } },
        },
        {
          name: 'rate_card',
          description: 'Rate',
          inputSchema: { type: 'object' as const, properties: {} },
          _meta: { ui: { visibility: ['app'] } },
        },
      ],
    }));
    origin.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: 'text' as const, text: request.params.name }],
    }));
    origin.setRequestHandler(ReadResourceRequestSchema, async () => ({
      contents: [{ uri: 'ui://card', mimeType: 'text/html;profile=mcp-app', text: '<p>card</p>' }],
    }));
    await origin.connect(upstreamServer);
    const session = await openMcpUiSessionFromTransport(upstreamClient);
    const proxy = createMcpUiProxyServer('scholar', session);
    await proxy.connect(proxyServer);
    const client = new Client({ name: 'claude', version: '0.0.0' });
    await client.connect(proxyClient);
    closers.push(async () => {
      await client.close();
      await proxy.close();
      await session.close();
      await origin.close();
    });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['show_card']);
    await expect(client.callTool({ name: 'rate_card', arguments: {} })).rejects.toThrow(/not available to the model/);
    const called = await client.callTool({ name: 'show_card', arguments: {} });
    expect(called).toMatchObject({ content: [{ type: 'text', text: 'show_card' }] });
  });
});
