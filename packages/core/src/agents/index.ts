import type { AgentKind } from '../types/thread.js';
import { brightsyAdapter } from './brightsy.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { opencodeAdapter } from './opencode.js';
import type { AgentAdapter } from './types.js';

export * from './types.js';
export {
  brightsyAdapter,
  listBrightsyChatTargets,
} from './brightsy.js';
export {
  decodeBrightsyTarget,
  encodeBrightsyTarget,
} from './brightsy-targets.js';
export type {
  BrightsyChatTarget,
  BrightsyChatTargets,
  BrightsyTeamTargets,
} from './brightsy-targets.js';
export { claudeAdapter } from './claude.js';
export { codexAdapter } from './codex.js';
export { cursorAdapter } from './cursor.js';
export {
  cursorSdkMessageToEvents,
  parseCursorRunnerLine,
} from './cursor-events.js';
export type { CursorSdkStreamMessage, CursorTurnRequest } from './cursor-events.js';
export { opencodeAdapter } from './opencode.js';
export { ensureAgentPath } from './path.js';

const adapters: Record<AgentKind, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  brightsy: brightsyAdapter,
  cursor: cursorAdapter,
};

export function getAdapter(kind: AgentKind): AgentAdapter {
  return adapters[kind];
}

export function allAdapters(): AgentAdapter[] {
  return Object.values(adapters);
}
