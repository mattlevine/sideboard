import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  askToolPermission,
  resetToolPermissionsForTests,
  setToolPermissionPublisher,
} from '../agents/tool-permission.js';
import type { AgentPermissionPrompt } from '../types/agent-block.js';
import { handleRemoteInbound } from './listen.js';
import { PHONE_CONTROL_PREFIX } from './phone-chats.js';
import {
  dispatchPhonePermission,
  notifyPhonePermission,
  permissionViewFromBlock,
  setPhonePermissionPush,
  takePhonePermission,
} from './phone-permission.js';

function command(body: object): string {
  return PHONE_CONTROL_PREFIX + JSON.stringify(body);
}

describe('phone permission', () => {
  let dataDir: string;
  const shown: AgentPermissionPrompt[] = [];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-phone-permission-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
    shown.length = 0;
    resetToolPermissionsForTests();
    setPhonePermissionPush(null);
    setToolPermissionPublisher({
      show(item) {
        shown.push(item.prompt);
        return true;
      },
      clear() {},
    });
  });

  afterEach(() => {
    resetToolPermissionsForTests();
    setPhonePermissionPush(null);
    delete process.env.SIDEBOARD_APP_DATA;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('leaves ordinary phone commands alone', () => {
    expect(takePhonePermission('ship it')).toBeNull();
    expect(takePhonePermission(command({ op: 'list' }))).toBeNull();
    expect(takePhonePermission(command({ op: 'permission' }))).toBe('invalid');
  });

  it('reads a permission block the way the phone paints it', () => {
    expect(
      permissionViewFromBlock({
        source: 'permission',
        permission: {
          id: 'p1',
          title: 'Allow Edit on skill.md?',
          detail: 'Outside the worktree',
          path: '/Users/me/.claude/skills/review/SKILL.md',
          allowSession: true,
        },
      }),
    ).toMatchObject({ id: 'p1', allowSession: true, path: '/Users/me/.claude/skills/review/SKILL.md' });
    expect(permissionViewFromBlock({ source: 'ask_user' })).toBeNull();
  });

  it('resolves the waiting tool when the phone allows it', async () => {
    const pending = askToolPermission({
      threadId: 't1',
      toolName: 'Edit',
      blockedPath: '/Users/me/.claude/skills/review/SKILL.md',
    });
    const replies: unknown[] = [];
    const handled = dispatchPhonePermission(
      command({ op: 'permission', chatId: 't1', id: shown[0]!.id, decision: 'allow' }),
      (reply) => replies.push(reply),
    );
    expect(handled).toBe(true);
    expect(replies).toEqual([]);
    await expect(pending).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('tells the phone when that prompt is already gone', () => {
    const replies: unknown[] = [];
    handleRemoteInbound(command({ op: 'permission', chatId: 't1', id: 'gone', decision: 'deny' }), {
      deviceId: 'phone-1',
      onOutbound: (msg) => replies.push(msg),
    });
    const text = replies.map((msg) => (msg as { text?: string }).text ?? '').join('\n');
    expect(text).toContain('That request already finished.');
    expect(text).toContain('"op":"permission"');
    expect(text).not.toContain('invalid phone command');
  });

  it('notifies the open phone when a prompt appears', () => {
    const seen: Array<PhonePermissionViewOrNull> = [];
    setPhonePermissionPush((chatId, prompt) => seen.push({ chatId, prompt }));
    notifyPhonePermission('t1', {
      id: 'p1',
      title: 'Allow Edit?',
      detail: '',
      allowSession: true,
    });
    expect(seen).toEqual([
      {
        chatId: 't1',
        prompt: { id: 'p1', title: 'Allow Edit?', detail: '', allowSession: true },
      },
    ]);
  });
});

type PhonePermissionViewOrNull = { chatId: string; prompt: { id: string } | null };
