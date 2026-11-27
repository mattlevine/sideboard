import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from './paths.js';
import { writePrivateFile } from './private-file.js';

export interface TicketAssignSnapshot {
  primed: boolean;
  keys: string[];
}

export function ticketAssignSnapshotPath(): string {
  return join(appDataDir(), 'ticket-assign-watch.json');
}

export function emptyTicketAssignSnapshot(): TicketAssignSnapshot {
  return { primed: false, keys: [] };
}

export function loadTicketAssignSnapshot(): TicketAssignSnapshot {
  try {
    const path = ticketAssignSnapshotPath();
    if (!existsSync(path)) return emptyTicketAssignSnapshot();
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { primed?: unknown; keys?: unknown };
    const keys: string[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.keys)) {
      for (const item of raw.keys) {
        const key = typeof item === 'string' ? item.trim() : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }
    return { primed: raw.primed === true, keys };
  } catch {
    return emptyTicketAssignSnapshot();
  }
}

export function saveTicketAssignSnapshot(snapshot: TicketAssignSnapshot): void {
  const keys = [...new Set(snapshot.keys.map((key) => key.trim()).filter(Boolean))].sort();
  writePrivateFile(
    ticketAssignSnapshotPath(),
    `${JSON.stringify({ primed: snapshot.primed === true, keys }, null, 2)}\n`,
  );
}

/** The next poll only records assignments. Used when the switch turns off. */
export function markTicketAssignNeedsBaseline(): void {
  const loaded = loadTicketAssignSnapshot();
  if (!loaded.primed) return;
  saveTicketAssignSnapshot({ primed: false, keys: loaded.keys });
}
