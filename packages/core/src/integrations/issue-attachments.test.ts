import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTACHMENTS_DIR } from '../paths/workspace-scratch.js';
import {
  downloadAuthenticatedFile,
  extractHttpUrls,
  filenameFromContentDisposition,
  filenameFromUrl,
  hostMatches,
  mergeIssueAttachments,
} from './issue-attachments.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('issue attachment helpers', () => {
  it('parses markdown, html, and bare URLs', () => {
    expect(
      extractHttpUrls(
        'See ![shot](https://uploads.linear.app/a/b/shot.png) and [spec](https://example.com/spec.pdf)\n<img src="https://github.com/user-attachments/assets/abc">\nhttps://private-user-images.githubusercontent.com/1/x.png',
      ),
    ).toEqual([
      'https://uploads.linear.app/a/b/shot.png',
      'https://example.com/spec.pdf',
      'https://github.com/user-attachments/assets/abc',
      'https://private-user-images.githubusercontent.com/1/x.png',
    ]);
  });

  it('derives a filename and matches attachment hosts', () => {
    expect(filenameFromUrl('https://uploads.linear.app/ws/id/Spec%20v2.png')).toBe('Spec v2.png');
    expect(filenameFromContentDisposition('attachment; filename="notes.txt"')).toBe('notes.txt');
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''caf%C3%A9.pdf"),
    ).toBe('café.pdf');
    expect(hostMatches('https://uploads.linear.app/x', ['linear.app'])).toBe(true);
    expect(hostMatches('https://evil.example/linear.app', ['linear.app'])).toBe(false);
  });

  it('dedupes listed attachments', () => {
    expect(
      mergeIssueAttachments([
        { id: 'a', name: 'one', url: 'https://files.example/a.png' },
        { id: 'a', name: 'one', url: 'https://files.example/a.png' },
        { id: 'other', name: 'copy', url: 'https://files.example/a.png' },
        { id: 'b', name: 'two', url: 'https://files.example/b.png' },
      ]),
    ).toHaveLength(2);
  });
});

describe('downloadAuthenticatedFile', () => {
  it('writes bytes under .context/attachments with auth headers', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'sb-issue-att-'));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      return {
        ok: true,
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'image/png';
            if (name === 'content-disposition') return 'attachment; filename="shot.png"';
            if (name === 'content-length') return '4';
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const saved = await downloadAuthenticatedFile({
      url: 'https://uploads.linear.app/a/b/shot.png',
      headers: { Authorization: 'Bearer tok' },
      worktreePath: worktree,
    });
    expect(saved.path).toBe(`${ATTACHMENTS_DIR}/shot.png`);
    expect(saved.bytes).toBe(4);
    expect(saved.contentType).toBe('image/png');
    expect(readFileSync(join(worktree, saved.path))).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('rejects HTML responses so ticket pages are not saved as files', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'sb-issue-att-html-'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: {
          get(name: string) {
            return name === 'content-type' ? 'text/html; charset=utf-8' : null;
          },
        },
        arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
      })),
    );
    await expect(
      downloadAuthenticatedFile({
        url: 'https://linear.app/acme/issue/ENG-9',
        worktreePath: worktree,
      }),
    ).rejects.toThrow(/returned HTML/);
  });
});
