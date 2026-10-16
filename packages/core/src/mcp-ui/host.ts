import { isInjectedOrchMcpName, listUserClaudeMcpServerEntries } from '../agents/orch-mcp-isolation.js';
import {
  htmlFromResourceContent,
  matchClaudeMcpTool,
  mcpUiContentSecurityPolicy,
  parseMcpServerLaunch,
  type McpServerLaunch,
  type McpUiView,
} from './meta.js';
import { openMcpUiSession, type McpUiSession, type McpUiToolInfo } from './session.js';

const TOOL_TTL_MS = 5 * 60 * 1000;

/**
 * Sideboard's own MCP Apps client for the servers Claude was given.
 * Claude Code stays text-only: it never fetches `ui://` resources, so the
 * desktop opens a second connection to read the HTML and to proxy tool
 * calls the iframe makes. Stdio servers therefore run twice — once for
 * Claude, once for this host.
 */
export class McpUiHost {
  private sessions = new Map<string, Promise<McpUiSession>>();
  private toolLists = new Map<string, { at: number; key: string; tools: McpUiToolInfo[] }>();

  constructor(
    private readonly opts: {
      entries: () => Record<string, Record<string, unknown>>;
      openSession?: (launch: McpServerLaunch) => Promise<McpUiSession>;
    },
  ) {}

  async viewForClaudeTool(toolName: string): Promise<McpUiView | null> {
    const entries = this.userEntries();
    const match = matchClaudeMcpTool(toolName, Object.keys(entries));
    if (!match) return null;
    const launch = parseMcpServerLaunch(entries[match.server] ?? {});
    if (!launch) return null;
    try {
      const session = await this.sessionFor(match.server, launch);
      const tools = await this.toolsFor(match.server, launch, session);
      const tool = tools.find((item) => item.name === match.tool);
      if (!tool?.resourceUri) return null;
      const resource = await session.readResource(tool.resourceUri);
      if (!resource) return null;
      const html = htmlFromResourceContent(resource);
      if (!html) return null;
      const csp = resource.csp ?? tool.csp;
      return {
        server: match.server,
        tool: match.tool,
        uri: html.uri,
        mimeType: html.mimeType,
        html: html.html,
        csp: mcpUiContentSecurityPolicy(csp),
      };
    } catch (err) {
      console.error(
        `[mcp-ui] ${match.server}/${match.tool}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  async callTool(server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const session = await this.sessionForName(server);
    if (!session) throw new Error(`MCP server ${server} is not available`);
    return session.callTool(tool, args);
  }

  async readResource(server: string, uri: string): Promise<unknown> {
    const session = await this.sessionForName(server);
    if (!session) throw new Error(`MCP server ${server} is not available`);
    const resource = await session.readResource(uri);
    if (!resource) throw new Error(`Resource ${uri} was empty`);
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
  }

  async closeAll(): Promise<void> {
    const pending = [...this.sessions.values()];
    this.sessions.clear();
    this.toolLists.clear();
    await Promise.all(
      pending.map((session) => session.then((open) => open.close()).catch(() => undefined)),
    );
  }

  private userEntries(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, entry] of Object.entries(this.opts.entries())) {
      if (!name.trim() || isInjectedOrchMcpName(name) || !entry) continue;
      out[name] = entry;
    }
    return out;
  }

  private async sessionForName(server: string): Promise<McpUiSession | null> {
    const entry = this.userEntries()[server];
    if (!entry) return null;
    const launch = parseMcpServerLaunch(entry);
    if (!launch) return null;
    return this.sessionFor(server, launch);
  }

  private sessionFor(server: string, launch: McpServerLaunch): Promise<McpUiSession> {
    const key = `${server}\n${JSON.stringify(launch)}`;
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const open = this.opts.openSession ?? openMcpUiSession;
    const pending = open(launch).catch((err) => {
      this.sessions.delete(key);
      throw err;
    });
    this.sessions.set(key, pending);
    return pending;
  }

  private async toolsFor(
    server: string,
    launch: McpServerLaunch,
    session: McpUiSession,
  ): Promise<McpUiToolInfo[]> {
    const key = `${server}\n${JSON.stringify(launch)}`;
    const cached = this.toolLists.get(key);
    if (cached && cached.key === key && Date.now() - cached.at < TOOL_TTL_MS) return cached.tools;
    const tools = await session.listTools();
    this.toolLists.set(key, { at: Date.now(), key, tools });
    return tools;
  }
}

let singleton: McpUiHost | undefined;

export function getMcpUiHost(): McpUiHost {
  if (!singleton) {
    singleton = new McpUiHost({ entries: () => listUserClaudeMcpServerEntries() });
  }
  return singleton;
}

export function closeMcpUiHost(): void {
  const host = singleton;
  singleton = undefined;
  if (host) void host.closeAll();
}
