import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isInjectedOrchMcpName, listUserClaudeMcpServerEntries } from '../agents/orch-mcp-isolation.js';
import {
  htmlFromResourceContent,
  matchClaudeMcpTool,
  mcpUiContentSecurityPolicy,
  parseMcpServerLaunch,
  type McpServerLaunch,
  type McpUiView,
} from './meta.js';
import { listenMcpUiProxy, type McpUiProxyListen } from './proxy-http.js';
import { openMcpUiSession, type McpUiSession, type McpUiToolInfo } from './session.js';
import { toolVisibleTo } from './visibility.js';

const TOOL_TTL_MS = 5 * 60 * 1000;

/**
 * MCP Apps host. Claude talks to a loopback proxy (`proxyEntries`) that
 * shares this process's upstream session and hides app-only tools. The
 * iframe uses the same session for `tools/call` / `resources/read`.
 */
export class McpUiHost {
  private sessions = new Map<string, Promise<McpUiSession>>();
  private toolLists = new Map<string, { at: number; key: string; tools: McpUiToolInfo[] }>();
  private proxy: Promise<McpUiProxyListen> | undefined;
  private proxyDirs = new Map<string, string[] | undefined>();

  constructor(
    private readonly opts: {
      entries: (projectDirs?: string[]) => Record<string, Record<string, unknown>>;
      openSession?: (launch: McpServerLaunch) => Promise<McpUiSession>;
    },
  ) {}

  async viewForClaudeTool(toolName: string, projectDirs?: string[]): Promise<McpUiView | null> {
    const entries = this.userEntries(projectDirs);
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

  /**
   * Point Claude at loopback HTTP so it shares this host's upstream session
   * and never sees `visibility: ["app"]` tools.
   */
  async proxyEntries(
    entries: Record<string, Record<string, unknown>>,
    projectDirs?: string[],
  ): Promise<Record<string, Record<string, unknown>>> {
    const names = Object.keys(entries).filter((name) => name.trim());
    if (names.length === 0) return {};
    const dirsKey = dirsKeyFor(projectDirs);
    this.proxyDirs.set(dirsKey, projectDirs);
    try {
      const listen = await this.ensureProxy();
      const out: Record<string, Record<string, unknown>> = {};
      for (const name of names) {
        out[name] = {
          type: 'http',
          url: listen.urlFor(name, dirsKey),
          headers: listen.headers,
        };
      }
      return out;
    } catch (err) {
      console.error('[mcp-ui] proxy:', err instanceof Error ? err.message : err);
      return { ...entries };
    }
  }

  async callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    projectDirs?: string[],
  ): Promise<unknown> {
    const entry = this.userEntries(projectDirs)[server];
    if (!entry) throw new Error(`MCP server ${server} is not available`);
    const launch = parseMcpServerLaunch(entry);
    if (!launch) throw new Error(`MCP server ${server} is not available`);
    const session = await this.sessionFor(server, launch);
    const tools = await this.toolsFor(server, launch, session);
    const info = tools.find((item) => item.name === tool);
    if (!info || !toolVisibleTo(info.visibility, 'app')) {
      throw new Error(`Tool ${tool} is not available to the app`);
    }
    return session.callTool(tool, args);
  }

  async readResource(server: string, uri: string, projectDirs?: string[]): Promise<unknown> {
    const session = await this.sessionForName(server, projectDirs);
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
    const proxy = this.proxy;
    this.sessions.clear();
    this.toolLists.clear();
    this.proxyDirs.clear();
    this.proxy = undefined;
    await Promise.all([
      ...pending.map((session) => session.then((open) => open.close()).catch(() => undefined)),
      proxy ? proxy.then((listen) => listen.close()).catch(() => undefined) : Promise.resolve(),
    ]);
  }

  private ensureProxy(): Promise<McpUiProxyListen> {
    if (this.proxy) return this.proxy;
    this.proxy = listenMcpUiProxy({
      sessionFor: (server, dirsKey) => {
        if (dirsKey && !this.proxyDirs.has(dirsKey)) return Promise.resolve(null);
        return this.sessionForName(server, this.proxyDirs.get(dirsKey));
      },
    }).catch((err) => {
      this.proxy = undefined;
      throw err;
    });
    return this.proxy;
  }

  private userEntries(projectDirs?: string[]): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, entry] of Object.entries(this.opts.entries(projectDirs))) {
      if (!name.trim() || isInjectedOrchMcpName(name) || !entry) continue;
      out[name] = entry;
    }
    return out;
  }

  private async sessionForName(
    server: string,
    projectDirs?: string[],
  ): Promise<McpUiSession | null> {
    const entry = this.userEntries(projectDirs)[server];
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
    singleton = new McpUiHost({
      entries: (projectDirs) => listUserClaudeMcpServerEntries(homedir(), projectDirs),
    });
  }
  return singleton;
}

/** Orchestrators stay unproxied. Worktree Claude talks to the loopback host. */
export async function proxyClaudeUserMcp(
  orchestrator: boolean,
  projectDirs: Array<string | null | undefined>,
): Promise<Record<string, Record<string, unknown>>> {
  if (orchestrator) return {};
  const dirs = projectDirs.filter((d): d is string => typeof d === 'string' && d.length > 0);
  return getMcpUiHost().proxyEntries(listUserClaudeMcpServerEntries(homedir(), dirs), dirs);
}

export function closeMcpUiHost(): void {
  const host = singleton;
  singleton = undefined;
  if (host) void host.closeAll();
}

function dirsKeyFor(projectDirs?: string[]): string {
  if (!projectDirs?.length) return '';
  return createHash('sha256').update(projectDirs.join('\0')).digest('hex').slice(0, 16);
}
