import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Per-worktree sticky Dev ports (gitignored scratch). */
export const RUN_PORTS_REL = '.context/.sideboard/run-ports.json';

type RunPortsFile = {
  scripts?: Record<string, number[]>;
};

export function worktreeRunPortsPath(worktreePath: string): string {
  return join(worktreePath, RUN_PORTS_REL);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

function parseFile(raw: string): RunPortsFile {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const scripts = (parsed as RunPortsFile).scripts;
    if (!scripts || typeof scripts !== 'object') return {};
    const next: Record<string, number[]> = {};
    for (const [name, ports] of Object.entries(scripts)) {
      if (!name || !Array.isArray(ports)) continue;
      const cleaned = ports.filter(isPort);
      if (cleaned.length) next[name] = cleaned;
    }
    return { scripts: next };
  } catch {
    return {};
  }
}

export function loadWorktreeRunPorts(
  worktreePath: string,
  scriptName: string,
): number[] | null {
  if (!worktreePath.trim() || !scriptName.trim()) return null;
  try {
    const raw = readFileSync(worktreeRunPortsPath(worktreePath), 'utf8');
    const ports = parseFile(raw).scripts?.[scriptName];
    return ports?.length ? ports : null;
  } catch {
    return null;
  }
}

export function saveWorktreeRunPorts(
  worktreePath: string,
  scriptName: string,
  ports: number[],
): void {
  if (!worktreePath.trim() || !scriptName.trim()) return;
  const cleaned = ports.filter(isPort);
  if (!cleaned.length) return;
  const path = worktreeRunPortsPath(worktreePath);
  let current: RunPortsFile = {};
  try {
    current = parseFile(readFileSync(path, 'utf8'));
  } catch {
    current = {};
  }
  const scripts = { ...(current.scripts ?? {}) };
  scripts[scriptName] = cleaned;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ scripts }, null, 2)}\n`, 'utf8');
}
