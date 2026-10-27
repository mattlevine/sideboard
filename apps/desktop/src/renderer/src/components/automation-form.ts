import type {
  Autonomy,
  ScheduledTask,
  ScheduleWhen,
  ThinkingEffort,
  ThreadAttachment,
} from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';

type OrchestratorAgent = (typeof ORCHESTRATOR_AGENT_KINDS)[number];
import type { ThreadDefaults } from '../lib/thread-defaults';

export type CadenceKind = ScheduleWhen['kind'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultOnceLocal(): string {
  return toDatetimeLocal(new Date(Date.now() + 60 * 60_000).toISOString());
}

export interface FormState {
  name: string;
  prompt: string;
  kind: CadenceKind;
  atLocal: string;
  every: string;
  cron: string;
  tz: string;
  threadId: string;
  agent: OrchestratorAgent;
  model: string | null;
  effort: ThinkingEffort;
  fast: boolean;
  planMode: boolean;
  autonomy: Autonomy;
  attachments: ThreadAttachment[];
  enabled: boolean;
}

const FALLBACK_DEFAULTS: ThreadDefaults = {
  agent: 'claude',
  model: null,
  effort: 'high',
  fast: false,
  autonomy: 'full',
};

export function orchestratorAgent(agent: string | null | undefined): OrchestratorAgent {
  return (ORCHESTRATOR_AGENT_KINDS as readonly string[]).includes(agent ?? '')
    ? (agent as OrchestratorAgent)
    : 'claude';
}

function composerFrom(
  defaults: ThreadDefaults,
  row?: ScheduledTask,
): Pick<
  FormState,
  'agent' | 'model' | 'effort' | 'fast' | 'planMode' | 'autonomy' | 'attachments'
> {
  return {
    agent: orchestratorAgent(row?.agent ?? defaults.agent),
    model: row ? row.model : defaults.model,
    effort: row?.effort ?? defaults.effort,
    fast: row?.fast ?? defaults.fast,
    planMode: row?.planMode ?? false,
    autonomy: row?.autonomy ?? defaults.autonomy,
    attachments: row?.attachments ?? [],
  };
}

export function emptyForm(defaults: ThreadDefaults = FALLBACK_DEFAULTS): FormState {
  return {
    name: '',
    prompt: '',
    kind: 'every',
    atLocal: defaultOnceLocal(),
    every: '1h',
    cron: '0 9 * * *',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    threadId: '',
    enabled: true,
    ...composerFrom(defaults),
  };
}

export function formFromTask(row: ScheduledTask, defaults: ThreadDefaults): FormState {
  return {
    name: row.name,
    prompt: row.prompt,
    kind: row.when.kind,
    atLocal: row.when.kind === 'once' ? toDatetimeLocal(row.when.at) : defaultOnceLocal(),
    every: row.when.kind === 'every' ? row.when.every : '1h',
    cron: row.when.kind === 'cron' ? row.when.expr : '0 9 * * *',
    tz:
      row.when.kind === 'cron' && row.when.tz
        ? row.when.tz
        : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    threadId: row.threadId ?? '',
    enabled: row.enabled,
    ...composerFrom(defaults, row),
  };
}

export function whenFromForm(form: FormState): ScheduleWhen {
  if (form.kind === 'once') {
    const at = new Date(form.atLocal);
    if (Number.isNaN(at.getTime())) throw new Error('Pick a valid date and time');
    return { kind: 'once', at: at.toISOString() };
  }
  if (form.kind === 'every') return { kind: 'every', every: form.every };
  return { kind: 'cron', expr: form.cron.trim(), tz: form.tz.trim() || undefined };
}
