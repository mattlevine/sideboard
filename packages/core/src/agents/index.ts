import type { AgentKind } from '../types/thread.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import type { AgentAdapter } from './types.js';

export * from './types.js';
export { claudeAdapter } from './claude.js';
export { codexAdapter } from './codex.js';
export { opencodeAdapter } from './opencode.js';

const adapters: Record<AgentKind, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(kind: AgentKind): AgentAdapter {
  return adapters[kind];
}

export function allAdapters(): AgentAdapter[] {
  return Object.values(adapters);
}
