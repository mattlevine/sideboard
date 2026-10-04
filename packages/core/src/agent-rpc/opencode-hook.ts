import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import {
  PILOT_TOOL_DESCRIPTIONS,
  PILOT_TOOL_SCHEMAS,
} from './pilot-tools.js';
import {
  AGENT_RPC_CWD_ENV,
  AGENT_RPC_TOKEN_ENV,
  AGENT_RPC_URL_ENV,
} from './protocol.js';

/**
 * OpenCode plugin loaded from OPENCODE_CONFIG_DIR/plugins.
 * Uses the runtime's `@opencode-ai/plugin` `tool()` helper and the global
 * WebSocket (Bun / Node 22) so it does not import Sideboard packages.
 */
export const OPENCODE_PLUGIN_SOURCE = `import { tool } from "@opencode-ai/plugin"

const URL = process.env[${JSON.stringify(AGENT_RPC_URL_ENV)}] || ""
const TOKEN = process.env[${JSON.stringify(AGENT_RPC_TOKEN_ENV)}] || ""
const CWD = process.env[${JSON.stringify(AGENT_RPC_CWD_ENV)}] || ""

function jsonResult(value) {
  return JSON.stringify(value)
}

function jsonError(err) {
  return jsonResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
}

function call(method, params) {
  if (!URL || !TOKEN) {
    return Promise.resolve(jsonError(new Error("Agent RPC runtime is not running")))
  }
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try { ws.close() } catch {}
      resolve(value)
    }
    const ws = new WebSocket(URL)
    const id = Date.now()
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params, authToken: TOKEN }))
    })
    ws.addEventListener("message", (ev) => {
      let msg
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg && msg.id === id) {
        if (msg.error) done(jsonError(new Error(msg.error.message || "Agent RPC error")))
        else done(jsonResult(msg.result))
      }
    })
    ws.addEventListener("error", () => done(jsonError(new Error("Agent RPC socket error"))))
    ws.addEventListener("close", () => {
      if (!settled) done(jsonError(new Error("Agent RPC socket closed")))
    })
  })
}

function str(description) {
  return tool.schema.string().describe(description)
}

function opt(description) {
  return tool.schema.string().optional().describe(description)
}

export const SideboardRpc = async (ctx) => {
  const cwd = CWD || ctx.worktree || ctx.directory || ""
  const job = (method, args) => call(method, { ...args, cwd })
  return {
    tool: {
      present_artifact: tool({
        description: ${JSON.stringify(PILOT_TOOL_DESCRIPTIONS.present_artifact)},
        args: {
          title: str("Short title shown in the artifact pane header"),
          type: tool.schema.enum(["html", "svg", "markdown", "react", "log"]),
          content: str("html/svg/markdown/react: full document. log: only the new lines."),
          artifact_id: opt("Stable id. Required for type=log."),
          status: tool.schema.enum(["running", "ok", "failed", "idle"]).optional(),
          phase: opt("Progress phase"),
          mode: tool.schema.enum(["append", "replace"]).optional(),
        },
        async execute(args) {
          return call("ui.presentArtifact", args)
        },
      }),
      wait_for_job: tool({
        description: ${JSON.stringify(PILOT_TOOL_DESCRIPTIONS.wait_for_job)},
        args: {
          id: str("Detached job id (same kebab-case id passed to detached-job.cjs start)"),
        },
        async execute(args) {
          return job("job.wait", args)
        },
      }),
      stop_job: tool({
        description: ${JSON.stringify(PILOT_TOOL_DESCRIPTIONS.stop_job)},
        args: {
          id: str("Detached job id"),
          reason: opt("Why the job is being stopped"),
        },
        async execute(args) {
          return job("job.stop", args)
        },
      }),
    },
  }
}
`;

export function writeOpencodeRpcPlugin(): { configDir: string; pluginFile: string } {
  const configDir = join(appDataDir(), 'agent-rpc', 'opencode');
  const pluginDir = join(configDir, 'plugins');
  mkdirSync(pluginDir, { recursive: true });
  const pluginFile = join(pluginDir, 'sideboard-rpc.js');
  writeFileSync(pluginFile, OPENCODE_PLUGIN_SOURCE);
  return { configDir, pluginFile };
}

/** JSON Schema kept so tests can assert the plugin still names the pilot set. */
export const OPENCODE_PILOT_SCHEMAS = PILOT_TOOL_SCHEMAS;
