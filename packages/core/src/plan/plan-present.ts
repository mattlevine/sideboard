/**
 * Pure helpers for plan presentation (safe for renderer bundling).
 * File I/O lives in plan-file.ts.
 */

import { ATTACHMENTS_DIR } from '../paths/workspace-scratch.js';

/** Canonical relative path inside the worktree (shared by forked chat tabs). */
export const PLAN_FILE_REL = `${ATTACHMENTS_DIR}/plan.md`;

export const PLAN_FILE_NAME = 'plan.md';

/** Legacy path from before plans lived under attachments/. */
export const LEGACY_PLAN_FILE_REL = '.sideboard/plan.md';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function isPresentPlanToolName(name: string | undefined | null): boolean {
  if (!name) return false;
  return /present_plan$/i.test(name) || /^mcp__sideboard__present_plan$/i.test(name);
}

export type PresentedPlan = {
  title: string;
  content: string;
  path: string;
  source: 'present_plan' | 'exit_plan' | 'text';
};

export type PlanToolPartLike = {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
};

/** Newest present_plan tool payload with markdown content. */
export function extractPresentedPlan(
  parts: PlanToolPartLike[] | undefined | null,
): PresentedPlan | null {
  if (!parts?.length) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.type !== 'tool' || !isPresentPlanToolName(p.name)) continue;
    const input = asRecord(p.input) ?? {};
    const content =
      typeof input.content === 'string'
        ? input.content
        : typeof input.plan === 'string'
          ? input.plan
          : typeof input.markdown === 'string'
            ? input.markdown
            : '';
    if (!content.trim()) continue;
    const title =
      typeof input.title === 'string' && input.title.trim()
        ? input.title.trim()
        : 'Plan';
    const path =
      typeof input.path === 'string' && input.path.trim()
        ? input.path.trim()
        : PLAN_FILE_REL;
    return { title, content: content.trim(), path, source: 'present_plan' };
  }
  return null;
}

/** Best plan markdown from tool parts, then file, then agent text fallback. */
export function resolvePlanMarkdown(opts: {
  parts?: PlanToolPartLike[] | null;
  text?: string | null;
  fileContent?: string | null;
}): PresentedPlan | null {
  const fromTool = extractPresentedPlan(opts.parts);
  if (fromTool) return fromTool;
  const file = opts.fileContent?.trim();
  if (file) {
    return {
      title: 'Plan',
      content: file,
      path: PLAN_FILE_REL,
      source: 'exit_plan',
    };
  }
  const text = opts.text?.trim();
  if (text && text.length >= 80) {
    return {
      title: 'Plan',
      content: text,
      path: PLAN_FILE_REL,
      source: 'text',
    };
  }
  return null;
}
