import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';

/** JSONL files {@link JsonlLocalAgentStore} rewrites as a whole. */
const CATALOG_FILES = ['agents.ndjson', 'runs.ndjson', 'run_events.ndjson', 'checkpoints.ndjson'] as const;

type CatalogFile = (typeof CATALOG_FILES)[number];

const INTERRUPTED_TMP =
  /^\.(agents|runs|run_events|checkpoints)\.ndjson\.[0-9a-f]{16}\.tmp$/;

type Row = Record<string, unknown>;

export interface CursorCatalogRepair {
  repaired: boolean;
  notes: string[];
}

/**
 * Hold the thread catalog across the turn. The SDK lock is in-process only, so
 * two runners (a dying turn and the retry) otherwise last-write-wins and drop
 * the agent or its run.
 */
export async function acquireCursorCatalogLock(storeDir: string): Promise<() => Promise<void>> {
  mkdirSync(storeDir, { recursive: true });
  const lockPath = join(storeDir, '.catalog.lock');
  writeFileSync(lockPath, '', { flag: 'a' });
  try {
    return await lockfile.lock(lockPath, {
      retries: { retries: 40, minTimeout: 50, maxTimeout: 500 },
      // Repair rewrites run_events.ndjson synchronously while holding the lock.
      // A 5s stale window treats that stall as a dead owner and throws from a
      // timer, which kills the runner mid-turn.
      stale: 30_000,
      update: 10_000,
      onCompromised: (err) => {
        console.error(`[sideboard] cursor catalog lock compromised: ${err.message}`);
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[sideboard] cursor catalog lock not acquired (${message}); continuing without the lock`,
    );
    return async () => {};
  }
}

type CatalogNote = (line: string) => void;

let heldCatalogRelease: (() => Promise<void>) | undefined;

function publishRepair(repair: CursorCatalogRepair, note: CatalogNote): void {
  for (const line of repair.notes) note(line);
}

/** Lock the thread catalog, fold a torn write, then let the runner resume. */
export async function openCursorCatalogTurn(storeDir: string, note: CatalogNote): Promise<void> {
  mkdirSync(storeDir, { recursive: true });
  heldCatalogRelease = await acquireCursorCatalogLock(storeDir);
  publishRepair(repairCursorLocalCatalog(storeDir), note);
}

/** Repair again after resume/send reports a missing checkpoint. */
export function repairCursorCatalogForResume(storeDir: string, note: CatalogNote): boolean {
  const repair = repairCursorLocalCatalog(storeDir);
  publishRepair(repair, note);
  return repair.repaired;
}

export async function closeCursorCatalogTurn(): Promise<void> {
  const release = heldCatalogRelease;
  heldCatalogRelease = undefined;
  if (release) await release().catch(() => undefined);
}

/**
 * Put an interrupted JSONL rewrite back, then point the agent at a checkpoint
 * blob that is actually on disk. A killed runner can rename `agents.ndjson`
 * onto a `rootBlobId` whose `checkpoints.ndjson` line never landed.
 */
export function repairCursorLocalCatalog(storeDir: string): CursorCatalogRepair {
  if (!existsSync(storeDir)) return { repaired: false, notes: [] };
  const notes: string[] = [];
  let repaired = false;

  const loaded = new Map<CatalogFile, { main: Row[]; tmps: string[]; tmpRows: Row[] }>();
  for (const file of CATALOG_FILES) {
    loaded.set(file, loadCatalogFile(storeDir, file));
  }

  const checkpoints = mergeByKey(
    loaded.get('checkpoints.ndjson')!.main,
    loaded.get('checkpoints.ndjson')!.tmpRows,
    (row) => checkpointKey(row),
    (main) => main,
  );
  const blobs = checkpointBlobs(checkpoints.rows);
  const agents = mergeByKey(
    loaded.get('agents.ndjson')!.main,
    loaded.get('agents.ndjson')!.tmpRows,
    (row) => (typeof row.agentId === 'string' ? row.agentId : null),
    (main, extra) => preferAgent(main, extra, blobs),
  );
  const runs = mergeByKey(
    loaded.get('runs.ndjson')!.main,
    loaded.get('runs.ndjson')!.tmpRows,
    (row) => runKey(row),
    (main, extra) => (num(extra.updatedAt) >= num(main.updatedAt) ? extra : main),
  );
  const events = mergeByKey(
    loaded.get('run_events.ndjson')!.main,
    loaded.get('run_events.ndjson')!.tmpRows,
    (row) => eventKey(row),
    (main) => main,
  );

  const merged: Record<CatalogFile, Row[]> = {
    'checkpoints.ndjson': checkpoints.rows,
    'agents.ndjson': agents.rows,
    'runs.ndjson': runs.rows,
    'run_events.ndjson': events.rows,
  };

  for (const agent of merged['agents.ndjson']) {
    if (restoreAgentCheckpoint(agent, merged['runs.ndjson'], blobs, notes)) repaired = true;
    if (clearMissingActiveRun(agent, merged['runs.ndjson'], notes)) repaired = true;
  }

  for (const file of CATALOG_FILES) {
    const prior = loaded.get(file)!;
    const next = merged[file];
    const recovered = countNewKeys(prior.main, next, keyFor(file));
    if (recovered > 0) {
      notes.push(`Cursor catalog recovered ${recovered} ${file} row(s) from an interrupted write`);
      repaired = true;
    }
    if (!sameRows(prior.main, next)) {
      writeCatalogFile(join(storeDir, file), next);
      repaired = true;
    }
    for (const tmp of prior.tmps) {
      try {
        unlinkSync(tmp);
      } catch {
        /* already gone */
      }
    }
  }

  return { repaired, notes };
}

function loadCatalogFile(
  storeDir: string,
  file: CatalogFile,
): { main: Row[]; tmps: string[]; tmpRows: Row[] } {
  const tmps = interruptedTmps(storeDir, file);
  return {
    main: readRows(join(storeDir, file)),
    tmps,
    tmpRows: tmps.flatMap((tmp) => readRows(tmp)),
  };
}

function keyFor(file: CatalogFile): (row: Row) => string | null {
  if (file === 'checkpoints.ndjson') return checkpointKey;
  if (file === 'agents.ndjson') return (row) => (typeof row.agentId === 'string' ? row.agentId : null);
  if (file === 'runs.ndjson') return runKey;
  return eventKey;
}

function countNewKeys(main: Row[], next: Row[], keyOf: (row: Row) => string | null): number {
  const had = new Set(main.map(keyOf).filter((key): key is string => Boolean(key)));
  let n = 0;
  for (const row of next) {
    const key = keyOf(row);
    if (key && !had.has(key)) n += 1;
  }
  return n;
}

function interruptedTmps(storeDir: string, file: CatalogFile): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(storeDir);
  } catch {
    return [];
  }
  const prefix = `.${file}.`;
  return names
    .filter((name) => name.startsWith(prefix) && INTERRUPTED_TMP.test(name))
    .map((name) => join(storeDir, name));
}

function readRows(file: string): Row[] {
  if (!existsSync(file)) return [];
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows: Row[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRow(parsed)) rows.push(parsed);
    } catch {
      /* truncated tail from a killed rewrite */
    }
  }
  return rows;
}

function writeCatalogFile(file: string, rows: Row[]): void {
  if (rows.length === 0 && !existsSync(file)) return;
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.repair.tmp`);
  writeFileSync(tmp, body);
  renameSync(tmp, file);
}

function mergeByKey(
  main: Row[],
  extra: Row[],
  keyOf: (row: Row) => string | null,
  prefer: (kept: Row, incoming: Row) => Row,
): { rows: Row[] } {
  const out: Row[] = [];
  const index = new Map<string, number>();
  for (const row of main) {
    const key = keyOf(row);
    if (!key || index.has(key)) continue;
    index.set(key, out.length);
    out.push(structuredClone(row));
  }
  for (const row of extra) {
    const key = keyOf(row);
    if (!key) continue;
    const at = index.get(key);
    if (at == null) {
      index.set(key, out.length);
      out.push(structuredClone(row));
      continue;
    }
    out[at] = structuredClone(prefer(out[at]!, row));
  }
  return { rows: out };
}

function restoreAgentCheckpoint(
  agent: Row,
  runs: Row[],
  blobs: Set<string>,
  notes: string[],
): boolean {
  const agentId = typeof agent.agentId === 'string' ? agent.agentId : '';
  const current = rootBlobId(agent.latestCheckpoint);
  if (!agentId || !current || blobs.has(`${agentId}\0${current}`)) return false;
  const fallback = fallbackCheckpoint(runs, agentId, blobs);
  const fallbackId = rootBlobId(fallback);
  if (!fallback || !fallbackId) return false;
  agent.latestCheckpoint = fallback;
  agent.updatedAt = Date.now();
  notes.push(
    `Cursor catalog restored agent ${agentId} to checkpoint ${fallbackId} (root blob ${current} was missing)`,
  );
  return true;
}

function clearMissingActiveRun(agent: Row, runs: Row[], notes: string[]): boolean {
  const agentId = typeof agent.agentId === 'string' ? agent.agentId : '';
  const active = typeof agent.activeRunId === 'string' ? agent.activeRunId : '';
  if (!agentId || !active) return false;
  const live = runs.some((run) => run.agentId === agentId && run.runId === active);
  if (live) return false;
  agent.activeRunId = null;
  if (agent.status === 'running') agent.status = 'idle';
  notes.push(`Cursor catalog cleared missing run ${active} on agent ${agentId}`);
  return true;
}

function fallbackCheckpoint(runs: Row[], agentId: string, blobs: Set<string>): Row | null {
  const mine = runs
    .filter((run) => run.agentId === agentId)
    .slice()
    .sort((a, b) => num(b.updatedAt) - num(a.updatedAt));
  for (const run of mine) {
    for (const field of ['latestCheckpointRef', 'startCheckpointRef'] as const) {
      const ref = run[field];
      const id = rootBlobId(ref);
      if (id && blobs.has(`${agentId}\0${id}`) && isRow(ref)) return ref;
    }
  }
  return null;
}

function preferAgent(main: Row, extra: Row, blobs: Set<string>): Row {
  const mainOk = checkpointPresent(main, blobs);
  const extraOk = checkpointPresent(extra, blobs);
  if (mainOk && !extraOk) return main;
  if (extraOk && !mainOk) return extra;
  return num(extra.updatedAt) >= num(main.updatedAt) ? extra : main;
}

function checkpointPresent(agent: Row, blobs: Set<string>): boolean {
  const agentId = typeof agent.agentId === 'string' ? agent.agentId : '';
  const id = rootBlobId(agent.latestCheckpoint);
  if (!id) return true;
  return blobs.has(`${agentId}\0${id}`);
}

function checkpointBlobs(rows: Row[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.agentId !== 'string' || typeof row.blobId !== 'string') continue;
    if (typeof row.dataBase64 !== 'string' || !row.dataBase64) continue;
    ids.add(`${row.agentId}\0${row.blobId}`);
  }
  return ids;
}

function checkpointKey(row: Row): string | null {
  if (typeof row.agentId !== 'string' || typeof row.blobId !== 'string') return null;
  return `${row.agentId}\0${row.blobId}`;
}

function runKey(row: Row): string | null {
  if (typeof row.agentId !== 'string' || typeof row.runId !== 'string') return null;
  return `${row.agentId}\0${row.runId}`;
}

function eventKey(row: Row): string | null {
  if (typeof row.runId !== 'string') return null;
  if (typeof row.seq === 'number') return `${row.runId}\0${row.seq}`;
  if (typeof row.offset === 'string') return `${row.runId}\0${row.offset}`;
  return null;
}

function rootBlobId(ref: unknown): string | null {
  if (!isRow(ref) || typeof ref.rootBlobId !== 'string' || !ref.rootBlobId) return null;
  return ref.rootBlobId;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sameRows(a: Row[], b: Row[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
