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
  if (/present_plan$/i.test(name)) {
    return str(input?.title) ? `Plan ${str(input?.title)}` : 'Present plan';
  }
  if (/present_schema$/i.test(name)) {
    return str(input?.title) ? `Schema ${str(input?.title)}` : 'Present schema';
  }
  if (/present_files$/i.test(name)) {
    return str(input?.title) ? `Files ${str(input?.title)}` : 'Present files';
  }
  if (isSubagentToolName(name)) {
    const desc = str(input?.description);
    const sub = asRecord(input?.subagentType);
    const kind =
      str(sub?.name) ?? str(sub?.kind) ?? str(input?.subagent_type) ?? str(input?.subagentType);
    if (/^spawn_agent$/i.test(name)) {
      return str(input?.prompt) ?? desc ?? 'Subagent';
    }
    if (/connectedAgentRequest/i.test(name)) {
      return str(input?.agent_id) ? `Ask connected agent` : 'Ask connected agent';
    }
    if (desc && kind) return `${kind}: ${desc}${subagentLiveSuffix(input)}`;
    if (desc) return `${desc}${subagentLiveSuffix(input)}`;
    return `Subagent${subagentLiveSuffix(input)}`;
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
  const compact = n.replace(/[_-]/g, '');
  if (/^taskoutput$/i.test(compact)) {
    return str(input.task_id) ? `Wait for ${str(input.task_id)}` : 'Wait for background task';
  }
  if (/^taskstop$/i.test(compact)) {
    return str(input.task_id) ? `Stop ${str(input.task_id)}` : 'Stop background task';
  }
  if (/^monitor$/i.test(compact)) {
    const command = str(input.command);
    return command
      ? `Watch ${command.length > 48 ? `${command.slice(0, 45)}…` : command}`
      : 'Watch command';
  }
  return n;
}

function subagentLiveSuffix(input?: Record<string, unknown>): string {
  if (!input) return '';
  const bits: string[] = [];
  const status = str(input.live_status);
  if (status && !/^runn(ing)?$|^working$/i.test(status)) bits.push(status);
  if (typeof input.live_tool_uses === 'number') bits.push(`${input.live_tool_uses} tools`);
  if (typeof input.live_duration_ms === 'number') {
    bits.push(`${Math.max(0, Math.round(Number(input.live_duration_ms) / 1000))}s`);
  }
  const last = str(input.live_last_tool);
  if (last) bits.push(last);
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

export function isSubagentToolName(name: string | undefined): boolean {
  const n = (name ?? '').trim();
  if (/^(task|agent|spawn_agent)$/i.test(n)) return true;
  return /connectedAgentRequest/i.test(n);
}

/** Bash/Agent poll wrappers — not the interesting work the user wants to see. */
export function isPollWrapperToolName(name: string | undefined): boolean {
  const n = (name ?? '').replace(/[_-]/g, '');
  return /^(taskoutput|taskstop|sleep)$/i.test(n);
}

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

function lastTextPart(parts: MessagePart[], type: 'thinking' | 'text'): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === type && p.text.trim()) return p.text.trim();
  }
  return '';
}

function toolLabel(tool: ToolPart): string {
  return tool.description || toolDescription(tool.name, tool.input) || tool.name;
}

