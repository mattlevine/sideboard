import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // CJS avoids Node ESM/CJS interop crashes with native deps (better-sqlite3).
      format: 'cjs',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        external: ['better-sqlite3', 'node-pty'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      format: 'cjs',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    server: {
      port: Number(process.env.PORT) || 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        // Pure helpers only — avoid bundling Node deps (execa) from @sideboard-ai/core.
        '@sideboard/message-parts': resolve(
          __dirname,
          '../../packages/core/src/agents/message-parts.ts',
        ),
        '@sideboard/worktree-labels': resolve(
          __dirname,
          '../../packages/core/src/git/worktree-labels.ts',
        ),
        '@sideboard/brightsy-targets': resolve(
          __dirname,
          '../../packages/core/src/agents/brightsy-targets.ts',
        ),
        '@sideboard/gh-errors': resolve(
          __dirname,
          '../../packages/core/src/git/gh-errors.ts',
        ),
        '@sideboard/diff-comment': resolve(
          __dirname,
          '../../packages/core/src/composer/diff-comment.ts',
        ),
        '@sideboard/teams': resolve(
          __dirname,
          '../../packages/core/src/git/teams.ts',
        ),
        '@sideboard/orchestrator-capable': resolve(
          __dirname,
          '../../packages/core/src/agents/orchestrator-capable.ts',
        ),
        '@sideboard/plan-ask-user': resolve(
          __dirname,
          '../../packages/core/src/plan/ask-user.ts',
        ),
        '@sideboard/plan-file': resolve(
          __dirname,
          '../../packages/core/src/plan/plan-present.ts',
        ),
        '@sideboard/agent-git-actions': resolve(
          __dirname,
          '../../packages/core/src/git/agent-git-actions.ts',
        ),

      },
    },
    optimizeDeps: {
      // Never prebundle the Cursor SDK into the renderer — it ships broken .d.ts/.map
      // graphs that blow up esbuild when pulled via the @sideboard-ai/core barrel.
      // Also keep Node-only execa/unicorn-magic out of client dep optimization.
      exclude: [
        '@cursor/sdk',
        '@sideboard-ai/core',
        'execa',
        'npm-run-path',
        'unicorn-magic',
      ],
      include: ['@brightsy/client'],
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    plugins: [react()],
  },
});
