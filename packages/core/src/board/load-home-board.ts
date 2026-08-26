import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPrs } from '../git/worktree.js';
import { listIssues } from '../integrations/issues.js';
import { appDataDir } from '../store/paths.js';
import { listBoardPins, replaceBoardPins } from './board-pins.js';
import {
  HOME_BOARD_CACHE_TTL_MS,
  dedupeBoardIssues,
  dedupeBoardPrs,
  issueNeedsWorkspacePick,
  syncBoardPins,
  type BoardIssue,
  type BoardPr,
  type HomeBoardLoaded,
  type HomeBoardRemoteData,
} from './home-board.js';

export type HomeBoardWorkspace = { path: string; name?: string };

export type HomeBoardInputs = HomeBoardRemoteData;

const CACHE_VERSION = 1;

type DiskCache = {
  version: number;
  workspaceKey: string;
  fetchedAt: number;
  inputs: HomeBoardInputs;
};

let memory: DiskCache | null = null;
let inflight: { key: string; promise: Promise<HomeBoardLoaded> } | null = null;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function homeBoardWorkspaceKey(workspaces: HomeBoardWorkspace[]): string {
  return workspaces
    .map((w) => w.path)
    .filter(Boolean)
    .sort()
    .join('\n');
}

function cacheFile(): string {
  return join(appDataDir(), 'home-board-cache.json');
}

function emptyInputs(): HomeBoardInputs {
  return {
    issues: [],
    prs: [],
    issueSource: 'github',
    viewerLogin: undefined,
    issueErrors: [],
    prErrors: [],
  };
}

function asLoaded(entry: DiskCache, fromCache: boolean): HomeBoardLoaded {
  const pins = syncBoardPins(listBoardPins(), entry.inputs.issues, entry.inputs.prs);
  return { ...entry.inputs, fetchedAt: entry.fetchedAt, fromCache, pins };
}

function cacheStillFresh(entry: DiskCache, key: string, now: number): boolean {
  return (
    entry.workspaceKey === key && now - entry.fetchedAt < HOME_BOARD_CACHE_TTL_MS
  );
}

/** Failures with no cards are not cached so Refresh / retry can try again. */
export function shouldCacheHomeBoardInputs(inputs: HomeBoardInputs): boolean {
  const issuesFailed = inputs.issues.length === 0 && inputs.issueErrors.length > 0;
  const prsFailed = inputs.prs.length === 0 && inputs.prErrors.length > 0;
  return !(issuesFailed && prsFailed);
}

