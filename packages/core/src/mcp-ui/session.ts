import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  cspFromMeta,
  uiResourceUriFromMeta,
  type McpServerLaunch,
  type McpUiCsp,
} from './meta.js';
import { visibilityFromMeta, type McpUiAudience } from './visibility.js';

const REQUEST_TIMEOUT_MS = 20_000;

export type McpUiToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  resourceUri: string | null;
  visibility: McpUiAudience[];
  csp?: McpUiCsp;
};

export type McpUiSession = {
  listTools(): Promise<McpUiToolInfo[]>;
  listResources(): Promise<{ resources: unknown[] }>;
  listResourceTemplates(): Promise<{ resourceTemplates: unknown[] }>;
  listPrompts(): Promise<{ prompts: unknown[] }>;
  getPrompt(name: string, args?: Record<string, string>): Promise<unknown>;
  readResource(uri: string): Promise<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
    csp?: McpUiCsp;
  } | null>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

async function orEmpty<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

const UI_CAPABILITIES = {
  extensions: {
    'io.modelcontextprotocol/ui': {
      mimeTypes: ['text/html;profile=mcp-app'],
    },
  },
};

export async function openMcpUiSession(launch: McpServerLaunch): Promise<McpUiSession> {
  return openMcpUiSessionFromTransport(transportForLaunch(launch));
}

export async function openMcpUiSessionFromTransport(transport: Transport): Promise<McpUiSession> {
  const client = new Client(
    { name: 'sideboard', version: '1.0.0' },
    { capabilities: UI_CAPABILITIES },
  );
  await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
  return {
    async listTools() {
      const listed = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
      return listed.tools.map((tool) => {
        const meta = tool._meta;
        return {
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
          resourceUri: uiResourceUriFromMeta(meta),
          visibility: visibilityFromMeta(meta),
          ...(cspFromMeta(meta) ? { csp: cspFromMeta(meta) } : {}),
        };
      });
    },
    listResources: () =>
      orEmpty(
        () => client.listResources(undefined, { timeout: REQUEST_TIMEOUT_MS }),
        { resources: [] },
      ),
    listResourceTemplates: () =>
      orEmpty(
        () => client.listResourceTemplates(undefined, { timeout: REQUEST_TIMEOUT_MS }),
        { resourceTemplates: [] },
      ),
    listPrompts: () =>
      orEmpty(
        () => client.listPrompts(undefined, { timeout: REQUEST_TIMEOUT_MS }),
        { prompts: [] },
      ),
    getPrompt(name, args) {
      return client.getPrompt({ name, arguments: args }, { timeout: REQUEST_TIMEOUT_MS });
    },
    async readResource(uri: string) {
      const result = await client.readResource({ uri }, { timeout: REQUEST_TIMEOUT_MS });
      const content = result.contents?.[0];
      if (!content) return null;
      const text = 'text' in content && typeof content.text === 'string' ? content.text : undefined;
      const blob = 'blob' in content && typeof content.blob === 'string' ? content.blob : undefined;
      return {
        uri: content.uri,
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        ...(text != null ? { text } : {}),
        ...(blob != null ? { blob } : {}),
        ...(cspFromMeta(content._meta) ? { csp: cspFromMeta(content._meta) } : {}),
      };
    },
    async callTool(name, args) {
      return client.callTool({ name, arguments: args }, undefined, { timeout: REQUEST_TIMEOUT_MS });
    },
    async close() {
      await client.close();
    },
  };
}

function transportForLaunch(launch: McpServerLaunch): Transport {
  if (launch.kind === 'stdio') {
    return new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: { ...getDefaultEnvironment(), ...launch.env },
      stderr: 'ignore',
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
    });
  }
  const url = new URL(launch.url);
  const requestInit = launch.headers ? { headers: launch.headers } : undefined;
  if (launch.kind === 'sse') {
    return new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
  }
  return new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
}
