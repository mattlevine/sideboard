import type { AgentKind } from '@sideboard-ai/core';

/** Account defaults for Create / new chat tabs (Settings → Account). */
export async function loadThreadDefaults(): Promise<{
  agent: AgentKind;
  model: string | null;
}> {
  try {
    const settings = await window.sideboard.getAppSettings();
    return {
      agent: settings.defaults?.agent ?? 'claude',
      model: settings.defaults?.model?.trim() || null,
    };
  } catch {
    return { agent: 'claude', model: null };
  }
}
