import { existsSync } from 'node:fs';
import { run } from '../git/run.js';
import {
  applyConnectedTeamToCli,
  ensureConnectedBrightsyTeamTokens,
  ensureCliTeamTracked,
  type ConnectedBrightsyTeam,
} from '../brightsy/connected-teams.js';
import { loadBrightsyConfig } from '../brightsy/config.js';
import { resolveAgentExecutable } from '../store/app-settings.js';
import type { AgentEvent, AgentStatus, TokenUsage } from '../types/thread.js';
import { fromInclusiveInputUsage } from './usage.js';
import {
  decodeBrightsyTarget,
  type BrightsyChatTarget,
  type BrightsyChatTargets,
  type BrightsyTeamTargets,
} from './brightsy-targets.js';
import { extractJsonErrorMessage, formatUnknownDetail } from './error-detail.js';
import { flattenTurnInput } from './turn-input.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';

export type {
  BrightsyChatTarget,
  BrightsyChatTargets,
  BrightsyTeamTargets,
} from './brightsy-targets.js';
export { decodeBrightsyTarget, encodeBrightsyTarget } from './brightsy-targets.js';

type BrightsyUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cost?: number;
};

function usageFromBrightsy(usage: BrightsyUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  const mapped = fromInclusiveInputUsage({
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0),
  });
  if (!mapped) return null;
  if (usage.cost != null && Number.isFinite(Number(usage.cost))) {
    mapped.costUsd = Number(usage.cost);
  }
  return mapped;
}

/**
 * Parse one Brightsy CLI `--json` NDJSON line into agent events.
 * Used by the adapter and as a spawn fallback so tool lines never become answer text.
 */
export function parseBrightsyCliLine(line: string): AgentEvent | AgentEvent[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return { type: 'stdout', data: obj.text };
    }
    if (obj.type === 'thinking' && typeof obj.text === 'string') {
      return { type: 'thinking', data: obj.text };
    }
    if (obj.type === 'error') {
      const msg =
        extractJsonErrorMessage(obj) ||
        formatUnknownDetail(obj.error) ||
        formatUnknownDetail(obj.message) ||
        trimmed;
      return [
        { type: 'stderr', data: msg },
        { type: 'stdout', data: `Error: ${msg}` },
      ] satisfies AgentEvent[];
    }
    if (obj.type === 'usage') {
      const usage = usageFromBrightsy(obj.usage as BrightsyUsage | undefined);
      return usage ? { type: 'usage', data: usage } : null;
    }
    if (obj.type === 'tool_use') {
      const id =
        (typeof obj.id === 'string' && obj.id) || `brightsy-tool-${Date.now()}`;
      const name =
        (typeof obj.name === 'string' && obj.name) || 'brightsy_tool';
      const input =
        obj.input && typeof obj.input === 'object' && !Array.isArray(obj.input)
          ? (obj.input as Record<string, unknown>)
          : undefined;
      return { type: 'tool_use', id, name, input };
    }
    if (obj.type === 'tool_result' || obj.type === 'tool') {
      const id =
        (typeof obj.id === 'string' && obj.id) ||
        (typeof obj.tool_call_id === 'string' && obj.tool_call_id) ||
        `brightsy-tool-${Date.now()}`;
      const content =
        typeof obj.content === 'string'
          ? obj.content
          : obj.content != null
            ? JSON.stringify(obj.content)
            : undefined;
      return {
        type: 'tool_result',
        id,
        content,
        isError: obj.isError === true,
      };
    }
    if (obj.type === 'done') return null;
    if (
      typeof obj.type === 'string' &&
      ['tool_use', 'tool_result', 'tool', 'thinking', 'usage', 'error', 'done', 'text'].includes(
        obj.type,
      )
    ) {
      return null;
    }
    return { type: 'stdout', data: trimmed };
  } catch {
    if (
      trimmed.startsWith('{') &&
      /"type"\s*:\s*"(tool_use|tool_result|tool|text|thinking|usage|done|error)"/.test(trimmed)
    ) {
      return null;
    }
    if (/error|failed|unauthorized|quota|limit|not logged in/i.test(trimmed)) {
      return [
        { type: 'stderr', data: trimmed },
        { type: 'stdout', data: `Error: ${trimmed}` },
      ] satisfies AgentEvent[];
    }
    return { type: 'stdout', data: line };
  }
}

