import { run } from '../git/run.js';
import { ensureAgentPath } from '../agents/path.js';

const MAX_TRANSCRIPT_CHARS = 120_000;
const MAX_SUMMARY_CHARS = 6_000;

export interface SummarizeResult {
  summary: string;
  method: 'claude' | 'extractive';
}

/**
 * Summarize a conversation transcript for agent continuity.
 * Prefers a fast Claude one-shot; falls back to extractive bullets.
 */
export async function summarizeConversation(
  transcript: string,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<SummarizeResult> {
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[…truncated…]`
      : transcript;

  const claudeSummary = await tryClaudeSummary(clipped, opts);
  if (claudeSummary) {
    return { summary: clipSummary(claudeSummary), method: 'claude' };
  }
  return { summary: clipSummary(extractiveSummary(clipped)), method: 'extractive' };
}

async function tryClaudeSummary(
  transcript: string,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<string | null> {
  ensureAgentPath();
  const prompt = [
    'Summarize this coding-agent conversation for continuity in a fresh session.',
    'Use concise markdown bullets covering:',
    '- Goal / request',
    '- Key decisions and constraints',
    '- Files / areas touched',
    '- Current state and open tasks',
    '- Anything the next turn must remember',
    'Do not invent details. No preamble.',
    '',
    'Transcript:',
    transcript,
  ].join('\n');

  try {
    const { stdout, exitCode } = await run(
      'claude',
      [
        '-p',
        prompt,
        '--output-format',
        'text',
        '--permission-mode',
        'bypassPermissions',
        '--model',
        'haiku',
      ],
      { cwd: opts?.cwd, reject: false },
    );
    if (exitCode !== 0) return null;
    const text = stdout.trim();
    if (text.length < 40) return null;
    return text;
  } catch {
    return null;
  }
}

/** Deterministic fallback when Claude isn't available. */
export function extractiveSummary(transcript: string): string {
  const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);
  const users: string[] = [];
  const tools: string[] = [];
  const agents: string[] = [];

  let mode: 'none' | 'user' | 'agent' = 'none';
  for (const line of lines) {
    if (line.startsWith('### User')) {
      mode = 'user';
      continue;
    }
    if (line.startsWith('### Agent') || line.startsWith('## Prior')) {
      mode = 'agent';
      continue;
    }
    if (line.startsWith('- ') && line.includes(':')) {
      tools.push(line.replace(/^- /, ''));
      continue;
    }
    if (mode === 'user' && users.length < 8) {
      users.push(line.slice(0, 240));
    } else if (mode === 'agent' && agents.length < 6) {
      agents.push(line.slice(0, 240));
    }
  }

  const uniqueTools = [...new Set(tools)].slice(0, 20);
  const parts = [
    '## Compacted context (extractive)',
    '',
    '### User goals',
    ...(users.length ? users.map((u) => `- ${u}`) : ['- (none captured)']),
    '',
    '### Recent agent notes',
    ...(agents.length ? agents.map((a) => `- ${a}`) : ['- (none captured)']),
  ];
  if (uniqueTools.length) {
    parts.push('', '### Tools / files', ...uniqueTools.map((t) => `- ${t}`));
  }
  parts.push(
    '',
    '_Automatic extractive summary — Claude summarizer was unavailable._',
  );
  return parts.join('\n');
}

function clipSummary(text: string): string {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_CHARS)}\n\n[…summary truncated…]`;
}
