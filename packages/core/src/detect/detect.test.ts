import { describe, expect, it, vi } from 'vitest';

const detectClaude = vi.fn(async () => ({
  agent: 'claude' as const,
  installed: true,
  authenticated: true,
  linearMcp: false,
  warnings: [],
}));
const detectCodex = vi.fn(async () => ({
  agent: 'codex' as const,
  installed: true,
  authenticated: true,
  linearMcp: false,
  warnings: [],
}));
const detectCursor = vi.fn(async () => ({
  agent: 'cursor' as const,
  installed: true,
  authenticated: true,
  linearMcp: false,
  warnings: [],
}));

vi.mock('../agents/index.js', async () => {
  const actual = await vi.importActual<typeof import('../agents/index.js')>(
    '../agents/index.js',
  );
  return {
    ...actual,
    ensureAgentPath: () => {},
    getAdapter: (kind: string) => {
      if (kind === 'claude') return { detect: detectClaude };
      if (kind === 'codex') return { detect: detectCodex };
      if (kind === 'cursor') return { detect: detectCursor };
      return { detect: detectCursor };
    },
    allAdapters: () => [
      { detect: detectClaude },
      { detect: detectCodex },
      { detect: detectCursor },
    ],
  };
});

describe('requireAgent', () => {
  it('only detects the requested agent (avoids nested Codex CLI under parent exec)', async () => {
    detectClaude.mockClear();
    detectCodex.mockClear();
    detectCursor.mockClear();
    const { requireAgent } = await import('./detect.js');
    await requireAgent('cursor');
    expect(detectCursor).toHaveBeenCalledTimes(1);
    expect(detectCodex).not.toHaveBeenCalled();
    expect(detectClaude).not.toHaveBeenCalled();
  });
});
