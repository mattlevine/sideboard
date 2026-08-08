import type { AgentEvent, MessagePart } from '../types/thread.js';

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export function toolDetail(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const command = str(input.command) ?? str(input.cmd);
  if (command) return command;
  const path =
    str(input.file_path) ?? str(input.path) ?? str(input.filePath) ?? str(input.filename);
  if (path) return path;
  const pattern = str(input.pattern) ?? str(input.glob) ?? str(input.glob_pattern);
  if (pattern) return pattern;
  const query = str(input.query) ?? str(input.prompt);
  if (query) return query.length > 80 ? `${query.slice(0, 77)}…` : query;
  try {
    const raw = JSON.stringify(input);
    return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
  } catch {
    return name;
  }
}

export function toolDescription(name: string, input?: Record<string, unknown>): string {
  const n = name.replace(/^mcp__/, '').replace(/__/g, ' · ');
  // Brightsy / OpenRouter function names (camelCase or snake_case).
  if (/^get_record_types$|recordTypes/i.test(name)) return 'List record types';
  if (/connectedAgentRequest/i.test(name)) {
    return str(input?.agent_id) ? `Ask connected agent` : 'Ask connected agent';
  }
  if (/present_artifact$/i.test(name)) {
    return str(input?.title) ? `Present ${str(input?.title)}` : 'Present artifact';
  }
  if (/^(create|update)_artifact$/i.test(name.replace(/^mcp__[^_]+__/, ''))) {
    return str(input?.title) ? `Artifact ${str(input?.title)}` : 'Artifact';
  }
  if (!input) return n;
  if (/bash|shell|terminal/i.test(name) && str(input.command)) {
    const cmd = str(input.command)!;
    if (/git\s+fetch/i.test(cmd)) return 'Fetch latest from origin and check status';
    if (/git\s+status/i.test(cmd)) return 'Check git status';
    if (/git\s+log/i.test(cmd)) return 'Inspect recent commits';
    if (/git\s+branch/i.test(cmd)) return 'List branches';
    if (/grep|rg\b/i.test(cmd)) return 'Search repository';
    return 'Run shell command';
  }
  if (/edit|write|apply/i.test(name)) {
    const path = str(input.file_path) ?? str(input.path);
    return path ? `Edit ${path.split('/').pop()}` : 'Edit file';
  }
  if (/read/i.test(name)) {
    const path = str(input.file_path) ?? str(input.path);
    return path ? `Read ${path.split('/').pop()}` : 'Read file';
  }
  if (/grep/i.test(name)) return 'Search files';
  if (/glob/i.test(name)) return 'Find files';
  return n;
}

export function toolFilePath(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  return str(input.file_path) ?? str(input.path) ?? str(input.filePath) ?? str(input.filename);
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function diffFromInput(input?: Record<string, unknown>): {
  additions?: number;
  deletions?: number;
} {
  if (!input) return {};
  const oldS = str(input.old_string) ?? str(input.oldString);
  const newS = str(input.new_string) ?? str(input.newString) ?? str(input.content);
  if (oldS != null || newS != null) {
    return {
      additions: countLines(newS),
      deletions: countLines(oldS),
    };
  }
  return {};
}

function parseDiffStat(result: string | undefined): {
  additions?: number;
  deletions?: number;
} {
  if (!result) return {};
  const plus = result.match(/\+(\d+)/);
  const minus = result.match(/-(\d+)/);
  if (plus || minus) {
    return {
      additions: plus ? Number(plus[1]) : undefined,
      deletions: minus ? Number(minus[1]) : undefined,
    };
  }
  return {};
}

/** Apply a structured agent event onto an accumulated parts list. */
export function applyAgentEvent(parts: MessagePart[], event: AgentEvent): MessagePart[] {
  if (event.type === 'stdout') {
    const data = event.data;
    if (!data) return parts;
    const next = [...parts];
    const last = next[next.length - 1];
    if (last?.type === 'text') {
      next[next.length - 1] = { type: 'text', text: last.text + data };
    } else {
      next.push({ type: 'text', text: data });
    }
    return next;
  }

  if (event.type === 'thinking') {
    const data = event.data;
    if (!data) return parts;
    const next = [...parts];
    const last = next[next.length - 1];
    if (last?.type === 'thinking') {
      next[next.length - 1] = { type: 'thinking', text: last.text + data };
    } else {
      next.push({ type: 'thinking', text: data });
    }
    return next;
  }

  if (event.type === 'tool_use') {
    const input = asRecord(event.input);
    const diff = diffFromInput(input);
    const existing = parts.findIndex((p) => p.type === 'tool' && p.id === event.id);
    if (existing >= 0) {
      const prev = parts[existing] as Extract<MessagePart, { type: 'tool' }>;
      const next = [...parts];
      next[existing] = {
        ...prev,
        name: event.name || prev.name,
        input: input ?? prev.input,
        description: toolDescription(event.name || prev.name, input ?? prev.input),
        detail: toolDetail(event.name || prev.name, input ?? prev.input) ?? prev.detail,
        filePath: toolFilePath(input) ?? prev.filePath,
        additions: diff.additions ?? prev.additions,
        deletions: diff.deletions ?? prev.deletions,
      };
      return next;
    }
    return [
      ...parts,
      {
        type: 'tool',
        id: event.id,
        name: event.name,
        input,
        description: toolDescription(event.name, input),
        detail: toolDetail(event.name, input),
        status: 'running',
        filePath: toolFilePath(input),
        ...diff,
      },
    ];
  }

  if (event.type === 'tool_result') {
    const next = parts.map((p) => {
      if (p.type !== 'tool' || p.id !== event.id) return p;
      const fromResult = parseDiffStat(event.content);
      return {
        ...p,
        status: event.isError ? ('error' as const) : ('done' as const),
        result: event.content,
        additions: fromResult.additions ?? p.additions,
        deletions: fromResult.deletions ?? p.deletions,
      };
    });
    return next;
  }

  return parts;
}

export function partsToAssistantText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim();
}

/**
 * Strip Brightsy CLI NDJSON control events that accidentally landed in transcript
 * text (`tool_use` / `tool_result` / …). Matches one or more concatenated objects.
 */
export function stripBrightsyNdjsonNoise(text: string): string {
  if (!text || !text.includes('"type"')) return text;
  let out = text;
  // Concatenated or spaced NDJSON blobs at the start / middle of the answer.
  out = out.replace(
    /\{"type":"(?:tool_use|tool_result|tool|thinking|usage|done|error)"[\s\S]*?\}\s*(?=\{"type":"|$|(?=[A-Za-z*#]))/g,
    '',
  );
  // Trailing incomplete tool_result dumps (very large content cut mid-JSON).
  out = out.replace(/\{"type":"(?:tool_use|tool_result|tool)"[\s\S]*$/g, '');
  return out.trim();
}

/** True when a stdout line is Brightsy CLI NDJSON (should never be answer text). */
export function isBrightsyNdjsonLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('{')) return false;
  return /"type"\s*:\s*"(tool_use|tool_result|tool|thinking|usage|done|error|text)"/.test(t);
}

export function finalizeParts(parts: MessagePart[]): MessagePart[] {
  return parts.map((p) =>
    p.type === 'tool' && p.status === 'running' ? { ...p, status: 'done' as const } : p,
  );
}

export function normalizeParseResult(
  parsed: AgentEvent | AgentEvent[] | null,
): AgentEvent[] {
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
