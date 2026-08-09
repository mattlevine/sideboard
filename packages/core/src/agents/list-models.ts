import type { AgentKind } from '../types/thread.js';
import { listBrightsyChatTargets } from './brightsy.js';
import { encodeBrightsyTarget } from './brightsy-targets.js';
import { listCodexModels } from './codex.js';
import { listCursorModels } from './cursor.js';
import type { AgentModelInfo } from './model-info.js';
import { listOpencodeModels } from './opencode.js';

/** Claude Code aliases used by Sideboard (null = Auto / CLI default). */
export const CLAUDE_MODEL_CATALOG: AgentModelInfo[] = [
  { id: 'fable', displayName: 'Fable' },
  { id: 'opus', displayName: 'Opus' },
  { id: 'sonnet', displayName: 'Sonnet' },
  { id: 'haiku', displayName: 'Haiku' },
];

export type AgentModelCatalog = {
  agent: AgentKind;
  /** Omit / null model = Auto (provider default). Cursor uses id `default`. */
  auto: true;
  models: AgentModelInfo[];
  note?: string;
};

async function listBrightsyModels(): Promise<AgentModelInfo[]> {
  try {
    const targets = await listBrightsyChatTargets();
    const accountId = targets.activeAccountId;
    const models = (targets.models ?? []).map((m) => ({
      id: encodeBrightsyTarget('model', m.id, accountId),
      displayName: m.name || m.id,
      description: m.description ?? undefined,
    }));
    const agents = (targets.agents ?? []).map((a) => ({
      id: encodeBrightsyTarget('agent', a.id, accountId),
      displayName: a.name || a.id,
      description: a.description ?? 'Brightsy agent target',
    }));
    return [...models, ...agents].slice(0, 80);
  } catch {
    return [];
  }
}

/** Models available for one agent (or all when agent omitted). */
export async function listModelsForAgent(
  agent?: AgentKind,
): Promise<AgentModelCatalog[]> {
  const kinds: AgentKind[] = agent
    ? [agent]
    : ['claude', 'codex', 'opencode', 'cursor', 'brightsy'];

  const out: AgentModelCatalog[] = [];
  for (const kind of kinds) {
    if (kind === 'claude') {
      out.push({
        agent: kind,
        auto: true,
        models: CLAUDE_MODEL_CATALOG,
        note: 'Default Auto — only pass a model id when you have a reason.',
      });
      continue;
    }
    if (kind === 'codex') {
      out.push({
        agent: kind,
        auto: true,
        models: await listCodexModels(),
        note: 'Default Auto — only pass a model slug when you have a reason.',
      });
      continue;
    }
    if (kind === 'opencode') {
      out.push({
        agent: kind,
        auto: true,
        models: await listOpencodeModels(),
        note: 'Default Auto — only pass a provider/model id when you have a reason.',
      });
      continue;
    }
    if (kind === 'cursor') {
      out.push({
        agent: kind,
        auto: true,
        models: await listCursorModels(),
        note: 'Default Auto — only pass a model id when you have a reason (or use "default").',
      });
      continue;
    }
    if (kind === 'brightsy') {
      const models = await listBrightsyModels();
      out.push({
        agent: kind,
        auto: true,
        models,
        note: models.length
          ? 'Default Auto / Default agent — only pass a model/agent id when you have a reason.'
          : 'Brightsy not logged in or no targets — leave model unset for Default.',
      });
    }
  }
  return out;
}
