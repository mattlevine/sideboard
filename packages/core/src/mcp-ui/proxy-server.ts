import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpUiSession, McpUiToolInfo } from './session.js';
import { toolVisibleTo } from './visibility.js';

/** MCP server Claude talks to. App-only tools are omitted from tools/list. */
export function createMcpUiProxyServer(name: string, session: McpUiSession): Server {
  const server = new Server(
    { name: `sideboard-ui-proxy-${name}`, version: '1.0.0' },
    { capabilities: session.capabilities() },
  );
  attachMcpUiProxyHandlers(server, session);
  return server;
}

export function attachMcpUiProxyHandlers(server: Server, session: McpUiSession): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await session.listTools();
    return { tools: tools.filter((tool) => toolVisibleTo(tool.visibility, 'model')).map(listedTool) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const tools = await session.listTools();
    const tool = tools.find((item) => item.name === name);
    if (!tool || !toolVisibleTo(tool.visibility, 'model')) {
      throw new Error(`Tool ${name} is not available to the model`);
    }
    return (await session.callTool(name, request.params.arguments ?? {})) as {
      [key: string]: unknown;
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = await session.readResource(request.params.uri);
    if (!resource) throw new Error(`Resource ${request.params.uri} was empty`);
    return {
      contents: [
        {
          uri: resource.uri,
          ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
          ...(resource.text != null ? { text: resource.text } : {}),
          ...(resource.blob != null ? { blob: resource.blob } : {}),
        },
      ],
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => session.listResources());
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () =>
    session.listResourceTemplates(),
  );
  server.setRequestHandler(ListPromptsRequestSchema, async () => session.listPrompts());
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return (await session.getPrompt(request.params.name, request.params.arguments)) as {
      [key: string]: unknown;
    };
  });
  server.fallbackRequestHandler = async (request) => {
    return (await session.forward(request.method, request.params)) as { [key: string]: unknown };
  };
}

function listedTool(tool: McpUiToolInfo) {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    _meta: {
      ui: {
        ...(tool.resourceUri ? { resourceUri: tool.resourceUri } : {}),
        visibility: tool.visibility,
      },
    },
  };
}