function readDiskCache(): DiskCache | null {
  const path = cacheFile();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as DiskCache;
    if (raw?.version !== CACHE_VERSION || typeof raw.fetchedAt !== 'number') {
      return null;
    }
    if (!raw.inputs || !Array.isArray(raw.inputs.issues) || !Array.isArray(raw.inputs.prs)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeDiskCache(entry: DiskCache): void {
  try {
    mkdirSync(appDataDir(), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify(entry), 'utf8');
  } catch {
    // ignore
  }
}

function deleteDiskCache(): void {
  try {
    unlinkSync(cacheFile());
  } catch {
    // ignore
  }
}

/** Tests: drop in-process snapshot but keep the disk file. */
export function resetHomeBoardMemory(): void {
  memory = null;
  inflight = null;
}

/** Tests / Refresh: drop memory + disk snapshot. */
export function clearHomeBoardCache(): void {
  resetHomeBoardMemory();
  deleteDiskCache();
}

/**
 * Same ticket + PR fetch as desktop Home: Linear once, GitHub per workspace,
 * PRs per workspace. Failures are collected so a partial board still returns.
 */
export async function loadHomeBoardInputs(
  workspaces: HomeBoardWorkspace[],
): Promise<HomeBoardInputs> {
  const paths = workspaces.map((w) => w.path).filter(Boolean);
  if (paths.length === 0) return emptyInputs();

  const issueErrors: string[] = [];
  const prErrors: string[] = [];
  let issueSource = 'github';
  let viewerLogin: string | undefined;
  let issues: BoardIssue[] = [];

  try {
    const first = await listIssues(paths[0]!);
    issueSource = first.source;
    viewerLogin = first.viewer?.login || first.viewer?.name || undefined;
    if (first.source === 'linear') {
      const repoPath = paths[0] ?? '';
      issues = first.issues.map((issue) => ({
        ...issue,
        repoPath,
        needsWorkspacePick: issueNeedsWorkspacePick(
          issue.provider ?? first.source,
          paths.length,
        ),
      }));
    } else {
      const settled = await Promise.allSettled(
        paths.map(async (path) => {
          const result = path === paths[0] ? first : await listIssues(path);
          return result.issues.map((issue) => ({
            ...issue,
            repoPath: path,
            needsWorkspacePick: issueNeedsWorkspacePick(
              issue.provider ?? result.source,
              1,
            ),
          }));
        }),
      );
      const collected: BoardIssue[] = [];
      for (const item of settled) {
        if (item.status === 'fulfilled') collected.push(...item.value);
        else issueErrors.push(errText(item.reason));
      }
      issues = collected;
      if (collected.length === 0 && issueErrors[0]) {
        throw new Error(issueErrors[0]);
      }
    }
    issues = dedupeBoardIssues(issues);
  } catch (err) {
    issueErrors.push(errText(err));
    issues = [];
  }

  let prs: BoardPr[] = [];
  try {
    const settled = await Promise.allSettled(
      paths.map(async (path) => {
        const list = await listPrs(path);
        return list.map((pr) => ({ ...pr, repoPath: path }));
      }),
    );
    const collected: BoardPr[] = [];
    for (const item of settled) {
      if (item.status === 'fulfilled') collected.push(...item.value);
      else prErrors.push(errText(item.reason));
    }
    if (collected.length === 0 && prErrors[0]) {
      throw new Error(prErrors[0]);
    }
    prs = dedupeBoardPrs(collected);
  } catch (err) {
    prErrors.push(errText(err));
    prs = [];
  }

  return { issues, prs, issueSource, viewerLogin, issueErrors, prErrors };
}

export type GetHomeBoardInputsOptions = {
  refresh?: boolean;
  now?: number;
};

/**
 * Cached Home remote snapshot. Hits Linear/GitHub only on first load, after
 * TTL (15m), when workspaces change, or when refresh is set. Memory and
 * app-data JSON are shared so desktop Home and the orchestration MCP agree.
 */
export async function getHomeBoardInputs(
  workspaces: HomeBoardWorkspace[],
  opts?: GetHomeBoardInputsOptions,
): Promise<HomeBoardLoaded> {
  const key = homeBoardWorkspaceKey(workspaces);
  const now = opts?.now ?? Date.now();
  if (!key) {
    return {
      ...emptyInputs(),
      fetchedAt: now,
      fromCache: false,
      pins: listBoardPins(),
    };
  }

  if (!opts?.refresh) {
    const disk = readDiskCache();
    const best =
      memory && disk
        ? disk.fetchedAt >= memory.fetchedAt
          ? disk
          : memory
        : (memory ?? disk);
    if (best && cacheStillFresh(best, key, now)) {
      memory = best;
      return asLoaded(best, true);
    }
  }

  if (inflight && inflight.key === key) {
    return inflight.promise;
  }

  const promise = (async (): Promise<HomeBoardLoaded> => {
    const inputs = await loadHomeBoardInputs(workspaces);
    const fetchedAt = opts?.now ?? Date.now();
    const pins = syncBoardPins(listBoardPins(), inputs.issues, inputs.prs);
    replaceBoardPins(pins);
    const loaded: HomeBoardLoaded = { ...inputs, fetchedAt, fromCache: false, pins };
    if (shouldCacheHomeBoardInputs(inputs)) {
      const entry: DiskCache = {
        version: CACHE_VERSION,
        workspaceKey: key,
        fetchedAt,
        inputs,
      };
      memory = entry;
      writeDiskCache(entry);
    }
    return loaded;
  })();

  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}