async function fetchTeamChatTargets(
  team: ConnectedBrightsyTeam,
): Promise<BrightsyTeamTargets> {
  const endpoint = (team.endpoint || 'https://brightsy.ai').replace(/\/$/, '');
  let agents: BrightsyChatTarget[] = [
    {
      type: 'agent',
      id: 'default',
      name: 'Default Agent',
      description: 'Account default agent (tools + memory)',
      accountId: team.id,
      accountSlug: team.slug,
      accountName: team.name,
    },
  ];
  let models: BrightsyChatTarget[] = [];

  try {
    const res = await fetch(`${endpoint}/api/v1beta/${team.id}/agents`, {
      headers: { Authorization: `Bearer ${team.access_token}` },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{
          id?: string;
          name?: string;
          description?: string | null;
        }>;
        models?: Array<{
          id?: string;
          name?: string;
          description?: string | null;
        }>;
      };
      const listed = (json.data || [])
        .filter((a): a is { id: string; name: string; description?: string | null } =>
          Boolean(a?.id && a?.name),
        )
        .filter((a) => a.id !== 'default')
        .map((a) => ({
          type: 'agent' as const,
          id: a.id,
          name: a.name,
          description: a.description,
          accountId: team.id,
          accountSlug: team.slug,
          accountName: team.name,
        }));
      agents = [...agents, ...listed];
      if (Array.isArray(json.models)) {
        models = json.models
          .filter((m): m is { id: string; name: string; description?: string | null } =>
            Boolean(m?.id && m?.name),
          )
          .slice(0, 12)
          .map((m) => ({
            type: 'model' as const,
            id: m.id,
            name: m.name,
            description: m.description,
            accountId: team.id,
            accountSlug: team.slug,
            accountName: team.name,
          }));
      }
    }
  } catch {
    // Team stays listed with at least Default Agent.
  }

  return {
    accountId: team.id,
    accountSlug: team.slug,
    accountName: team.name,
    agents,
    models,
  };
}

/** Fallback: single-team list via `brightsy chat --list-targets --json`. */
async function listBrightsyChatTargetsViaCli(): Promise<BrightsyChatTargets> {
  const listed = await run(
    resolveAgentExecutable('brightsy'),
    ['chat', '--list-targets', '--json'],
    {
      reject: false,
    },
  );
  if (listed.exitCode !== 0 || !listed.stdout.trim()) {
    throw new Error(
      listed.stderr.trim() ||
        'Failed to list Brightsy chat targets — is `brightsy` installed and logged in?',
    );
  }
  try {
    const parsed = JSON.parse(listed.stdout) as {
      agents?: BrightsyChatTarget[];
      models?: BrightsyChatTarget[];
    };
    let accountId: string | null = null;
    let accountSlug = 'team';
    let accountName = 'Brightsy';
    try {
      const cfg = loadBrightsyConfig();
      accountId = cfg.account_id;
      accountSlug = cfg.account_slug || accountSlug;
      accountName = cfg.account_slug || accountName;
    } catch {
      // ignore
    }
    const agents = (Array.isArray(parsed.agents) ? parsed.agents : []).map((a) => ({
      ...a,
      accountId: accountId ?? undefined,
      accountSlug,
      accountName,
    }));
    const models = (Array.isArray(parsed.models) ? parsed.models : []).map((m) => ({
      ...m,
      accountId: accountId ?? undefined,
      accountSlug,
      accountName,
    }));
    const teams: BrightsyTeamTargets[] = accountId
      ? [
          {
            accountId,
            accountSlug,
            accountName,
            agents,
            models,
          },
        ]
      : [];
    return { teams, agents, models, activeAccountId: accountId };
  } catch {
    throw new Error('Brightsy --list-targets returned invalid JSON');
  }
}

/**
 * Agents + models for each Sideboard-connected Brightsy team (composer picker).
 * Falls back to CLI list-targets when no teams are connected yet.
 */
export async function listBrightsyChatTargets(): Promise<BrightsyChatTargets> {
  ensureCliTeamTracked();
  const teamsRaw = await ensureConnectedBrightsyTeamTokens();
  if (teamsRaw.length === 0) {
    return listBrightsyChatTargetsViaCli();
  }

  let activeAccountId: string | null = null;
  try {
    activeAccountId = loadBrightsyConfig().account_id;
  } catch {
    activeAccountId = teamsRaw[0]?.id ?? null;
  }

  const teams = await Promise.all(teamsRaw.map((t) => fetchTeamChatTargets(t)));
  // Prefer active CLI team first in the picker.
  teams.sort((a, b) => {
    if (a.accountId === activeAccountId) return -1;
    if (b.accountId === activeAccountId) return 1;
    return a.accountSlug.localeCompare(b.accountSlug);
  });
  const active =
    teams.find((t) => t.accountId === activeAccountId) ?? teams[0] ?? null;
  return {
    teams,
    agents: active?.agents ?? [],
    models: active?.models ?? [],
    activeAccountId,
  };
}

