import { scriptDisplayName } from './run-script-icons';

/**
 * Live scripts that need their own Stop button.
 * The main Dev control already stops the default script while that script is running.
 * Every other live script — a second service, or the only live service when it is
 * not the default — is otherwise unlabeled, so it gets its own Stop control.
 */
export function scriptsNeedingStopButton(
  activeScriptNames: readonly string[],
  primaryScriptName: string | null,
  primaryRunning: boolean,
): string[] {
  const covered = primaryRunning ? primaryScriptName : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of activeScriptNames) {
    if (!name || name === covered || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Menu row label. A running script says Stop so the row is an action, not a status. */
export function runMenuActionLabel(name: string, running: boolean): string {
  const label = scriptDisplayName(name);
  return running ? `Stop ${label}` : label;
}
