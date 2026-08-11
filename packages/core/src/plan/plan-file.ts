/**
 * Worktree plan document I/O (plan mode).
 * Pure presentation helpers: plan-present.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ATTACHMENTS_DIR,
  LEGACY_ATTACHMENTS_DIR,
  attachmentsGitignoreBody,
} from '../paths/workspace-scratch.js';
import {
  LEGACY_PLAN_FILE_REL,
  PLAN_FILE_REL,
} from './plan-present.js';

export {
  LEGACY_PLAN_FILE_REL,
  PLAN_FILE_NAME,
  PLAN_FILE_REL,
  extractPresentedPlan,
  isPresentPlanToolName,
  resolvePlanMarkdown,
  type PlanToolPartLike,
  type PresentedPlan,
} from './plan-present.js';

function ensureAttachmentsGitignore(worktreePath: string): void {
  const gitignoreAbs = join(worktreePath, ATTACHMENTS_DIR, '.gitignore');
  if (existsSync(gitignoreAbs)) return;
  mkdirSync(dirname(gitignoreAbs), { recursive: true });
  writeFileSync(gitignoreAbs, attachmentsGitignoreBody(), 'utf8');
}

export function planFileAbs(worktreePath: string): string {
  return join(worktreePath, PLAN_FILE_REL);
}

function readTextIfPresent(abs: string): string | null {
  if (!existsSync(abs)) return null;
  try {
    const content = readFileSync(abs, 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

/** Prefer `.context/attachments/plan.md`; fall back to legacy Sideboard paths. */
export function readPlanFile(worktreePath: string): string | null {
  return (
    readTextIfPresent(planFileAbs(worktreePath)) ??
    readTextIfPresent(join(worktreePath, `${LEGACY_ATTACHMENTS_DIR}/plan.md`)) ??
    readTextIfPresent(join(worktreePath, LEGACY_PLAN_FILE_REL))
  );
}

/** Write (or overwrite) the worktree plan markdown. Returns relative path. */
export function writePlanFile(worktreePath: string, content: string): string {
  ensureAttachmentsGitignore(worktreePath);
  const abs = planFileAbs(worktreePath);
  mkdirSync(dirname(abs), { recursive: true });
  const body = content.trimEnd() + (content.endsWith('\n') ? '' : '\n');
  writeFileSync(abs, body, 'utf8');
  return PLAN_FILE_REL;
}
