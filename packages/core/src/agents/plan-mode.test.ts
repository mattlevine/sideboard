import { describe, expect, it } from 'vitest';
import { permissionMode, PLAN_MODE_INSTRUCTION, PLAN_MODE_OFF_INSTRUCTION, planModeTurnInstruction } from './types.js';

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

  it('uses danger-full-access for Codex orchestration (MCP writes outside --cd)', () => {
    const mode = permissionMode({
      autonomy: 'default',
      planMode: false,
      sourceType: 'orchestration',
    });
    expect(mode.codexSandbox).toBe('danger-full-access');
  });
});

describe('PLAN_MODE_INSTRUCTION', () => {
  it('instructs plan-only behavior that stays until the user exits', () => {
    expect(PLAN_MODE_INSTRUCTION).toMatch(/Plan mode/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/present_plan|\.context\/attachments\/plan\.md/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/remain active/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/ask_user/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/greetings|task menu/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/chat message|tradeoff|description/i);
    expect(PLAN_MODE_INSTRUCTION).toMatch(/ExitPlanMode|Approve/i);
  });
});

describe('PLAN_MODE_OFF_INSTRUCTION', () => {
  it('tells the agent Plan mode is off and not to call present_plan', () => {
    expect(PLAN_MODE_OFF_INSTRUCTION).toMatch(/Plan mode is off/i);
    expect(PLAN_MODE_OFF_INSTRUCTION).toMatch(/do not call present_plan/i);
    expect(PLAN_MODE_OFF_INSTRUCTION).toMatch(/composer/i);
    expect(PLAN_MODE_OFF_INSTRUCTION).toMatch(/write it in chat/i);
    expect(PLAN_MODE_OFF_INSTRUCTION.length).toBeLessThan(400);
  });

  it('switches the per-turn prefix with planMode', () => {
    expect(planModeTurnInstruction(true)).toBe(PLAN_MODE_INSTRUCTION);
    expect(planModeTurnInstruction(false)).toBe(PLAN_MODE_OFF_INSTRUCTION);
  });
});