/** Ensure ~/.brightsy matches the team encoded on the thread target before CLI chat. */
async function syncCliForTarget(accountId: string | undefined): Promise<void> {
  if (!accountId) return;
  const teams = await ensureConnectedBrightsyTeamTokens();
  const team = teams.find((t) => t.id === accountId);
  if (!team) return;
  try {
    const cfg = loadBrightsyConfig();
    if (cfg.account_id === team.id && cfg.access_token === team.access_token) {
      return;
    }
  } catch {
    // apply below
  }
  applyConnectedTeamToCli(team);
}

/**
 * Brightsy hosted-agent adapter. `brightsy chat --json` emits NDJSON events
 * (text deltas, tool output, usage, error, done); the message is piped on
 * stdin. The CLI has no session resume (`chat` is a stateless completion), so
 * resolveSessionId always returns null and Sideboard seeds each turn from the
 * last `summarize_context` tool through the current turn. Brightsy agents run
 * server-side — they converse about the worktree but never edit local files.
 * All Brightsy agents/models use OpenRouter chat-completions syntax; the CLI
 * owns that wire format.
 *
 * Thread.model encodes the chat target as `agent:<id>` or `model:<id>`
 * (null → Default Agent).
 */
export const brightsyAdapter: AgentAdapter = {
  kind: 'brightsy',

  async detect(): Promise<AgentStatus> {
    const brightsy = resolveAgentExecutable('brightsy');
    if (brightsy !== 'brightsy') {
      if (!existsSync(brightsy)) {
        return {
          agent: 'brightsy',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: `Brightsy executable not found: ${brightsy}`,
        };
      }
    } else {
      const which = await run('which', ['brightsy'], { reject: false });
      if (which.exitCode !== 0) {
        return {
          agent: 'brightsy',
          installed: false,
          authenticated: false,
          linearMcp: false,
          warnings: [],
          reason: 'brightsy CLI not found on PATH — npm i -g @brightsy/cli',
        };
      }
    }

    // `brightsy whoami` exits 0 either way; the logged-in banner is the signal.
    const who = await run(brightsy, ['whoami'], { reject: false });
    const authenticated = who.exitCode === 0 && /logged in as/i.test(who.stdout);
    return {
      agent: 'brightsy',
      installed: true,
      authenticated,
      linearMcp: false,
      warnings: [],
      reason: authenticated ? undefined : 'not logged in — run `brightsy login`',
    };
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    const prompt = flattenTurnInput(input);
    const target = decodeBrightsyTarget(thread.model);
    await syncCliForTarget(target.accountId);
    // Direct model completions are more reliable in `ask` mode — `agent` mode
    // can return Brightsy's empty-completion fallback ("I did not receive a
    // valid model response…") for some providers (e.g. Gemini).
    const mode = thread.planMode ? 'plan' : target.type === 'model' ? 'ask' : 'agent';
    const args = [
      'chat',
      '--json',
      '--mode',
      mode,
      target.type === 'model' ? '--model' : '--agent',
      target.id,
    ];
    return {
      file: resolveAgentExecutable('brightsy'),
      args,
      cwd: thread.worktreePath,
      // Piped stdin becomes the message body (avoids ARG_MAX for long seeds).
      stdin: prompt,
    };
  },

  parseEvent(line: string): AgentEvent | AgentEvent[] | null {
    return parseBrightsyCliLine(line);
  },

  async resolveSessionId(): Promise<string | null> {
    // No CLI session resume — Sideboard seeds each turn from thread history.
    return null;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const target = decodeBrightsyTarget(thread.model);
    await syncCliForTarget(target.accountId);
    const args =
      target.type === 'model'
        ? ['chat', '--model', target.id]
        : ['chat', '--agent', target.id];
    return {
      file: resolveAgentExecutable('brightsy'),
      args,
      cwd: thread.worktreePath,
    };
  },
};
