import { describe, expect, it } from 'vitest';
import { permissionMode, PLAN_MODE_INSTRUCTION } from './types.js';

describe('permissionMode', () => {
  it('uses Claude plan mode and read-only sandboxes when planMode is on', () => {
    const mode = permissionMode({ autonomy: 'full', planMode: true });
    expect(mode.claude).toBe('plan');
    expect(mode.codexSandbox).toBe('read-only');
    expect(JSON.parse(mode.opencodePermission)).toMatchObject({ edit: 'deny' });
  });

  it('uses default permissions when planMode is off', () => {
    const mode = permissionMode({ autonomy: 'default', planMode: false });
    expect(mode.claude).toBe('acceptEdits');
    expect(mode.codexSandbox).toBe('workspace-write');
    expect(JSON.parse(mode.opencodePermission)).toMatchObject({ edit: 'allow' });
  });

  it('plan mode overrides full autonomy for Claude', () => {
    const mode = permissionMode({ autonomy: 'full', planMode: true });
    expect(mode.claude).toBe('plan');
    expect(mode.codexSandbox).toBe('read-only');
  });
});

describe('PLAN_MODE_INSTRUCTION', () => {
  it('instructs plan-only behavior that stays until the user exits', () => {
    expect(PLAN_MODE_INSTRUCTION).toMatch(/Plan mode/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/present_plan|\.context\/attachments\/plan\.md/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/remain active/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/ask_user/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/chat message|tradeoff|description/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/ExitPlanMode|Approve/i);
  });
});
