import { scriptDisplayName } from './run-script-icons';

/**
 * Menu row label. A running script says Stop so the row is the way to stop it.
 * Extra Stop buttons are not pinned in the tab row — they cover Setup / Run / Terminal.
 */
export function runMenuActionLabel(name: string, running: boolean): string {
  const label = scriptDisplayName(name);
  return running ? `Stop ${label}` : label;
}
