import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadLinearAttachment } from './linear-attachments.js';

describe('downloadLinearAttachment', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('downloads a Linear upload with Account auth', async () => {
    process.env.SIDEBOARD_APP_DATA = mkdtempSync(join(tmpdir(), 'sb-linear-att-'));
    const settings = await import('../store/app-settings.js');
    settings.updateIntegrationsSettings({ linearApiKey: 'lin_api_test' });
    const worktree = mkdtempSync(join(tmpdir(), 'sb-lin-att-'));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('api.linear.app')) {
        const payload = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
        expect(payload.query).toContain('SideboardAttachment');
        return {
          ok: true,
          json: async () => ({
            data: {
              attachment: {
                id: 'att-1',
                title: 'shot.png',
                url: 'https://uploads.linear.app/ws/id/shot.png',
              },
            },
          }),
        };
      }
      expect(url).toBe('https://uploads.linear.app/ws/id/shot.png');
      expect((init?.headers as Record<string, string>).Authorization).toBe('lin_api_test');
      return {
        ok: true,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'image/png';
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const saved = await downloadLinearAttachment({ id: 'att-1' }, { destPath: worktree });
    expect(saved.path).toBe('.context/attachments/shot.png');
    expect(readFileSync(join(worktree, saved.path))).toEqual(Buffer.from([1, 2]));
  });
});