function fileBasename(path: string): string {
  const parts = path.replace(/\/$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function classifyTool(name: string): 'edit' | 'read' | 'search' | 'shell' | 'other' {
  const compact = name.replace(/^mcp__[^_]+__/, '').replace(/[_-]/g, '');
  if (/bash|shell|terminal|^zsh$|^sh$/i.test(compact)) return 'shell';
  if (/grep|glob|search|ripgrep|findfiles|semsearch/i.test(compact)) return 'search';
  if (/^(read|cat)$/i.test(compact) || /^read/i.test(compact)) return 'read';
  if (/edit|write|apply|strreplace|multiedit|updatefile|createfile/i.test(compact)) {
    return 'edit';
  }
  return 'other';
}

/**
 * Cursor-style footer for a finished (or in-flight) turn: “Edited foo.ts, 1 search, ran 2 commands”.
 */
export function toolActivityLine(parts: MessagePart[]): {
  text: string;
  additions: number;
  deletions: number;
} | null {
  const tools = parts.filter((p): p is ToolPart => {
    if (p.type !== 'tool' || p.parentId) return false;
    if (isPollWrapperToolName(p.name)) return false;
    if (/present_plan$/i.test(p.name ?? '')) return false;
    if (/ask_user|AskUserQuestion/i.test(p.name ?? '')) return false;
    return true;
  });
  if (tools.length === 0) return null;

  const edited: { name: string; running: boolean }[] = [];
  let reads = 0;
  let searches = 0;
  let shells = 0;
  let others = 0;
  let additions = 0;
  let deletions = 0;
  for (const tool of tools) {
    const kind = classifyTool(tool.name);
    if (kind === 'edit') {
      const path = tool.filePath ?? toolFilePath(tool.input);
      edited.push({
        name: path ? fileBasename(path) : tool.name,
        running: tool.status === 'running',
      });
    } else if (kind === 'read') reads += 1;
    else if (kind === 'search') searches += 1;
    else if (kind === 'shell') shells += 1;
    else others += 1;
    if (typeof tool.additions === 'number') additions += tool.additions;
    if (typeof tool.deletions === 'number') deletions += tool.deletions;
  }

  const bits: string[] = [];
  const editing = edited.filter((e) => e.running);
  const editedDone = edited.filter((e) => !e.running);
  if (editing.length === 1) bits.push(`Editing ${editing[0]!.name}`);
  else if (editing.length > 1) bits.push(`Editing ${editing.length} files`);
  if (editedDone.length === 1) bits.push(`${editing.length ? 'edited' : 'Edited'} ${editedDone[0]!.name}`);
  else if (editedDone.length > 1) {
    bits.push(`${editing.length ? 'edited' : 'Edited'} ${editedDone.length} files`);
  }
  if (reads === 1) bits.push('explored 1 file');
  else if (reads > 1) bits.push(`explored ${reads} files`);
  if (searches === 1) bits.push('1 search');
  else if (searches > 1) bits.push(`${searches} searches`);
  if (shells === 1) bits.push('ran 1 command');
  else if (shells > 1) bits.push(`ran ${shells} commands`);
  if (others === 1) bits.push('1 tool');
  else if (others > 1) bits.push(`${others} tools`);
  if (bits.length === 0) return null;
  return { text: bits.join(', '), additions, deletions };
}

/**
 * One-line snapshot of a live turn for MCP wait_for_turn.
 * Prefers running subagents and nested tools over TaskOutput poll wrappers.
 */
export function liveActivitySummary(
  parts: MessagePart[],
  opts?: { queued?: boolean },
): string {
  if (opts?.queued && parts.length === 0) {
    return 'Queued — waiting for a slot';
  }
  const tools = parts.filter((p): p is ToolPart => p.type === 'tool');
  const runningSubs = tools.filter(
    (t) => t.status === 'running' && !t.parentId && isSubagentToolName(t.name),
  );
  const runningNested = [...tools]
    .reverse()
    .find((t) => t.status === 'running' && t.parentId && !isPollWrapperToolName(t.name));
  const runningTop = [...tools]
    .reverse()
    .find(
      (t) =>
        t.status === 'running' &&
        !t.parentId &&
        !isPollWrapperToolName(t.name) &&
        !isSubagentToolName(t.name),
    );
  const runningPoll = [...tools]
    .reverse()
    .find((t) => t.status === 'running' && isPollWrapperToolName(t.name));
  const thinking = lastTextPart(parts, 'thinking');
  const text = lastTextPart(parts, 'text');

  if (runningSubs.length > 0) {
    const heads = runningSubs.map(toolLabel);
    const head =
      runningSubs.length === 1
        ? heads[0]!
        : `${runningSubs.length} subagents · ${heads.slice(0, 2).join(' · ')}`;
    if (runningNested) return `${head} · ${toolLabel(runningNested)}`;
    return head;
  }
  if (runningTop) return toolLabel(runningTop);
  if (runningPoll) return toolLabel(runningPoll);
  if (thinking) return thinking.length > 96 ? `…${thinking.slice(-96)}` : thinking;
  if (text) return 'Writing reply…';
  const last = [...tools].reverse().find((t) => !isPollWrapperToolName(t.name)) ?? tools.at(-1);
  if (last) {
    const label = toolLabel(last);
    return last.status === 'running' ? label : `Finished ${label}`;
  }
  return 'Working…';
}

export function messagePartParentId(part: MessagePart): string | undefined {
  if ('parentId' in part && typeof part.parentId === 'string' && part.parentId.trim()) {
    return part.parentId;
  }
  return undefined;
}

function sameParentId(a?: string, b?: string): boolean {
  return (a ?? '') === (b ?? '');
}

/** Attach a Cursor/Claude/Codex nested-stream parent without clobbering one already set. */
export function withEventParentId(event: AgentEvent, parentId?: string): AgentEvent {
  if (!parentId) return event;
  if (
    event.type === 'stdout' ||
    event.type === 'thinking' ||
    event.type === 'tool_use' ||
    event.type === 'tool_result'
  ) {
    return { ...event, parentId: event.parentId ?? parentId };
  }
  return event;
}

export function withEventsParentId(events: AgentEvent[], parentId?: string): AgentEvent[] {
  if (!parentId) return events;
  return events.map((event) => withEventParentId(event, parentId));
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
  // Only trust git-style stats ("+12 -3" / "12 insertions, 3 deletions").
  // Bare +N / -N matches almost any JSON (phones, ids, timestamps) and
  // wrongly paints MCP tool chips as file diffs.
  const paired = result.match(/\+(\d+)\s+-(\d+)/);
  if (paired) {
    return {
      additions: Number(paired[1]),
      deletions: Number(paired[2]),
    };
  }
  const verbose = result.match(
    /(\d+)\s+insertions?(?:,\s*(\d+)\s+deletions?)?/i,
  );
  if (verbose) {
    return {
      additions: Number(verbose[1]),
      deletions: verbose[2] != null ? Number(verbose[2]) : undefined,
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
    if (last?.type === 'text' && sameParentId(last.parentId, event.parentId)) {
      next[next.length - 1] = {
        type: 'text',
        text: last.text + data,
        ...(event.parentId ? { parentId: event.parentId } : {}),
      };
    } else {
      next.push({
        type: 'text',
        text: data,
        ...(event.parentId ? { parentId: event.parentId } : {}),
      });
    }
    return next;
  }

  if (event.type === 'thinking') {
    const data = event.data;
    if (!data) return parts;
    const next = [...parts];
    if (event.replace) {
      for (let i = next.length - 1; i >= 0; i--) {
        const prev = next[i];
        if (prev?.type === 'thinking' && sameParentId(prev.parentId, event.parentId)) {
          next[i] = {
            type: 'thinking',
            text: data,
            ...(event.parentId ? { parentId: event.parentId } : {}),
          };
          return next;
        }
      }
      next.push({
        type: 'thinking',
        text: data,
        ...(event.parentId ? { parentId: event.parentId } : {}),
      });
      return next;
    }
    const last = next[next.length - 1];
    if (last?.type === 'thinking' && sameParentId(last.parentId, event.parentId)) {
      next[next.length - 1] = {
        type: 'thinking',
        text: last.text + data,
        ...(event.parentId ? { parentId: event.parentId } : {}),
      };
    } else {
      next.push({
        type: 'thinking',
        text: data,
        ...(event.parentId ? { parentId: event.parentId } : {}),
      });
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
      const mergedInput = {
        ...(prev.input ?? {}),
        ...(input ?? {}),
      };
      const mergedRecord = Object.keys(mergedInput).length > 0 ? mergedInput : undefined;
      next[existing] = {
        ...prev,
        name: event.name || prev.name,
        input: mergedRecord,
        description: toolDescription(event.name || prev.name, mergedRecord),
        detail: toolDetail(event.name || prev.name, mergedRecord) ?? prev.detail,
        filePath: toolFilePath(mergedRecord) ?? prev.filePath,
        additions: diff.additions ?? prev.additions,
        deletions: diff.deletions ?? prev.deletions,
        parentId: event.parentId ?? prev.parentId,
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
        ...(event.parentId ? { parentId: event.parentId } : {}),
        ...diff,
      },
    ];
  }

  if (event.type === 'tool_result') {
    const existing = parts.findIndex((p) => p.type === 'tool' && p.id === event.id);
    const fromResult = parseDiffStat(event.content);
    if (existing < 0) {
      // Orphan result (e.g. Cursor completed without a prior running event).
      return [
        ...parts,
        {
          type: 'tool' as const,
          id: event.id,
          name: 'tool',
          description: 'tool',
          status: event.isError ? ('error' as const) : ('done' as const),
          result: event.content,
          ...(event.parentId ? { parentId: event.parentId } : {}),
          ...(fromResult.additions != null ? { additions: fromResult.additions } : {}),
          ...(fromResult.deletions != null ? { deletions: fromResult.deletions } : {}),
        },
      ];
    }
    return parts.map((p, i) => {
      if (i !== existing || p.type !== 'tool') return p;
      return {
        ...p,
        status: event.isError ? ('error' as const) : ('done' as const),
        result: event.content,
        ...(fromResult.additions != null ? { additions: fromResult.additions } : {}),
        ...(fromResult.deletions != null ? { deletions: fromResult.deletions } : {}),
      };
    });
  }

  return parts;
}

export function partsToAssistantText(parts: MessagePart[]): string {
  return parts
    .filter(
      (p): p is Extract<MessagePart, { type: 'text' }> =>
        p.type === 'text' && !messagePartParentId(p),
    )
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
