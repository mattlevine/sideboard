import { listPrs } from '../git/worktree.js';
import { listIssues } from '../integrations/issues.js';
import {
  dedupeBoardIssues,
  dedupeBoardPrs,
  issueNeedsWorkspacePick,
  type BoardIssue,
  type BoardPr,
} from './home-board.js';

export type HomeBoardWorkspace = { path: string; name?: string };

export type HomeBoardInputs = {
  issues: BoardIssue[];
  prs: BoardPr[];
  issueSource: string;
  viewerLogin?: string;
  issueErrors: string[];
  prErrors: string[];
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Same ticket + PR fetch as desktop Home: Linear once, GitHub per workspace,
 * PRs per workspace. Failures are collected so a partial board still returns.
 */
export async function loadHomeBoardInputs(
  workspaces: HomeBoardWorkspace[],
): Promise<HomeBoardInputs> {
  const paths = workspaces.map((w) => w.path).filter(Boolean);
  if (paths.length === 0) {
    return {
      issues: [],
      prs: [],
      issueSource: 'github',
      viewerLogin: undefined,
      issueErrors: [],
      prErrors: [],
    };
  }

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
