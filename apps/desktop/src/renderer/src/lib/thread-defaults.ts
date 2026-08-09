import type { AgentKind, ThinkingEffort } from '@sideboard-ai/core';
import { parseThinkingEffort } from '../components/ThinkingEffortChip';

/** Account defaults for Create / new chat tabs (Settings → Account). */
export async function loadThreadDefaults(): Promise<{
  agent: AgentKind;
  model: string | null;
  effort: ThinkingEffort;
}> {
  try {
    const settings = await window.sideboard.getAppSettings();
    return {
      agent: settings.defaults?.agent ?? 'claude',
      model: settings.defaults?.model?.trim() || null,
      effort: parseThinkingEffort(settings.defaults?.effort),
    };
  } catch {
    return { agent: 'claude', model: null, effort: 'high' };
  }
}
