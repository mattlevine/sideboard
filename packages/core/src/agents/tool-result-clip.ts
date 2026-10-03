/**
 * Bound tool-result payloads before they reach any worktree agent.
 *
 * Huge dumps (CLI `--json`, full file reads, packaged SDK source) crash the
 * Cursor SDK mid-turn (`resource_exhausted` / protobuf) and can stall Claude /
 * Codex / OpenCode. Clip to the store cap; spill the original to `.context/cli/`
 * so the model can Read a slice instead of ingesting the whole blob.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_DIR } from '../paths/workspace-scratch.js';
import {
  clipToolResultForStore,
  looksLikeHugeToolResultDump,
  TOOL_RESULT_STORE_MAX_CHARS,
} from './error-detail.js';

export { clipToolResultForStore, TOOL_RESULT_STORE_MAX_CHARS };

export type McpTextContent = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

export type McpToolResult = {
  content?: McpTextContent[];
  isError?: boolean;
  [key: string]: unknown;
};

function spillPath(cwd: string, prefix: string): string {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const safe = prefix.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'tool';
  return join(cwd, CLI_DIR, `${safe}-${stamp}.txt`);
}

/** Write `content` under `.context/cli/`; null when cwd is missing or write fails. */
export function spillToolResultToCli(
  content: string,
  opts?: { cwd?: string; prefix?: string },
): string | null {
  const cwd = opts?.cwd?.trim();
  if (!cwd || !content) return null;
  const file = spillPath(cwd, opts?.prefix ?? 'tool-result');
  try {
    mkdirSync(join(cwd, CLI_DIR), { recursive: true });
    writeFileSync(file, content, 'utf8');
    return file;
  } catch {
    return null;
  }
}

/**
 * Clip a tool payload for the model. Oversized non-crash dumps are copied to
 * `.context/cli/` when `cwd` is set so the agent can Read a slice.
 */
export function spillAndClipToolResult(
  content: string,
  opts?: { cwd?: string; prefix?: string },
): string {
  const clipped = clipToolResultForStore(content);
  if (clipped == null) return content;
  if (clipped === content) return content;
  if (looksLikeHugeToolResultDump(content)) return clipped;
  const spilled = spillToolResultToCli(content, opts);
  if (!spilled) return clipped;
  return `${clipped}\n\nFull output: ${spilled} (${content.length} chars). Read that file with offset/limit — do not dump it whole.`;
}

export function clipMcpToolResult(
  result: McpToolResult | undefined | null,
  cwd?: string,
): McpToolResult {
  if (result == null) return { content: [] };
  if (!Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map((block) => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return block;
      return {
        ...block,
        text: spillAndClipToolResult(block.text, { cwd, prefix: 'mcp' }),
      };
    }),
  };
}

/** Clip Sideboard AgentEvent payloads before NDJSON leaves the Cursor runner. */
export function clipAgentEventForEmit(event: unknown, cwd?: string): unknown {
  if (!event || typeof event !== 'object') return event;
  const rec = event as Record<string, unknown>;
  if (rec.type === 'tool_result' && typeof rec.content === 'string') {
    return {
      ...rec,
      content: spillAndClipToolResult(rec.content, { cwd, prefix: 'cursor-tool' }),
    };
  }
  if (
    (rec.type === 'stderr' || rec.type === 'stdout') &&
    typeof rec.data === 'string' &&
    looksLikeHugeToolResultDump(rec.data)
  ) {
    return { ...rec, data: clipToolResultForStore(rec.data) };
  }
  return event;
}
