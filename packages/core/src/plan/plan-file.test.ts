import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  PLAN_FILE_REL,
  PRESENT_PLAN_REQUIRES_PLAN_MODE,
  PRESENT_PLAN_TOOL_DESCRIPTION,
  extractPresentedPlan,
  isPresentPlanToolName,
  resolvePlanMarkdown,
  shouldRegisterPresentPlan,
  threadMayPresentPlan,
  writePlanFile,
  readPlanFile,
} from './plan-file.js';

describe('isPresentPlanToolName', () => {
  it('matches present_plan variants', () => {
    expect(isPresentPlanToolName('present_plan')).toBe(true);
    expect(isPresentPlanToolName('mcp__sideboard__present_plan')).toBe(true);
    expect(isPresentPlanToolName('ask_user')).toBe(false);
  });
});

describe('threadMayPresentPlan', () => {
  it('is true only when Plan mode is on', () => {
    expect(threadMayPresentPlan(null)).toBe(false);
    expect(threadMayPresentPlan({ planMode: false })).toBe(false);
    expect(threadMayPresentPlan({ planMode: true })).toBe(true);
  });

  it('keeps present_plan registered for unknown callers, hides it when Plan is off', () => {
    expect(shouldRegisterPresentPlan(null)).toBe(true);
    expect(shouldRegisterPresentPlan(undefined)).toBe(true);
    expect(shouldRegisterPresentPlan({ planMode: false })).toBe(false);
    expect(shouldRegisterPresentPlan({ planMode: true })).toBe(true);
  });

  it('describes present_plan as Plan-mode-only', () => {
    expect(PRESENT_PLAN_TOOL_DESCRIPTION).toMatch(/Only when Sideboard Plan mode is on/i);
    expect(PRESENT_PLAN_TOOL_DESCRIPTION).toMatch(/If Plan mode is off/i);
    expect(PRESENT_PLAN_REQUIRES_PLAN_MODE).toMatch(/Plan mode is off/i);
  });
});

describe('extractPresentedPlan', () => {
  it('reads newest present_plan content', () => {
    const plan = extractPresentedPlan([
      {
        type: 'tool',
        id: '1',
        name: 'present_plan',
        input: { title: 'Auth', content: '# Step 1\nDo X' },
      },
    ]);
    expect(plan).toEqual({
      title: 'Auth',
      content: '# Step 1\nDo X',
      path: PLAN_FILE_REL,
      source: 'present_plan',
    });
  });
});

describe('writePlanFile / readPlanFile', () => {
  it('persists markdown under .context/attachments/plan.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-plan-'));
    try {
      expect(writePlanFile(dir, '# Hello\n\nWorld')).toBe(PLAN_FILE_REL);
      expect(readPlanFile(dir)).toBe('# Hello\n\nWorld\n');
      expect(readFileSync(join(dir, PLAN_FILE_REL), 'utf8')).toContain('# Hello');
      expect(existsSync(join(dir, '.context', 'attachments', '.gitignore'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads legacy .sideboard/plan.md when attachments copy is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sideboard-plan-legacy-'));
    try {
      mkdirSync(join(dir, '.sideboard'), { recursive: true });
      writeFileSync(join(dir, '.sideboard', 'plan.md'), '# Legacy\n', 'utf8');
      expect(readPlanFile(dir)).toBe('# Legacy\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolvePlanMarkdown', () => {
  it('prefers present_plan over text', () => {
    const plan = resolvePlanMarkdown({
      parts: [
        {
          type: 'tool',
          name: 'present_plan',
          input: { content: '# From tool' },
        },
      ],
      text: '# From text that is long enough to qualify as a plan fallback content here',
    });
    expect(plan?.content).toBe('# From tool');
    expect(plan?.source).toBe('present_plan');
  });
});
